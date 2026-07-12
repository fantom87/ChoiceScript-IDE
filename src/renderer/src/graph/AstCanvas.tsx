import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type CSSProperties } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  NodeResizer,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  MarkerType,
  getNodesBounds,
  getViewportForBounds,
  BaseEdge,
  getSmoothStepPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type Connection
} from '@xyflow/react'
import { toPng, toJpeg } from 'html-to-image'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import {
  parseScene,
  generateScene,
  applyValue,
  setChoiceCount,
  insertAfter,
  removeNode,
  makeNode,
  makeNodes,
  moveNode,
  wrapInIf,
  setOptionModifier,
  nodeIndent,
  type AstNode,
  type NewNodeKind
} from '../choicescript/ast'
import {
  buildChoiceGraph,
  buildGameGraph,
  connectNodes,
  connectAcross,
  freshLabel,
  type GNode,
  type GRow,
  type GameGraph
} from './astGraph'
import {
  routeCross,
  routeInterior,
  routeTrunk,
  findGutter,
  pathHitsRect,
  pointsToPath,
  type Pt,
  type Rect
} from './edgeRouting'
import { layoutWith, layoutWithElk, sizeOf, GRID_COLS } from './canvasLayout'
import { detectIndentUnit } from '../choicescript/indent'

// Fixed row heights so estimated node sizes (for dagre) and per-option handle
// offsets line up with what actually renders.
const HEAD = 30
const ROW = 34
const TEXT_ROW = 94
const OPT_HEAD = 60 // two-line option header (type row + label row)
const PLATE_M = 42 // plate side/bottom margin — wide enough for interior channels
const PLATE_TOP = 84 // plate title gateway + breathing room above nodes
const PLATE_GAP = 72 // corridor between plates — wide enough for all lane offsets
const GATE_SEP = 14 // spacing between paths channelling through a gateway

/** Metadata for a cross-scene edge (positions resolved against live rects). */
interface CrossMeta {
  srcId: string
  /** The actual node the jump lands on (interior continuation target). */
  tgtId: string
  srcPlate: string
  tgtPlate: string
  /** Exit position as a fraction of the source plate's width. */
  exitFrac: number
  /** Gateway centre as a fraction of the target plate's width. */
  gateFrac: number
  /** Gateway offset in px from the gateway centre. */
  gateOff: number
  /** Corridor lane below the source (exit-indexed, unique per plate). */
  laneOut: number
  /** Approach lane above the target (gateway-indexed, unique per target). */
  laneIn: number
}

/** Metadata for an in-scene edge routed via a channel:
 *  'channel' = *goto via the plate's left margin; 'gutter' = wrapped-row
 *  choice→option connector via the grid gutter beside its target column. */
interface GotoMeta {
  srcId: string
  tgtId: string
  /** Owning plate id in game mode; null in single-scene mode. */
  plate: string | null
  lane: number
  /** How many channel lanes this scene's gotos need (gutter width driver). */
  slots: number
  mode?: 'gutter'
}

/** Left-margin width for a plate whose scene has `gotoCount` in-scene jumps —
 *  the channel gutter widens to give every jump its own lane. */
function plateLeftMargin(gotoCount: number): number {
  return Math.max(PLATE_M, 22 + Math.min(gotoCount, 10) * 8)
}

/** Spread edges that share an endpoint into distinct lanes so parallel runs
 *  keep a minimum separation instead of stacking on the same pixels. */
function assignEdgeOffsets(edges: Edge[]): Edge[] {
  const bySrc = new Map<string, number>()
  const byTgt = new Map<string, number>()
  return edges.map((e) => {
    const si = bySrc.get(e.source) ?? 0
    bySrc.set(e.source, si + 1)
    const ti = byTgt.get(e.target) ?? 0
    byTgt.set(e.target, ti + 1)
    return { ...e, data: { ...e.data, offset: 14 + ((si * 2 + ti) % 7) * 9 } }
  })
}
const rowH = (r: GRow): number => (r.multiline ? TEXT_ROW : ROW)
const rowsH = (rows: GRow[]): number => rows.reduce((h, r) => h + rowH(r), 0)

interface Ctx {
  ast: AstNode[]
  /** The AST a mutation should target: `own`'s scene in game mode, else the
   *  active scene's. */
  astFor: (own?: string) => AstNode[]
  /** True when zoomed out in whole-game mode: static render, no edit chrome. */
  readonly: boolean
  /** Run a mutation against `own`'s AST (defaults to the active scene) and
   *  write the regenerated text back — works across scenes in game mode. */
  commit: (mutate: () => void, own?: string) => void
  jump: (line0: number, scene?: string) => void
  /** Highlight the whole node range; with row bounds, that row is the focus.
   *  `own` = the node's scene (whole-game mode) — ignored if not active. */
  hoverIn: (nodeStart0: number, nodeEnd: number, rowStart0?: number, rowEnd?: number, own?: string) => void
  hoverOut: () => void
  switchScene: (scene: string) => void
  playFrom: (line0: number) => void
  unit: string
}

/** What an insert menu can produce: node kinds plus composite/special picks. */
export type InsertPick = NewNodeKind | 'if_else' | 'custom' | 'wrap_if'

const INSERT_KINDS: { kind: InsertPick; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'set', label: '*set' },
  { kind: 'temp', label: '*temp (variable)' },
  { kind: 'if', label: '*if' },
  { kind: 'if_else', label: '*if / *else' },
  { kind: 'goto', label: '*goto' },
  { kind: 'page_break', label: '*page_break' },
  { kind: 'choice', label: 'Choice' },
  { kind: 'fake_choice', label: 'Fake choice' },
  { kind: 'custom', label: 'Command…' }
]

/** Build the statements for a pick ('custom' prompts for a raw command line). */
function makeFor(kind: InsertPick, indent: string, unit: string): AstNode[] | null {
  if (kind === 'wrap_if') return null // handled by the caller
  if (kind === 'custom') {
    const line = window.prompt('Command line (e.g. *image forest.jpg or *achieve winner):', '*')
    const t = line?.trim()
    if (!t || t === '*') return null
    const raw = t.startsWith('*') ? t : `*${t}`
    const name = /^\*(\w+)/.exec(raw)?.[1]?.toLowerCase() ?? 'comment'
    return [{ type: 'command', name, raw: `${indent}${raw}` }]
  }
  return makeNodes(kind, indent, unit)
}

/** "+ ▾" dropdown that inserts a new statement via `onPick`. */
function InsertMenuBtn({
  onPick,
  title,
  extra
}: {
  onPick: (k: InsertPick) => void
  title: string
  extra?: { value: InsertPick; label: string }[]
}) {
  return (
    <select
      className="an-add nodrag"
      title={title}
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as InsertPick)
        e.target.value = ''
      }}
    >
      <option value="" disabled>
        +
      </option>
      {INSERT_KINDS.map((k) => (
        <option key={k.kind} value={k.kind}>
          {k.label}
        </option>
      ))}
      {extra?.map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
    </select>
  )
}

interface NodeData {
  g: GNode
  highlightLine: number | null
  ctx: MutableRefObject<Ctx>
  onResizeEnd: () => void
  [key: string]: unknown
}

// Which rowlike line-range in this node most tightly contains the editor line.
function bestRow(cands: { id: string; s: number; e: number }[], line: number | null): string | null {
  if (line == null) return null
  const t = line - 1
  let best: { id: string; span: number } | null = null
  for (const c of cands) {
    if (t >= c.s && t < c.e) {
      const span = c.e - c.s
      if (!best || span < best.span) best = { id: c.id, span }
    }
  }
  return best?.id ?? null
}

function RowView({
  row,
  ctx,
  hl,
  bounds,
  own
}: {
  row: GRow
  ctx: MutableRefObject<Ctx>
  hl: boolean
  /** The containing node's [startLine, endLine) — for whole-node highlight. */
  bounds: [number, number]
  /** Owning scene (whole-game mode). */
  own?: string
}) {
  const ref = useRef(row.value)
  ref.current = row.value
  const commit = (): void => {
    if (ref.current !== row.value) ctx.current.commit(() => applyValue(row.node, ref.current), own)
  }
  return (
    <div
      className={`an-row ${hl ? 'an-row-hl' : ''}`}
      onMouseEnter={() => ctx.current.hoverIn(bounds[0], bounds[1], row.startLine, row.endLine, own)}
      onMouseLeave={() => ctx.current.hoverIn(bounds[0], bounds[1], undefined, undefined, own)}
    >
      {Array.from({ length: row.depth }, (_, i) => (
        <span className="an-guide" key={i} />
      ))}
      <div className={`an-cell an-${row.nodeType}`}>
        <div className="an-head">
          <span className="an-kind">{row.typeLabel}</span>
          <span className="an-actions">
            <button
              className="an-jump nodrag"
              title="Move up"
              onClick={() => ctx.current.commit(() => moveNode(ctx.current.astFor(own), row.node, -1), own)}
            >
              ↑
            </button>
            <button
              className="an-jump nodrag"
              title="Move down"
              onClick={() => ctx.current.commit(() => moveNode(ctx.current.astFor(own), row.node, 1), own)}
            >
              ↓
            </button>
            {nodeIndent(row.node) === '' && (
              <button
                className="an-jump nodrag"
                title="Play from here"
                onClick={() => ctx.current.playFrom(row.startLine)}
              >
                ▶
              </button>
            )}
            <InsertMenuBtn
              title="Insert a statement after this one"
              extra={[{ value: 'wrap_if', label: 'Wrap in *if' }]}
              onPick={(k) =>
                ctx.current.commit(() => {
                  if (k === 'wrap_if') {
                    wrapInIf(ctx.current.astFor(own), row.node, ctx.current.unit)
                    return
                  }
                  const made = makeFor(k, nodeIndent(row.node), ctx.current.unit)
                  if (!made) return
                  let anchor = row.node
                  for (const nn of made) {
                    insertAfter(ctx.current.astFor(own), anchor, nn)
                    anchor = nn
                  }
                }, own)
              }
            />
            <button className="an-jump nodrag" title="Reveal in code editor" onClick={() => ctx.current.jump(row.startLine)}>
              ↪
            </button>
            <button
              className="an-jump nodrag"
              title="Delete this statement (undoable)"
              onClick={() => ctx.current.commit(() => removeNode(ctx.current.astFor(own), row.node), own)}
            >
              ✕
            </button>
          </span>
        </div>
        {row.hasField &&
          (ctx.current.readonly ? (
            // Whole-game mode: plain text — thousands of live inputs are the
            // difference between smooth and choppy at this scale.
            <div className="an-static">
              {row.fieldHint ? `${row.fieldHint}` : ''}
              {row.value}
            </div>
          ) : row.multiline ? (
            <textarea
              className="an-field nodrag nowheel"
              spellCheck={false}
              defaultValue={row.value}
              key={row.value}
              onChange={(e) => {
                ref.current = e.target.value
              }}
              onBlur={commit}
            />
          ) : (
            <div className="an-field-row">
              {row.fieldHint && <span className="an-prefix">{row.fieldHint}</span>}
              <input
                className="an-input nodrag"
                spellCheck={false}
                defaultValue={row.value}
                key={row.value}
                onChange={(e) => {
                  ref.current = e.target.value
                }}
                onBlur={commit}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

function ContentNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g
  const rows = g.kind === 'content' ? g.rows : []
  const hlId = useMemo(
    () => bestRow(rows.map((r) => ({ id: r.id, s: r.startLine, e: r.endLine })), data.highlightLine),
    [rows, data.highlightLine]
  )
  const bounds: [number, number] = [g.startLine, g.endLine]
  const own = (g as { ownScene?: string }).ownScene
  return (
    <div
      className="gn gn-content"
      onMouseEnter={() => data.ctx.current.hoverIn(bounds[0], bounds[1], undefined, undefined, own)}
      onMouseLeave={() => data.ctx.current.hoverOut()}
    >
      {!data.ctx.current.readonly && (
        <NodeResizer minWidth={200} minHeight={44} isVisible onResizeEnd={data.onResizeEnd} />
      )}
      <Handle type="target" position={Position.Top} />
      {rows.map((r) => (
        <RowView key={r.id} row={r} ctx={data.ctx} hl={r.id === hlId} bounds={bounds} own={own} />
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function ChoiceNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g
  if (g.kind !== 'choice') return null
  const cOwn = (g as { ownScene?: string }).ownScene
  return (
    <div
      className={`gn gn-choice ${g.fake ? 'gn-fake' : ''}`}
      onMouseEnter={() => data.ctx.current.hoverIn(g.startLine, g.endLine, undefined, undefined, cOwn)}
      onMouseLeave={() => data.ctx.current.hoverOut()}
    >
      {!data.ctx.current.readonly && (
        <NodeResizer minWidth={180} minHeight={40} isVisible onResizeEnd={data.onResizeEnd} />
      )}
      <Handle type="target" position={Position.Top} />
      <div className="cn-head">
        <span className="cn-kind">{g.fake ? 'Fake Choice' : 'Choice'}</span>
        <label className="an-count nodrag" title="Number of options">
          #
          <input
            type="number"
            min={1}
            max={30}
            value={g.count}
            onChange={(e) => {
              const n = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1))
              data.ctx.current.commit(() => setChoiceCount(g.node, n, data.ctx.current.unit), cOwn)
            }}
          />
        </label>
        <span className="an-actions">
          <button
            className="an-jump nodrag"
            title="Add an option"
            onClick={() =>
              data.ctx.current.commit(() => setChoiceCount(g.node, g.count + 1, data.ctx.current.unit), cOwn)
            }
          >
            +#
          </button>
          <button
            className="an-jump nodrag"
            title="Move up"
            onClick={() => data.ctx.current.commit(() => moveNode(data.ctx.current.astFor(cOwn), g.node, -1), cOwn)}
          >
            ↑
          </button>
          <button
            className="an-jump nodrag"
            title="Move down"
            onClick={() => data.ctx.current.commit(() => moveNode(data.ctx.current.astFor(cOwn), g.node, 1), cOwn)}
          >
            ↓
          </button>
          {nodeIndent(g.node) === '' && (
            <button className="an-jump nodrag" title="Play from this choice" onClick={() => data.ctx.current.playFrom(g.startLine)}>
              ▶
            </button>
          )}
          <InsertMenuBtn
            title="Insert a statement after this choice"
            onPick={(k) =>
              data.ctx.current.commit(() => {
                const made = makeFor(k, nodeIndent(g.node), data.ctx.current.unit)
                if (!made) return
                let anchor: AstNode = g.node
                for (const nn of made) {
                  insertAfter(data.ctx.current.astFor(cOwn), anchor, nn)
                  anchor = nn
                }
              }, cOwn)
            }
          />
          <button className="an-jump nodrag" title="Reveal in code editor" onClick={() => data.ctx.current.jump(g.startLine)}>
            ↪
          </button>
          <button
            className="an-jump nodrag"
            title="Delete this choice and all its options (undoable)"
            onClick={() => data.ctx.current.commit(() => removeNode(data.ctx.current.astFor(cOwn), g.node), cOwn)}
          >
            ✕
          </button>
        </span>
      </div>
      {g.preRows.map((r) => (
        <RowView key={r.id} row={r} ctx={data.ctx} hl={false} bounds={[g.startLine, g.endLine]} own={cOwn} />
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function OptionNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g
  const ref = useRef(g.kind === 'option' ? g.label : '')
  if (g.kind === 'option') ref.current = g.label
  const rows = g.kind === 'option' ? g.rows : []
  const optLine = g.kind === 'option' ? g.startLine : 0
  const hlHeader = useMemo(
    () => (g.kind === 'option' ? bestRow([{ id: 'h', s: g.startLine, e: g.startLine + 1 }], data.highlightLine) : null),
    [g, data.highlightLine]
  )
  const hlRow = useMemo(
    () => bestRow(rows.map((r) => ({ id: r.id, s: r.startLine, e: r.endLine })), data.highlightLine),
    [rows, data.highlightLine]
  )
  if (g.kind !== 'option') return null
  const bounds: [number, number] = [g.startLine, g.endLine]
  const oOwn = (g as { ownScene?: string }).ownScene
  const commit = (): void => {
    if (ref.current !== g.label) data.ctx.current.commit(() => applyValue(g.node, ref.current), oOwn)
  }
  return (
    <div
      className="gn gn-option"
      onMouseEnter={() => data.ctx.current.hoverIn(bounds[0], bounds[1], undefined, undefined, oOwn)}
      onMouseLeave={() => data.ctx.current.hoverOut()}
    >
      {!data.ctx.current.readonly && (
        <NodeResizer minWidth={180} minHeight={40} isVisible onResizeEnd={data.onResizeEnd} />
      )}
      <Handle type="target" position={Position.Top} />
      <div
        className={`an-cell an-option ${hlHeader === 'h' ? 'an-row-hl' : ''}`}
        onMouseEnter={() => data.ctx.current.hoverIn(bounds[0], bounds[1], optLine, optLine + 1, oOwn)}
        onMouseLeave={() => data.ctx.current.hoverIn(bounds[0], bounds[1], undefined, undefined, oOwn)}
      >
        {/* Row 1: type + branch weight + actions. Row 2: the full-width label. */}
        <div className="an-head">
          <span className="an-kind">Option</span>
          <span className="an-words" title="Prose words in this branch">
            {g.words}w
          </span>
          <span className="an-actions">
            <button
              className="an-jump nodrag"
              title="Move option up"
              onClick={() => data.ctx.current.commit(() => moveNode(data.ctx.current.astFor(oOwn), g.node, -1), oOwn)}
            >
              ↑
            </button>
            <button
              className="an-jump nodrag"
              title="Move option down"
              onClick={() => data.ctx.current.commit(() => moveNode(data.ctx.current.astFor(oOwn), g.node, 1), oOwn)}
            >
              ↓
            </button>
            {!g.modifier && (
              <button
                className="an-jump nodrag"
                title="Add a condition/modifier to this option (*selectable_if …)"
                onClick={() =>
                  data.ctx.current.commit(() => setOptionModifier(g.node, '*selectable_if (condition)'), oOwn)
                }
              >
                ⚑
              </button>
            )}
            <InsertMenuBtn
              title="Insert a statement at the top of this option"
              onPick={(k) =>
                data.ctx.current.commit(() => {
                  const made = makeFor(k, nodeIndent(g.node) + data.ctx.current.unit, data.ctx.current.unit)
                  if (!made) return
                  g.node.children.unshift(...made)
                }, oOwn)
              }
            />
            <button
              className="an-jump nodrag"
              title="Reveal in code editor"
              onClick={() => data.ctx.current.jump(optLine, oOwn)}
            >
              ↪
            </button>
            <button
              className="an-jump nodrag"
              title="Delete this option and its contents (undoable)"
              onClick={() => data.ctx.current.commit(() => removeNode(data.ctx.current.astFor(oOwn), g.node), oOwn)}
            >
              ✕
            </button>
          </span>
        </div>
        <div className="an-optlabel">
          <span className="an-prefix">#</span>
          {data.ctx.current.readonly ? (
            <span className="an-static">{g.label}</span>
          ) : (
            <input
              className="an-input nodrag"
              spellCheck={false}
              defaultValue={g.label}
              key={g.label}
              onChange={(e) => {
                ref.current = e.target.value
              }}
              onBlur={commit}
            />
          )}
        </div>
        {g.modifier && (
          <div className="an-mod" title="Inline modifier — clear to remove">
            {data.ctx.current.readonly ? (
              <span className="an-modinput an-static">{g.modifier}</span>
            ) : (
              <input
                className="an-modinput nodrag"
                spellCheck={false}
                defaultValue={g.modifier}
                key={g.modifier}
                onBlur={(e) =>
                  data.ctx.current.commit(() => setOptionModifier(g.node, e.target.value || null), oOwn)
                }
              />
            )}
          </div>
        )}
      </div>
      {rows.map((r) => (
        <RowView key={r.id} row={r} ctx={data.ctx} hl={r.id === hlRow} bounds={bounds} own={oOwn} />
      ))}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function StubNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g
  if (g.kind !== 'stub') return null
  return (
    <div
      className={`bn-stub ${g.scene ? 'clickable' : ''}`}
      onClick={g.scene ? () => data.ctx.current.switchScene(g.scene!) : undefined}
    >
      <Handle type="target" position={Position.Top} />
      {g.title}
    </div>
  )
}

/** Scene title gateway — a top-level object floating ABOVE the edge layer so
 *  incoming paths pass underneath it. Click opens the scene for editing. */
function SceneHeadNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g
  const hue = (data.hue as number) ?? 200
  const gateCount = (data.gateCount as number) ?? 0
  if (g.kind !== 'scenehead') return null
  return (
    <div
      className="gn-scenehead"
      style={{
        background: `hsl(${hue} 45% 32%)`,
        borderColor: `hsl(${hue} 55% 60% / 0.6)`,
        minWidth: gateCount ? gateCount * GATE_SEP + 48 : undefined
      }}
      title="Open this scene in the editor"
    >
      {g.title}
    </div>
  )
}

/** Tinted buffer plate behind a scene's nodes (whole-game mosaic). Its title
 *  bar is the plate's drag handle — grab it to move the whole scene; click it
 *  to open the scene. The plate body ignores the mouse (pan passes through). */
function SceneBgNode(_props: NodeProps<Node<NodeData>>) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Grab strip along the plate's top: drag here to move the whole scene. */}
      <div className="scenebg-grab" title="Drag to move this scene — click to open it" />
      {/* Invisible connection anchor — incoming cross-scene edges terminate
          here; their drawn paths spread across the gateway via waypoints. */}
      <Handle
        type="target"
        id="gate"
        position={Position.Top}
        style={{ left: '50%', opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}

/** Cross-scene edge: follows precomputed corridor waypoints (exit at the
 *  bottom of the source plate, highways around other plates, in through the
 *  target's title gateway), drawn cased like every other edge. */
function CrossingEdge(props: EdgeProps) {
  const pts = props.data?.points as Pt[] | undefined
  if (!pts?.length) return <CasedEdge {...props} />
  const path = pointsToPath(pts, 7)
  return <CasedPath id={props.id} path={path} data={props.data} markerEnd={props.markerEnd} />
}

/** Every connection drawn as a cased line (dark outline + coloured core, like
 *  map roads) so crossings stay readable; orthogonal step routing keeps lines
 *  in the lanes between nodes instead of cutting underneath them. */
/** Shared cased rendering with selection highlight/dim support. */
function CasedPath({
  id,
  path,
  data,
  markerEnd
}: {
  id: string
  path: string
  data: Record<string, unknown> | undefined
  markerEnd?: string
}) {
  const color = (data?.color as string) ?? '#666'
  const dash = data?.dash as string | undefined
  const w = (data?.w as number) ?? 2
  const hl = !!data?.hl
  const dim = !!data?.dim
  const op = dim ? 0.13 : 1
  return (
    <>
      <BaseEdge
        id={`${id}-casing`}
        path={path}
        style={{ stroke: hl ? '#f2c46d' : '#141414', strokeWidth: hl ? w + 5 : w + 3, opacity: 0.9 * op }}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: color, strokeWidth: hl ? w + 1 : w, strokeDasharray: dash, opacity: op }}
      />
    </>
  )
}

function CasedEdge(props: EdgeProps) {
  // Clamp the lane offset for SHORT edges: an offset bigger than half the
  // vertical gap makes smoothstep loop into a squiggle between close nodes.
  const gap = Math.abs(props.targetY - props.sourceY)
  const offset = Math.max(4, Math.min((props.data?.offset as number) ?? 16, gap / 2 - 2))
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 10,
    offset
  })
  return <CasedPath id={props.id} path={path} data={props.data} markerEnd={props.markerEnd} />
}

const edgeTypes = { cased: CasedEdge, crossing: CrossingEdge }

const nodeTypes = {
  content: ContentNode,
  choice: ChoiceNode,
  option: OptionNode,
  stub: StubNode,
  scenehead: SceneHeadNode,
  scenebg: SceneBgNode
}

function nodeHeight(g: GNode): number {
  if (g.kind === 'content') return rowsH(g.rows) + 10
  if (g.kind === 'option') return OPT_HEAD + rowsH(g.rows) + 10
  if (g.kind === 'stub') return 38
  if (g.kind === 'scenehead') return 40
  return HEAD + rowsH(g.preRows) + 10
}
function nodeWidth(g: GNode): number {
  return g.kind === 'choice' ? 220 : g.kind === 'option' ? 260 : g.kind === 'stub' ? 150 : g.kind === 'scenehead' ? 220 : 300
}

interface AstCanvasProps {
  scene: string
  text: string
  highlightLine: number | null
  indentStyle: 'tab' | 'space'
  indentWidth: number
  /** All scene sources + scene order — enables the whole-game view. */
  files?: Record<string, string>
  sceneList?: string[]
  /** Current lint findings for this scene (shown on demand via Review). */
  problems?: { line: number; message: string; severity: string }[]
  /** Declared variables (startup *create + this scene's *temp). */
  variables?: { name: string; value: string; kind: 'create' | 'temp' }[]
  /** Create a new scene file + scene_list entry (canvas "New scene…"). */
  onNewScene?: (name: string) => void
  /** Custom node-type colours + change handler (🎨 popover). */
  typeColors?: { text?: string; command?: string; choice?: string; option?: string; if?: string }
  onTypeColors?: (patch: Record<string, string | undefined>) => void
  /** Start in whole-game mode (used by the headless render smoke test). */
  initialGameMode?: boolean
  /** Fires when the whole-game toggle flips (the tutorial listens). */
  onGameModeChange?: (on: boolean) => void
  /** Write a scene's regenerated text (any scene — enables game-mode edits). */
  onEditScene: (sceneName: string, newText: string) => void
  onJump: (line0: number, scene?: string) => void
  /** Whole-node range (1-based), plus the focused row's range when on a row. */
  onHoverRange: (range: [number, number] | null, focus?: [number, number]) => void
  onIndentChange: (patch: { indentStyle?: 'tab' | 'space'; indentWidth?: number }) => void
  onNormalize: () => void
  onSwitchScene: (scene: string) => void
  onPlayFrom: (line0: number) => void
}

interface MenuState {
  x: number
  y: number
  /** Raw client coords (for converting to flow coordinates on 'Add here'). */
  clientX: number
  clientY: number
  /** Target node id, or null for a right-click on empty canvas. */
  nodeId: string | null
  /** Whole-game mode: the scene whose plate the pane click landed in. */
  sceneAt?: string
}

/** The graph node whose line range contains `line0` (deepest = max startLine). */
function findPlaceTarget(nds: Node[], line0: number): string | null {
  let best: { id: string; s: number } | null = null
  for (const n of nds) {
    const g = (n.data as NodeData | undefined)?.g
    if (!g || g.kind === 'stub') continue
    if (g.startLine <= line0 && line0 < g.endLine) {
      if (!best || g.startLine >= best.s) best = { id: n.id, s: g.startLine }
    }
  }
  return best?.id ?? null
}

/** useNodesInitialized (and other store hooks) need a ReactFlowProvider
 *  ABOVE the component — without this wrapper the hook throws on mount. */
export function AstCanvas(props: AstCanvasProps) {
  return (
    <ReactFlowProvider>
      <AstCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function AstCanvasInner({
  scene,
  text,
  highlightLine,
  indentStyle,
  indentWidth,
  files,
  sceneList = [],
  problems = [],
  variables = [],
  onNewScene,
  typeColors,
  onTypeColors,
  initialGameMode = false,
  onGameModeChange,
  onEditScene,
  onJump,
  onHoverRange,
  onIndentChange,
  onNormalize,
  onSwitchScene,
  onPlayFrom
}: AstCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const [reflowOnResize, setReflowOnResize] = useState(true)
  const reflowRef = useRef(reflowOnResize)
  reflowRef.current = reflowOnResize

  const unit = indentStyle === 'tab' ? '\t' : ' '.repeat(indentWidth)
  const detected = useMemo(() => detectIndentUnit(text), [text])

  /** Effective node-type colours (custom over defaults). */
  const TYPE_DEFAULTS = { text: '#9a9a9a', command: '#c586c0', choice: '#dcdcaa', option: '#4ec9b0', if: '#569cd6' }
  const colors = { ...TYPE_DEFAULTS, ...Object.fromEntries(Object.entries(typeColors ?? {}).filter(([, v]) => v)) } as typeof TYPE_DEFAULTS
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const [colorsOpen, setColorsOpen] = useState(false)
  /** Selected node/plate id — highlights it plus every connected path. */
  const [selId, setSelId] = useState<string | null>(null)
  const [gameMode, setGameMode] = useState(initialGameMode)
  const gameModeRef = useRef(gameMode)
  gameModeRef.current = gameMode
  const gmChangeRef = useRef(onGameModeChange)
  gmChangeRef.current = onGameModeChange
  useEffect(() => {
    gmChangeRef.current?.(gameMode)
  }, [gameMode])
  // Edge stroke width adapts to zoom so connections stay visible zoomed out
  // (and in whole-map exports, which capture at low zoom).
  const [edgeW, setEdgeW] = useState(2)
  const edgeWRef = useRef(edgeW)
  edgeWRef.current = edgeW
  // Zoom LOD: zoomed OUT in game mode → static text + hidden edit chrome
  // (fast overview); zoomed IN → full live editing, any scene.
  const [lod, setLod] = useState(initialGameMode)
  const lodRef = useRef(lod)
  lodRef.current = lod
  // Layout engine trial: 'elk' = ELK layered layout with real obstacle-aware
  // orthogonal edge routing (scene view); 'dagre' = the standard system.
  const [engine, setEngine] = useState<'dagre' | 'elk'>('dagre')
  const engineRef = useRef(engine)
  engineRef.current = engine
  const elkPassRef = useRef<(() => void) | null>(null)
  const newVarRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Toggling whole-game view keeps the CURRENT scene framed on screen; the
  // rest of the game materialises around it. Toggling back re-frames the scene.
  const firstMount = useRef(true)
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false
      return
    }
    const t = setTimeout(() => {
      if (gameMode) {
        void fitView({ nodes: [{ id: `bg::${scene}` }], padding: 0.25, duration: 300 })
      } else {
        void fitView({ padding: 0.15, duration: 200 })
      }
    }, 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode])
  /** Where a pane-added statement should land on the canvas (flow coords). */
  const pendingPlace = useRef<{ x: number; y: number; line0: number } | null>(null)

  const openMenu = useCallback(
    (e: { preventDefault(): void; clientX: number; clientY: number }, nodeId: string | null) => {
      e.preventDefault()
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      // In whole-game mode a pane click inside a plate targets THAT scene.
      let sceneAt: string | undefined
      if (!nodeId && gameModeRef.current) {
        const fp = screenToFlowPosition({ x: e.clientX, y: e.clientY })
        const plate = nodesRef.current.find(
          (n) =>
            n.type === 'scenebg' &&
            fp.x >= n.position.x &&
            fp.x <= n.position.x + (n.width ?? 0) &&
            fp.y >= n.position.y &&
            fp.y <= n.position.y + (n.height ?? 0)
        )
        if (!plate) return // outside every scene — nothing to add to
        sceneAt = plate.id.slice(4)
      }
      setMenu({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        clientX: e.clientX,
        clientY: e.clientY,
        nodeId,
        sceneAt
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Stable context the node components read for the latest callbacks + AST.
  const ctx = useRef<Ctx>({
    ast: [],
    astFor: () => [],
    readonly: false,
    commit: () => {},
    jump: () => {},
    hoverIn: () => {},
    hoverOut: () => {},
    switchScene: () => {},
    playFrom: () => {},
    unit
  })

  const relayout = useCallback(
    (force = false) => {
      if (gameModeRef.current) return // stitched layout — don't re-dagre globally
      if (!force && !reflowRef.current) return
      if (engineRef.current === 'elk') {
        elkPassRef.current?.()
        return
      }
      setNodes((nds) => {
        const laid = layoutWith(nds, edgesRef.current)
        // A pane-added statement lands where the user right-clicked.
        const place = pendingPlace.current
        if (place) {
          pendingPlace.current = null
          const target = findPlaceTarget(laid, place.line0)
          if (target) {
            return laid.map((n) => (n.id === target ? { ...n, position: { x: place.x, y: place.y } } : n))
          }
        }
        return laid
      })
      // New positions invalidate goto-channel waypoints.
      setTimeout(() => setEdges((eds) => routeAllCross(nodesRef.current, eds)), 0)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setNodes, setEdges]
  )

  ctx.current = {
    ast: ctx.current.ast,
    astFor: (own) => (gameModeRef.current ? (ggRef.current?.asts[own ?? scene] ?? []) : ctx.current.ast),
    readonly: gameMode && lod,
    commit: (mutate, own) => {
      const sc = own ?? scene
      if (gameModeRef.current) {
        const ast = ggRef.current?.asts[sc]
        if (!ast) return
        mutate()
        onEditScene(sc, generateScene(ast))
      } else {
        mutate()
        onEditScene(scene, generateScene(ctx.current.ast))
      }
    },
    jump: onJump,
    hoverIn: (nodeS, nodeE, rowS, rowE, own) => {
      if (own && own !== scene) return // other scene: no editor sync
      onHoverRange([nodeS + 1, nodeE], rowS != null ? [rowS + 1, rowE ?? rowS + 1] : undefined)
    },
    hoverOut: () => onHoverRange(null),
    switchScene: onSwitchScene,
    playFrom: onPlayFrom,
    unit
  }

  const toRf = useCallback(
    (gn: GNode): Node => ({
      id: gn.id,
      type: gn.kind,
      position: { x: 0, y: 0 },
      data: { g: gn, highlightLine: null, ctx, onResizeEnd: () => relayout() } as NodeData,
      width: nodeWidth(gn),
      // Estimates only — the DOM auto-sizes (height), then a measured
      // re-layout runs. A complete initial pair also enables SSR rendering.
      initialWidth: nodeWidth(gn),
      initialHeight: nodeHeight(gn)
    }),
    [relayout]
  )
  const toRfEdge = useCallback(
    (e: { id: string; source: string; target: string; kind: string }): Edge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'cased',
      data: {
        kind: e.kind,
        color:
          e.kind === 'scene'
            ? '#569cd6'
            : e.kind === 'goto'
              ? '#e2c08d'
              : e.kind === 'option'
                ? colorsRef.current.option
                : '#8a8a8a',
        dash: e.kind === 'scene' ? '6 4' : undefined,
        w: edgeWRef.current
      },
      markerEnd:
        e.kind === 'goto' || e.kind === 'scene'
          ? { type: MarkerType.ArrowClosed, color: e.kind === 'goto' ? '#e2c08d' : '#569cd6' }
          : undefined,
      animated: false
    }),
    []
  )

  // Whole-game stitching: each scene is a PARENT plate; plates flow in SCENE
  // ORDER (startup first, then scene_list — the order of the game) as shelves.
  // `sizes` (measured node dimensions) makes the second, exact pass fit plates
  // to their real contents so nothing overflows.
  const ggRef = useRef<GameGraph | null>(null)
  const crossRef = useRef<Map<string, CrossMeta>>(new Map())
  const gotoRef = useRef<Map<string, GotoMeta>>(new Map())
  const stitchGame = useCallback(
    (gg: GameGraph, sizes?: Map<string, { w: number; h: number }>): { nodes: Node[]; cross: Map<string, CrossMeta> } => {
      const dim = (n: Node): { w: number; h: number } => sizes?.get(n.id) ?? sizeOf(n)
      // Incoming cross-edge counts (title gateways size to fit their paths).
      const preOwn = new Map<string, string>()
      for (const n of gg.nodes) if (n.kind !== 'scenehead' && n.ownScene) preOwn.set(n.id, n.ownScene)
      const inCount = new Map<string, number>()
      const gotoCount = new Map<string, number>()
      for (const e of gg.edges) {
        const so = preOwn.get(e.source)
        const to = preOwn.get(e.target)
        if (so && to && so !== to) inCount.set(to, (inCount.get(to) ?? 0) + 1)
        if (e.kind === 'goto' && so && so === to) gotoCount.set(so, (gotoCount.get(so) ?? 0) + 1)
      }
      interface Tile {
        scene: string
        body: Node[]
        w: number
        h: number
        /** Entry-node centre x in tile coords (the name sits above it). */
        entryCx: number
      }
      const tiles: Tile[] = []
      for (const s of gg.scenes) {
        const bodyG = gg.nodes.filter((n) => n.ownScene === s && n.kind !== 'scenehead')
        const ids = new Set(bodyG.map((n) => n.id))
        const internal = gg.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
        const laid = layoutWith(bodyG.map(toRf), internal.map(toRfEdge), sizes)
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const n of laid) {
          const { w, h } = dim(n)
          minX = Math.min(minX, n.position.x)
          minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + w)
          maxY = Math.max(maxY, n.position.y + h)
        }
        if (!laid.length) {
          minX = minY = 0
          maxX = 240
          maxY = 40
        }
        // Track the ENTRY node's centre — the scene name positions itself
        // above it (rather than forcing the layout symmetric, which doubled
        // the width of staircase-shaped scenes).
        const entry = laid[0]
        const entryCx = entry ? entry.position.x - minX + dim(entry).w / 2 : (maxX - minX) / 2
        tiles.push({
          scene: s,
          body: laid.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } })),
          w: Math.max(240, maxX - minX),
          h: maxY - minY,
          entryCx
        })
      }
      const sceneGate = new Map<string, number>()
      const sceneOrder = new Map(gg.scenes.map((s, i) => [s, i]))
      const totalArea = tiles.reduce((sum, t) => sum + (t.w + 2 * PLATE_M) * (t.h + PLATE_TOP + PLATE_M), 0)
      const targetW = Math.max(1600, Math.sqrt(totalArea * 1.7))
      const all: Node[] = []
      let x = 0
      let y = 0
      let shelfH = 0
      for (const t of tiles) {
        const leftM = plateLeftMargin(gotoCount.get(t.scene) ?? 0)
        const plateW = t.w + leftM + PLATE_M
        const plateH = t.h + PLATE_TOP + PLATE_M
        if (x > 0 && x + plateW > targetW) {
          x = 0
          y += shelfH + PLATE_GAP
          shelfH = 0
        }
        const hue = (sceneOrder.get(t.scene)! * 47) % 360
        const bgId = `bg::${t.scene}`
        all.push({
          id: bgId,
          type: 'scenebg',
          position: { x, y },
          data: {
            g: { id: bgId, kind: 'scenehead', title: t.scene, startLine: 0, endLine: 0, ownScene: t.scene },
            highlightLine: null,
            hue,
            ctx,
            onResizeEnd: () => {}
          } as NodeData,
          width: plateW,
          height: plateH,
          draggable: true,
          dragHandle: '.scenebg-grab',
          selectable: false,
          focusable: false,
          className: 'scenebg-plate',
          style: {
            background: `hsl(${hue} 45% 45% / 0.09)`,
            border: `1.5px solid hsl(${hue} 55% 60% / 0.35)`,
            borderRadius: 14
          },
          zIndex: -1
        })
        // Title gateway: a child object floating ABOVE the edge layer, so
        // incoming paths pass UNDER the scene name — positioned over the
        // ENTRY node (the first statement is always under the scene name).
        const headW = Math.max(t.scene.length * 16 + 56, (inCount.get(t.scene) ?? 0) * GATE_SEP + 48)
        const entryAbsX = leftM + t.entryCx
        const headX = Math.min(Math.max(entryAbsX - headW / 2, 8), Math.max(8, plateW - headW - 8))
        sceneGate.set(t.scene, (headX + headW / 2) / plateW)
        all.push({
          id: `head::${t.scene}`,
          type: 'scenehead',
          parentId: bgId,
          position: { x: headX, y: -4 },
          data: {
            g: { id: `head::${t.scene}`, kind: 'scenehead', title: t.scene, startLine: 0, endLine: 0, ownScene: t.scene },
            highlightLine: null,
            hue,
            gateCount: inCount.get(t.scene) ?? 0,
            ctx,
            onResizeEnd: () => {}
          } as NodeData,
          width: headW,
          height: 46,
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: 10
        })
        for (const n of t.body) {
          all.push({
            ...n,
            parentId: bgId,
            position: { x: leftM + n.position.x, y: PLATE_TOP + n.position.y }
          })
        }
        x += plateW + PLATE_GAP
        shelfH = Math.max(shelfH, plateH)
      }

      // Cross-scene edge metadata: exits ordered along the source plate's
      // bottom (matching the source nodes' left-to-right order), gateways
      // spread across the target's title. Fractions/offsets survive drags.
      const cross = new Map<string, CrossMeta>()
      const byId = new Map(all.map((n) => [n.id, n]))
      const ownOf = new Map<string, string>()
      for (const n of gg.nodes) if (n.kind !== 'scenehead' && n.ownScene) ownOf.set(n.id, n.ownScene)
      const absX = (id: string): number => {
        const n = byId.get(id)
        if (!n) return 0
        const plate = n.parentId ? byId.get(n.parentId) : undefined
        return (plate?.position.x ?? 0) + n.position.x + sizeOf(n).w / 2
      }
      const crossEdges = gg.edges.filter((e) => {
        const so = ownOf.get(e.source)
        const to = ownOf.get(e.target)
        return !!so && !!to && so !== to
      })
      const bySrcScene = new Map<string, typeof crossEdges>()
      const byTgtScene = new Map<string, typeof crossEdges>()
      for (const e of crossEdges) {
        const so = ownOf.get(e.source)!
        const to = ownOf.get(e.target)!
        bySrcScene.set(so, [...(bySrcScene.get(so) ?? []), e])
        byTgtScene.set(to, [...(byTgtScene.get(to) ?? []), e])
      }
      // Exits sit directly under their source nodes (order preserved, minimum
      // 26px apart) instead of spreading evenly — no swing-left-come-back.
      const exitFracs = new Map<string, number>()
      const exitLanes = new Map<string, number>()
      for (const [so, list] of bySrcScene) {
        const plate = byId.get(`bg::${so}`)
        if (!plate) continue
        const px = plate.position.x
        const pw = plate.width ?? 300
        const sorted = [...list].sort((a, b) => absX(a.source) - absX(b.source))
        let prev = -Infinity
        const xs: number[] = []
        for (const e of sorted) {
          const desired = Math.min(Math.max(absX(e.source), px + 30), px + pw - 30)
          const x = Math.max(desired, prev + 26)
          xs.push(x)
          prev = x
        }
        const overflow = Math.max(0, (xs[xs.length - 1] ?? 0) - (px + pw - 30))
        sorted.forEach((e, i) => {
          exitFracs.set(e.id, (xs[i] - overflow - px) / pw)
          exitLanes.set(e.id, (i % 6) * 8)
        })
      }
      for (const [to, list] of byTgtScene) {
        const sorted = [...list].sort((a, b) => absX(a.source) - absX(b.source))
        const plate = byId.get(`bg::${to}`)
        if (plate) (plate.data as NodeData).gateCount = sorted.length
        sorted.forEach((e, gi) => {
          cross.set(e.id, {
            srcId: e.source,
            tgtId: e.target,
            srcPlate: `bg::${ownOf.get(e.source)!}`,
            tgtPlate: `bg::${to}`,
            exitFrac: exitFracs.get(e.id) ?? 0.5,
            gateFrac: sceneGate.get(to) ?? 0.5,
            gateOff: (gi - (sorted.length - 1) / 2) * GATE_SEP,
            laneOut: exitLanes.get(e.id) ?? 0,
            laneIn: (gi % 6) * 8
          })
        })
      }
      return { nodes: all, cross }
    },
    [toRf, toRfEdge]
  )

  // Resolve special-edge waypoints (cross-scene gateways + in-scene *goto
  // channels) against the CURRENT plate/node positions — works after drags,
  // not just after packing.
  const routeAllCross = useCallback((nds: Node[], eds: Edge[]): Edge[] => {
    const meta = crossRef.current
    const gotos = gotoRef.current
    const byId = new Map(nds.map((n) => [n.id, n]))
    const plates = nds.filter((n) => n.type === 'scenebg')
    let bx1 = Infinity
    let by1 = Infinity
    let bx2 = -Infinity
    let by2 = -Infinity
    for (const p of plates.length ? plates : nds) {
      const { w, h } = sizeOf(p)
      bx1 = Math.min(bx1, p.position.x)
      by1 = Math.min(by1, p.position.y)
      bx2 = Math.max(bx2, p.position.x + w)
      by2 = Math.max(by2, p.position.y + h)
    }
    const bounds: Rect = { x: bx1, y: by1, w: bx2 - bx1, h: by2 - by1 }
    const rectOf = (id: string): Rect | null => {
      const p = byId.get(id)
      return p ? { x: p.position.x, y: p.position.y, w: p.width ?? 300, h: p.height ?? 200 } : null
    }
    // Absolute top-centre / bottom-centre of a (possibly plate-parented) node.
    const anchor = (id: string, side: 'top' | 'bottom'): Pt | null => {
      const n = byId.get(id)
      if (!n) return null
      const plate = n.parentId ? byId.get(n.parentId) : undefined
      const ox = plate?.position.x ?? 0
      const oy = plate?.position.y ?? 0
      const { w, h } = sizeOf(n)
      return { x: ox + n.position.x + w / 2, y: oy + n.position.y + (side === 'bottom' ? h : 0) }
    }
    // Obstacle rects per plate (children in absolute coords) for gutter checks.
    const plateObstacles = new Map<string, { id: string; r: Rect }[]>()
    const obstaclesOf = (plateId: string): { id: string; r: Rect }[] => {
      let list = plateObstacles.get(plateId)
      if (!list) {
        const plate = byId.get(plateId)
        list = plate
          ? nds
              .filter((n) => n.parentId === plateId && n.type !== 'scenehead')
              .map((n) => {
                const { w, h } = sizeOf(n)
                return { id: n.id, r: { x: plate.position.x + n.position.x, y: plate.position.y + n.position.y, w, h } }
              })
          : []
        plateObstacles.set(plateId, list)
      }
      return list
    }
    const routed = eds.map((e) => {
      const m = meta.get(e.id)
      if (m) {
        const sp = rectOf(m.srcPlate)
        const tp = rectOf(m.tgtPlate)
        const srcPt = anchor(m.srcId, 'bottom')
        const tgtPt = anchor(m.tgtId, 'top')
        if (!sp || !tp || !srcPt) return e
        const exitX = sp.x + m.exitFrac * sp.w
        // Leave straight DOWN from the node's connection point, then sideways
        // into a clear gutter (side = whichever way the exit lies), then down.
        const stripY = sp.y + sp.h - 14
        const outY = srcPt.y + 12 + (m.laneOut % 4) * 5
        const kids = obstaclesOf(m.srcPlate)
        const srcNode = byId.get(m.srcId)
        const srcW = srcNode ? sizeOf(srcNode).w : 260
        const obstacles = kids.filter((k) => k.id !== m.srcId).map((k) => k.r)
        // Prefer a STRAIGHT DROP when the exit sits under the source and the
        // corridor beneath it is clear; only detour to a gutter when blocked.
        const dropClear =
          Math.abs(exitX - srcPt.x) < 24 &&
          !obstacles.some((r) => srcPt.x + 5 > r.x && srcPt.x - 5 < r.x + r.w && stripY > r.y && srcPt.y < r.y + r.h)
        let gutterX: number | null = null
        if (!dropClear) {
          const dir: -1 | 1 = exitX >= srcPt.x ? 1 : -1
          const start = srcPt.x + dir * (srcW / 2 + 14 + (m.laneOut % 4) * 6)
          gutterX =
            findGutter(obstacles, start, dir, outY, stripY) ??
            findGutter(obstacles, srcPt.x - dir * (srcW / 2 + 14), -dir as -1 | 1, outY, stripY)
        }
        // Corridor must clear the whole SHELF: taller neighbours extend below
        // the source plate, so use the row's deepest bottom.
        let shelfBottom = sp.y + sp.h
        for (const p of plates) {
          if (Math.abs(p.position.y - sp.y) < 30) {
            shelfBottom = Math.max(shelfBottom, p.position.y + (p.height ?? 200))
          }
        }
        const pts = routeCross(
          srcPt,
          sp,
          tp,
          exitX,
          tp.x + m.gateFrac * tp.w + m.gateOff,
          { out: m.laneOut, in: m.laneIn },
          bounds,
          PLATE_GAP,
          tgtPt
            ? { chanX: tp.x + 14 + (m.laneIn % 4) * 7, stripY: tp.y + PLATE_TOP - 16, tgt: tgtPt }
            : undefined,
          gutterX != null ? { gutterX, outY } : undefined,
          shelfBottom
        )
        return { ...e, data: { ...e.data, points: pts } }
      }
      const gm = gotos.get(e.id)
      if (gm) {
        const srcPt = anchor(gm.srcId, 'bottom')
        const tgtPt = anchor(gm.tgtId, 'top')
        if (!srcPt || !tgtPt) return e
        if (gm.mode === 'gutter') {
          // Wrapped-row choice→option: run down the aligned grid gutter just
          // left of the target's column instead of plunging through rows.
          const tgtN = byId.get(gm.tgtId)
          const tw = tgtN ? sizeOf(tgtN).w : 260
          const chanX = tgtPt.x - tw / 2 - 12 - (gm.lane % 3) * 6
          return { ...e, data: { ...e.data, points: routeInterior(srcPt, tgtPt, chanX, gm.lane) } }
        }
        // Try a direct step first: down, across, down — used whenever nothing
        // is in the way (kills pointless left-channel loops for near jumps).
        const obs = gm.plate
          ? obstaclesOf(gm.plate)
              .filter((k) => k.id !== gm.srcId && k.id !== gm.tgtId)
              .map((k) => k.r)
          : nds
              .filter((n) => n.type !== 'scenebg' && n.type !== 'scenehead' && n.id !== gm.srcId && n.id !== gm.tgtId)
              .map((n) => {
                const { w, h } = sizeOf(n)
                return { x: n.position.x, y: n.position.y, w, h }
              })
        const outY = srcPt.y + 10 + (gm.lane % 4) * 5
        if (tgtPt.y - 14 > outY) {
          const cand: Pt[] = [
            srcPt,
            { x: srcPt.x, y: outY },
            { x: tgtPt.x, y: outY },
            { x: tgtPt.x, y: tgtPt.y }
          ]
          if (!obs.some((r) => pathHitsRect(cand, r))) {
            return { ...e, data: { ...e.data, points: cand } }
          }
        }
        const plate = gm.plate ? rectOf(gm.plate) : null
        const slots = Math.max(1, gm.slots)
        const chanX = plate ? plate.x + 12 + (gm.lane % slots) * 8 : bounds.x - 24 - (gm.lane % Math.min(slots, 8)) * 10
        return { ...e, data: { ...e.data, points: routeInterior(srcPt, tgtPt, chanX, gm.lane) } }
      }
      return e
    })

    // Convergence trunks: same-looking plain edges entering one node share a
    // bus above the target and a single final drop, so a choice tree's fan-in
    // reads as one merged path instead of a parallel bundle. Skipped under ELK
    // (its router owns plain-edge paths in scene view).
    if (engineRef.current === 'elk' && !gameModeRef.current) return routed
    const obstaclesForPlain = (src: string, tgt: string): Rect[] => {
      const t = byId.get(tgt)
      return t?.parentId
        ? obstaclesOf(t.parentId)
            .filter((k) => k.id !== src && k.id !== tgt)
            .map((k) => k.r)
        : nds
            .filter((n) => n.type !== 'scenebg' && n.type !== 'scenehead' && n.id !== src && n.id !== tgt)
            .map((n) => {
              const { w, h } = sizeOf(n)
              return { x: n.position.x, y: n.position.y, w, h }
            })
    }
    const fans = new Map<string, number[]>()
    routed.forEach((e, i) => {
      if (meta.has(e.id) || gotos.has(e.id)) return
      const key = `${e.target}|${String(e.data?.color)}|${String(e.data?.dash ?? '')}`
      fans.set(key, [...(fans.get(key) ?? []), i])
    })
    for (const [, idxs] of fans) {
      const tgtPt = idxs.length > 1 ? anchor(routed[idxs[0]].target, 'top') : null
      const srcPts = tgtPt ? idxs.map((i) => anchor(routed[i].source, 'bottom')) : []
      const merged =
        tgtPt && srcPts.every((p): p is Pt => !!p)
          ? routeTrunk(
              srcPts,
              tgtPt,
              idxs.map((i) => obstaclesForPlain(routed[i].source, routed[i].target))
            )
          : idxs.map(() => null)
      idxs.forEach((ei, k) => {
        const e = routed[ei]
        const pts = merged[k]
        if (pts) routed[ei] = { ...e, type: 'crossing', data: { ...e.data, points: pts, merged: true } }
        else if (e.data?.merged) {
          // Previously merged, no longer valid (drag/solo) → back to smoothstep.
          routed[ei] = { ...e, type: 'cased', data: { ...e.data, points: undefined, merged: undefined } }
        }
      })
    }
    return routed
  }, [])

  // ELK trial pass (scene view): re-lay nodes with measured sizes and adopt
  // ELK's routed orthogonal edge paths verbatim.
  const elkPass = useCallback(() => {
    if (gameModeRef.current) return
    const nds = nodesRef.current
    const sizes = new Map<string, { w: number; h: number }>()
    for (const n of nds) {
      if (n.measured?.width && n.measured?.height) sizes.set(n.id, { w: n.measured.width, h: n.measured.height })
    }
    void layoutWithElk(nds, edgesRef.current, sizes.size ? sizes : undefined).then(({ nodes: laid, routes }) => {
      if (gameModeRef.current || engineRef.current !== 'elk') return // stale
      setNodes(laid)
      setEdges((eds) =>
        eds.map((e) => {
          const r = routes.get(e.id)
          return r ? { ...e, type: 'crossing', data: { ...e.data, points: r } } : e
        })
      )
    })
  }, [setNodes, setEdges])
  elkPassRef.current = elkPass

  // Engine switch: ELK runs its pass; back to standard rebuilds fresh.
  useEffect(() => {
    if (gameMode) return
    if (engine === 'elk') {
      elkPass()
    } else {
      shapeChanged.current = true
      setNodes(built.nodes)
      setEdges(built.edges)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // Belt-and-suspenders: re-hug every plate to its ACTUALLY RENDERED children
  // (measured heights), regardless of what the stitch estimated. Runs after
  // the measured re-stitch settles; guarantees nothing overflows its plate.
  const refitAllPlates = useCallback(() => {
    if (!gameModeRef.current) return
    setNodes((nds) => {
      const plates = nds.filter((n) => n.type === 'scenebg')
      if (!plates.length) return nds
      const resize = new Map<string, { w: number; h: number }>()
      for (const plate of plates) {
        const kids = nds.filter((n) => n.parentId === plate.id && n.type !== 'scenehead')
        if (!kids.length) continue
        let maxX = -Infinity
        let maxY = -Infinity
        for (const k of kids) {
          const { w, h } = sizeOf(k)
          maxX = Math.max(maxX, k.position.x + w)
          maxY = Math.max(maxY, k.position.y + h)
        }
        const w = Math.max(280, maxX + PLATE_M)
        const h = maxY + PLATE_M
        if (Math.abs(w - (plate.width ?? 0)) > 2 || Math.abs(h - (plate.height ?? 0)) > 2) {
          resize.set(plate.id, { w, h })
        }
      }
      if (!resize.size) return nds
      return nds.map((n) => {
        const r = resize.get(n.id)
        // Only the plate resizes; the title stays put (it sits over the entry).
        return r ? { ...n, width: r.w, height: r.h } : n
      })
    })
    setTimeout(() => setEdges((eds) => routeAllCross(nodesRef.current, eds)), 0)
  }, [setNodes, setEdges, routeAllCross])

  const built = useMemo(() => {
    if (gameMode && files) {
      const gg = buildGameGraph(files, sceneList)
      ggRef.current = gg
      const st = stitchGame(gg)
      crossRef.current = st.cross
      // In-scene *goto jumps take the plate's left channel (never over nodes).
      const gotos = new Map<string, GotoMeta>()
      const laneBy = new Map<string, number>()
      // Gotos CONVERGING on one target share a lane: identical channel +
      // approach waypoints collapse the fan-in into a single visible trunk.
      const laneOfTgt = new Map<string, number>()
      for (const e of gg.edges) {
        if (e.kind !== 'goto' || st.cross.has(e.id)) continue
        const owner = e.source.split('::')[0]
        let lane = laneOfTgt.get(e.target)
        if (lane == null) {
          lane = laneBy.get(owner) ?? 0
          laneBy.set(owner, lane + 1)
          laneOfTgt.set(e.target, lane)
        }
        gotos.set(e.id, { srcId: e.source, tgtId: e.target, plate: `bg::${owner}`, lane, slots: 0 })
      }
      for (const m of gotos.values()) m.slots = Math.min(laneBy.get(m.plate!.slice(4)) ?? 1, 10)
      // Wrapped-row choice→option connectors route via the grid gutters.
      const fans = new Map<string, typeof gg.edges>()
      for (const e of gg.edges) {
        if (e.kind === 'option') fans.set(e.source, [...(fans.get(e.source) ?? []), e])
      }
      for (const [choiceId, list] of fans) {
        if (list.length <= GRID_COLS) continue
        list.forEach((e, i) => {
          if (i < GRID_COLS) return
          gotos.set(e.id, {
            srcId: e.source,
            tgtId: e.target,
            plate: `bg::${choiceId.split('::')[0]}`,
            lane: i - GRID_COLS,
            slots: 3,
            mode: 'gutter'
          })
        })
      }
      gotoRef.current = gotos
      // Cross-scene edges become gateway edges: they leave through the source
      // plate's bottom and terminate at the target plate's title.
      const rfEdges = assignEdgeOffsets(gg.edges.map(toRfEdge)).map((e) => {
        const m = st.cross.get(e.id)
        if (m) return { ...e, type: 'crossing', target: m.tgtPlate, targetHandle: 'gate' }
        return gotos.has(e.id) ? { ...e, type: 'crossing' } : e
      })
      return { nodes: st.nodes, edges: routeAllCross(st.nodes, rfEdges) }
    }
    ggRef.current = null
    crossRef.current = new Map()
    const ast = parseScene(text)
    ctx.current.ast = ast
    const g = buildChoiceGraph(ast)
    const rawNodes = g.nodes.map(toRf)
    const gotos = new Map<string, GotoMeta>()
    // Same-target gotos share a lane so the fan-in merges into one trunk.
    let lane = 0
    const laneOfTgt = new Map<string, number>()
    for (const e of g.edges) {
      if (e.kind !== 'goto') continue
      let l = laneOfTgt.get(e.target)
      if (l == null) {
        l = lane++
        laneOfTgt.set(e.target, l)
      }
      gotos.set(e.id, { srcId: e.source, tgtId: e.target, plate: null, lane: l, slots: 0 })
    }
    for (const m of gotos.values()) m.slots = Math.min(Math.max(lane, 1), 10)
    const fans = new Map<string, typeof g.edges>()
    for (const e of g.edges) {
      if (e.kind === 'option') fans.set(e.source, [...(fans.get(e.source) ?? []), e])
    }
    for (const [, list] of fans) {
      if (list.length <= GRID_COLS) continue
      list.forEach((e, i) => {
        if (i < GRID_COLS) return
        gotos.set(e.id, { srcId: e.source, tgtId: e.target, plate: null, lane: i - GRID_COLS, slots: 3, mode: 'gutter' })
      })
    }
    gotoRef.current = gotos
    const rawEdges = assignEdgeOffsets(g.edges.map(toRfEdge)).map((e) =>
      gotos.has(e.id) ? { ...e, type: 'crossing' } : e
    )
    const laid = layoutWith(rawNodes, rawEdges)
    return { nodes: laid, edges: routeAllCross(laid, rawEdges) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, text, gameMode, gameMode ? files : null])

  // Rebuilds preserve positions when the graph SHAPE is unchanged (field
  // edits, label renames) — so manual drags and click-placements stick. Only
  // structural changes (add/delete/reorder) trigger a fresh auto-layout.
  const prevShape = useRef<{ scene: string; ids: string } | null>(null)
  const shapeChanged = useRef(true)
  useEffect(() => {
    const ids = built.nodes.map((n) => n.id).join(',')
    const preserve = prevShape.current?.scene === scene && prevShape.current?.ids === ids
    prevShape.current = { scene, ids }
    shapeChanged.current = !preserve
    setNodes((old) => {
      if (preserve) {
        const pos = new Map(old.map((n) => [n.id, n.position]))
        return built.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }))
      }
      // Structural rebuild: show the click-placement immediately (the measured
      // re-layout consumes pendingPlace for the final position).
      const place = pendingPlace.current
      if (place) {
        const target = findPlaceTarget(built.nodes, place.line0)
        if (target) {
          return built.nodes.map((n) =>
            n.id === target ? { ...n, position: { x: place.x, y: place.y } } : n
          )
        }
      }
      return built.nodes
    })
    setEdges(built.edges)
  }, [built, scene, setNodes, setEdges])

  // After the DOM measures real node sizes, re-run the layout with them so
  // nothing overlaps or clips (or overflows its plate) — but only when the
  // shape actually changed.
  const nodesInitialized = useNodesInitialized()
  useEffect(() => {
    if (!nodesInitialized || !shapeChanged.current) return
    const t = setTimeout(() => {
      if (!shapeChanged.current) return
      // Nodes are laid out FIRST with real measured sizes; plates are then
      // drawn around them. If measurement isn't complete yet, keep the flag
      // set — this effect re-fires when nodesInitialized flips again.
      const nds = nodesRef.current
      const sizes = new Map<string, { w: number; h: number }>()
      for (const n of nds) {
        if (n.measured?.width && n.measured?.height) {
          sizes.set(n.id, { w: n.measured.width, h: n.measured.height })
        }
      }
      if (sizes.size < nds.length) return // not fully measured — try again later
      shapeChanged.current = false
      if (gameModeRef.current) {
        const gg = ggRef.current
        if (gg) {
          const st = stitchGame(gg, sizes)
          crossRef.current = st.cross
          setNodes(st.nodes)
          setEdges((eds) => routeAllCross(st.nodes, eds))
          // Final guarantee pass once the restitched nodes have rendered.
          setTimeout(() => refitAllPlates(), 300)
        }
      } else {
        relayout(true)
      }
    }, 60)
    return () => clearTimeout(t)
  }, [nodesInitialized, built, relayout, stitchGame, routeAllCross, refitAllPlates, setNodes, setEdges])

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const own = ((n.data as NodeData | undefined)?.g as { ownScene?: string } | undefined)?.ownScene
        return { ...n, data: { ...n.data, highlightLine: !own || own === scene ? highlightLine : null } }
      })
    )
  }, [highlightLine, scene, setNodes])

  // Selection tracing: the picked node/plate gets an outline, every path in or
  // out of it lights up, and everything else dims so routes are followable.
  useEffect(() => {
    const sel = selId
    const isPlate = !!sel && (sel.startsWith('bg::') || sel.startsWith('head::'))
    const plateScene = isPlate ? sel!.slice(sel!.indexOf('::') + 2) : null
    const inSel = (endpoint: string): boolean => {
      if (!sel) return false
      if (isPlate) return endpoint.startsWith(`${plateScene}::`) || endpoint === `bg::${plateScene}`
      return endpoint === sel
    }
    setEdges((eds) =>
      eds.map((e) => {
        const hl = !!sel && (inSel(e.source) || inSel(e.target))
        return { ...e, data: { ...e.data, hl, dim: !!sel && !hl } }
      })
    )
    setNodes((nds) =>
      nds.map((n) => {
        const hit =
          sel != null &&
          (n.id === sel || (isPlate && (n.id === `bg::${plateScene}` || n.id === `head::${plateScene}`)))
        const base = (n.className ?? '').replace(/\s*sel-node/g, '')
        const cls = hit ? `${base} sel-node`.trim() : base
        return cls === (n.className ?? '') ? n : { ...n, className: cls }
      })
    )
  }, [selId, built, setEdges, setNodes])

  // Re-tint edge widths when the zoom bucket changes.
  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({ ...e, data: { ...e.data, w: edgeW } })))
  }, [edgeW, setEdges])

  // LOD flip: force node re-render so static/live rendering follows the zoom.
  useEffect(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, lod: gameMode && lod } })))
  }, [lod, gameMode, setNodes])

  // Re-colour option edges when the custom palette changes.
  useEffect(() => {
    setEdges((eds) =>
      eds.map((e) =>
        (e.data as { kind?: string } | undefined)?.kind === 'option'
          ? { ...e, data: { ...e.data, color: colors.option } }
          : e
      )
    )
  }, [colors.option, setEdges])

  // Drag-to-connect: dropping a connection writes the *goto / *goto_scene
  // (auto-labelling the target when needed).
  const onConnect = useCallback(
    (conn: Connection) => {
      const find = (nid: string | null): GNode | undefined =>
        nid ? (nodesRef.current.find((n) => n.id === nid)?.data as NodeData | undefined)?.g : undefined
      const src = find(conn.source)
      const tgt = find(conn.target)
      if (!src || !tgt) return
      const srcOwn = (src as { ownScene?: string }).ownScene
      const tgtOwn = (tgt as { ownScene?: string }).ownScene
      if (gameModeRef.current && srcOwn && tgtOwn && srcOwn !== tgtOwn) {
        // Cross-scene drag: write *goto_scene <scene> [label] into the source
        // scene, auto-labelling the drop target in the destination scene.
        const gg = ggRef.current
        const srcAst = gg?.asts[srcOwn]
        const tgtAst = gg?.asts[tgtOwn]
        if (!srcAst || !tgtAst) return
        if (connectAcross(srcAst, tgtAst, src, tgt, tgtOwn, ctx.current.unit)) {
          onEditScene(tgtOwn, generateScene(tgtAst))
          onEditScene(srcOwn, generateScene(srcAst))
        }
        return
      }
      ctx.current.commit(() => connectNodes(ctx.current.astFor(srcOwn), src, tgt, ctx.current.unit), srcOwn)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // After dragging a node inside a scene plate, re-fit the plate to its
  // children (grow or shrink) while keeping every node visually in place.
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      // Any drag invalidates routed waypoints (gateways + goto channels) —
      // re-route once the node state has settled.
      setTimeout(() => setEdges((eds) => routeAllCross(nodesRef.current, eds)), 0)
      if (!gameModeRef.current || !node.parentId) return
      setNodes((nds) => {
        const plate = nds.find((n) => n.id === node.parentId)
        if (!plate) return nds
        const kids = nds.filter((n) => n.parentId === plate.id && n.type !== 'scenehead')
        if (!kids.length) return nds
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const k of kids) {
          const { w, h } = sizeOf(k)
          minX = Math.min(minX, k.position.x)
          minY = Math.min(minY, k.position.y)
          maxX = Math.max(maxX, k.position.x + w)
          maxY = Math.max(maxY, k.position.y + h)
        }
        // Children should sit at (PLATE_M, PLATE_TOP) within the plate.
        const dx = minX - PLATE_M
        const dy = minY - PLATE_TOP
        const w = Math.max(240, maxX - minX) + 2 * PLATE_M
        const h = maxY - minY + PLATE_TOP + PLATE_M
        return nds.map((n) => {
          if (n.id === plate.id) {
            return {
              ...n,
              position: { x: plate.position.x + dx, y: plate.position.y + dy },
              width: w,
              height: h
            }
          }
          if (n.parentId === plate.id) {
            // The title moves with everything else (it sits over the entry).
            return { ...n, position: { x: n.position.x - dx, y: n.position.y - dy } }
          }
          return n
        })
      })
    },
    [setNodes, setEdges, routeAllCross]
  )

  // Multi-select clipboard: Ctrl+C copies the selected nodes AS CHOICESCRIPT
  // TEXT, Ctrl+V pastes clipboard text as a new island, Delete removes the
  // selected statements. (Shift-drag box-selects; Ctrl-click adds.)
  const onCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      const sel = nodesRef.current.filter(
        (n) => n.selected && n.type !== 'scenebg' && n.type !== 'scenehead' && n.type !== 'stub'
      )
      const stmtsOf = (g: GNode): AstNode[] =>
        g.kind === 'content'
          ? [...new Set(g.rows.filter((r) => r.depth === 0).map((r) => r.node))]
          : g.kind === 'choice' || g.kind === 'option'
            ? [g.node]
            : []
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!sel.length) return
        const textOut = sel
          .flatMap((n) => stmtsOf((n.data as NodeData).g))
          .map((s) => generateScene([s]))
          .join('\n')
        if (textOut) void navigator.clipboard.writeText(textOut)
        e.preventDefault()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        void navigator.clipboard.readText().then((clip) => {
          if (!clip.trim()) return
          const parsed = parseScene(clip)
          if (!parsed.length) return
          ctx.current.commit(() => {
            const ast = ctx.current.astFor(undefined)
            const name = freshLabel(ast, 'island')
            ast.push({ type: 'command', name: 'label', raw: `*label ${name}` })
            ast.push(...parsed)
          })
        })
      } else if (e.key === 'Delete') {
        if (!sel.length) return
        e.preventDefault()
        const byScene = new Map<string | undefined, GNode[]>()
        for (const n of sel) {
          const g = (n.data as NodeData).g
          const own = (g as { ownScene?: string }).ownScene
          byScene.set(own, [...(byScene.get(own) ?? []), g])
        }
        for (const [own, gs] of byScene) {
          ctx.current.commit(() => {
            const ast = ctx.current.astFor(own)
            for (const g of gs) for (const s of stmtsOf(g)) removeNode(ast, s)
          }, own)
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Export the visible graph (scene or whole game) as an image poster.
  // Destination is picked FIRST (native save dialog), then the capture runs;
  // the file's extension decides PNG vs JPEG. Failures are shown, not eaten.
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportQuality, setExportQuality] = useState<'low' | 'medium' | 'high'>('medium')
  const exportQualityRef = useRef(exportQuality)
  exportQualityRef.current = exportQuality
  /** Raster size cap + max flow-unit scale per quality preset. */
  const QUALITY = {
    low: { cap: 2048, maxScale: 0.5 }, // fast wide overview
    medium: { cap: 4096, maxScale: 1.25 },
    high: { cap: 8192, maxScale: 2 } // crisp text up close
  } as const
  const exportImage = useCallback(
    async (fmt: 'png' | 'jpeg') => {
      if (exporting) return
      const base = `${gameModeRef.current ? 'whole-game' : scene}-graph.${fmt === 'png' ? 'png' : 'jpg'}`
      const filePath = await window.cside.exportImagePath(base)
      if (!filePath) return // cancelled
      const useJpeg = /\.jpe?g$/i.test(filePath)
      setExporting(true)
      // Live elapsed ticker + current stage, so long captures read as WORKING.
      const started = Date.now()
      const stageRef = { current: 'preparing' }
      const stamp = (): void =>
        setExportMsg(`Exporting: ${stageRef.current} — ${Math.round((Date.now() - started) / 1000)}s`)
      const setStage = (s: string): void => {
        stageRef.current = s
        stamp()
      }
      setStage('rendering full graph')
      const tick = setInterval(stamp, 500)
      // While exporting, viewport culling is disabled (see the
      // onlyRenderVisibleElements prop) — wait for the FULL graph to render
      // into the DOM before capturing, or off-screen plates would be missing.
      await new Promise((r) => setTimeout(r, 450))
      try {
        const el = wrapRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null
        if (!el) throw new Error('canvas not ready')
        const baseFilter = (node: HTMLElement): boolean =>
          !node.classList ||
          (!node.classList.contains('react-flow__handle') &&
            !node.classList.contains('react-flow__resize-control') &&
            !node.classList.contains('an-actions'))

        let dataUrl: string
        if (gameModeRef.current) {
          // Whole game: render in PASSES — edges drawn as vectors, then each
          // scene captured separately and composited. Real progress, small
          // peak memory, no single giant rasterisation.
          const nds = nodesRef.current
          const bounds = getNodesBounds(nds)
          const pad = 48
          const q = QUALITY[exportQualityRef.current]
          const scale = Math.min(q.maxScale, q.cap / (bounds.width + pad * 2), q.cap / (bounds.height + pad * 2))
          const W = Math.round((bounds.width + pad * 2) * scale)
          const H = Math.round((bounds.height + pad * 2) * scale)
          const canvas = document.createElement('canvas')
          canvas.width = W
          canvas.height = H
          const cx = canvas.getContext('2d')
          if (!cx) throw new Error('no 2d context')
          cx.fillStyle = '#1e1e1e'
          cx.fillRect(0, 0, W, H)
          setStage('drawing connections')
          // Pass 1: edges as vectors (under the nodes).
          const byId = new Map(nds.map((n) => [n.id, n]))
          const abs = (id: string, side: 'top' | 'bottom'): Pt | null => {
            const n = byId.get(id)
            if (!n) return null
            const plate = n.parentId ? byId.get(n.parentId) : undefined
            const { w, h } = sizeOf(n)
            return {
              x: (plate?.position.x ?? 0) + n.position.x + w / 2,
              y: (plate?.position.y ?? 0) + n.position.y + (side === 'bottom' ? h : 0)
            }
          }
          cx.save()
          cx.translate((-bounds.x + pad) * scale, (-bounds.y + pad) * scale)
          cx.scale(scale, scale)
          cx.lineJoin = 'round'
          cx.lineCap = 'round'
          for (const e of edgesRef.current) {
            const data = (e.data ?? {}) as {
              points?: Pt[]
              color?: string
              dash?: string
              w?: number
              offset?: number
              kind?: string
            }
            const s = abs(e.source, 'bottom')
            if (!s) continue
            let d: string
            if (data.points?.length) {
              d = pointsToPath(data.points, 7)
            } else {
              const t = abs(e.target, 'top')
              if (!t) continue
              d = getSmoothStepPath({
                sourceX: s.x,
                sourceY: s.y,
                targetX: t.x,
                targetY: t.y,
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
                borderRadius: 10,
                offset: Math.max(4, Math.min(data.offset ?? 16, Math.abs(t.y - s.y) / 2 - 2))
              })[0]
            }
            const path = new Path2D(d)
            const lw = data.w ?? 4
            cx.setLineDash([])
            cx.strokeStyle = '#141414'
            cx.lineWidth = lw + 3
            cx.stroke(path)
            if (data.dash) cx.setLineDash(data.dash.split(' ').map(Number))
            cx.strokeStyle = data.color ?? '#8a8a8a'
            cx.lineWidth = lw
            cx.stroke(path)
            cx.setLineDash([])
            // Arrowheads only where the live view draws them (goto/scene
            // markers) — merged trunk edges are waypointed but arrow-free.
            if (data.points?.length && (data.kind === 'goto' || data.kind === 'scene')) {
              const pts = data.points
              const last = pts[pts.length - 1]
              const prev = pts[pts.length - 2] ?? s
              const ang = Math.atan2(last.y - prev.y, last.x - prev.x)
              const a = 8 + lw
              cx.fillStyle = data.color ?? '#8a8a8a'
              cx.beginPath()
              cx.moveTo(last.x, last.y)
              cx.lineTo(last.x - a * Math.cos(ang - 0.45), last.y - a * Math.sin(ang - 0.45))
              cx.lineTo(last.x - a * Math.cos(ang + 0.45), last.y - a * Math.sin(ang + 0.45))
              cx.closePath()
              cx.fill()
            }
          }
          cx.restore()
          // Pass 2..N: one capture per scene plate, composited into place.
          const plates = nds.filter((n) => n.type === 'scenebg')
          for (let i = 0; i < plates.length; i++) {
            const p = plates[i]
            setStage(`scene ${i + 1}/${plates.length} (${p.id.slice(4)})`)
            const keep = new Set([p.id, ...nds.filter((n) => n.parentId === p.id).map((n) => n.id)])
            const rw = Math.max(1, Math.round((p.width ?? 300) * scale))
            const rh = Math.max(1, Math.round((p.height ?? 200) * scale))
            const url = await toPng(el, {
              width: rw,
              height: rh,
              pixelRatio: 1,
              skipFonts: true,
              fontEmbedCSS: '',
              filter: (node: HTMLElement) => {
                if (!node.classList) return true
                if (node.classList.contains('react-flow__edges')) return false
                if (!baseFilter(node)) return false
                if (node.classList.contains('react-flow__node')) {
                  return keep.has(node.getAttribute('data-id') ?? '')
                }
                return true
              },
              style: {
                width: `${rw}px`,
                height: `${rh}px`,
                transform: `translate(${-p.position.x * scale}px, ${-p.position.y * scale}px) scale(${scale})`
              }
            })
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const im = new Image()
              im.onload = () => resolve(im)
              im.onerror = reject
              im.src = url
            })
            cx.drawImage(img, (p.position.x - bounds.x + pad) * scale, (p.position.y - bounds.y + pad) * scale)
          }
          setStage('encoding image')
          dataUrl = useJpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png')
        } else {
          const bounds = getNodesBounds(nodesRef.current)
          const q = QUALITY[exportQualityRef.current]
          const w = Math.min(q.cap, Math.max(1200, Math.round(bounds.width * q.maxScale)))
          const h = Math.min(q.cap, Math.max(800, Math.round((w * bounds.height) / Math.max(1, bounds.width))))
          const vp = getViewportForBounds(bounds, w, h, 0.02, 2, 0.04)
          const opts = {
            backgroundColor: '#1e1e1e',
            width: w,
            height: h,
            pixelRatio: 1, // don't multiply by devicePixelRatio — huge & slow
            skipFonts: true,
            fontEmbedCSS: '', // fully skip font inlining (stylesheet fetches hang)
            filter: baseFilter,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`
            }
          }
          dataUrl = useJpeg ? await toJpeg(el, { ...opts, quality: 0.92 }) : await toPng(el, opts)
        }
        setStage('saving file')
        await window.cside.exportImageWrite(filePath, dataUrl)
        clearInterval(tick)
        setExportMsg(`Saved ${filePath.split(/[\\/]/).pop()} (${Math.round((Date.now() - started) / 1000)}s)`)
      } catch (err) {
        clearInterval(tick)
        setExportMsg(`Export failed: ${(err as Error).message || err}`)
      } finally {
        clearInterval(tick)
        setExporting(false)
        setTimeout(() => setExportMsg(null), 8000)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, exporting]
  )

  // The AST node an "insert after" should anchor to for a given canvas node.
  const targetG = menu?.nodeId
    ? ((nodes.find((n) => n.id === menu.nodeId)?.data as NodeData | undefined)?.g ?? null)
    : null
  const tOwn = (targetG as { ownScene?: string } | null)?.ownScene
  const act = (fn: () => void) => () => {
    setMenu(null)
    fn()
  }
  const kindRow = (label: string, onPick: (k: InsertPick) => void) => (
    <div className="ctx-sec">
      <div className="ctx-label">{label}</div>
      <div className="ctx-kinds">
        {INSERT_KINDS.map((k) => (
          <button key={k.kind} className="ctx-kind" onClick={act(() => onPick(k.kind))}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div
      className={`beat-canvas ${gameMode && lod ? 'game-mode' : ''}`}
      ref={wrapRef}
      onKeyDown={onCanvasKeyDown}
      style={
        {
          '--c-text': colors.text,
          '--c-command': colors.command,
          '--c-choice': colors.choice,
          '--c-option': colors.option,
          '--c-if': colors.if
        } as CSSProperties
      }
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={null}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onMove={(_, vp) => {
          const w = vp.zoom >= 0.7 ? 2 : vp.zoom >= 0.35 ? 3 : 4
          if (w !== edgeWRef.current) setEdgeW(w)
          const l = vp.zoom < 0.55
          if (l !== lodRef.current) setLod(l)
        }}
        onPaneContextMenu={(e) => openMenu(e, null)}
        onNodeContextMenu={(e, n) => openMenu(e, n.id)}
        onPaneClick={() => {
          setMenu(null)
          setSelId(null)
        }}
        onNodeClick={(_, n) => {
          setMenu(null)
          // Click selects (toggling) — highlights the node/plate + its paths.
          // Double-click still opens a scene from whole-game view.
          setSelId((prev) => (prev === n.id ? null : n.id))
        }}
        onNodeDoubleClick={(_, n) => {
          if (!gameMode) return
          const g = (n.data as NodeData | undefined)?.g
          if (!g || g.kind === 'stub') return
          const own = (g as { ownScene?: string }).ownScene
          onJump(g.kind === 'scenehead' ? 0 : g.startLine, own)
          setGameMode(false)
        }}
        onMoveStart={() => setMenu(null)}
        // High threshold: culling also hides long PATHS whose endpoints are
        // off-screen (they'd vanish when zoomed in) — only worth it for maps
        // big enough that rendering everything actually chops.
        onlyRenderVisibleElements={gameMode && nodes.length > 800 && !exporting}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.02}
      >
        <Panel position="top-left">
          <div className="an-panel">
            <div className="an-indent">
              {files && (
                <label className="rf-toggle" data-tut="wholegame" style={{ border: 0, padding: 0, background: 'transparent' }}>
                  <input type="checkbox" checked={gameMode} onChange={(e) => setGameMode(e.target.checked)} />
                  Whole game
                </label>
              )}
              <button
                className="an-apply nodrag"
                title="Export this graph as a PNG image"
                disabled={exporting}
                onClick={() => void exportImage('png')}
              >
                {exporting ? 'Exporting…' : '⬇ PNG'}
              </button>
              <button
                className="an-apply nodrag"
                title="Export this graph as a JPEG image (smaller file)"
                disabled={exporting}
                onClick={() => void exportImage('jpeg')}
              >
                ⬇ JPG
              </button>
              <select
                className="nodrag"
                title="Export quality: Low = fast wide overview, High = crisp text up close"
                value={exportQuality}
                onChange={(e) => setExportQuality(e.target.value as 'low' | 'medium' | 'high')}
              >
                <option value="low">Low</option>
                <option value="medium">Med</option>
                <option value="high">High</option>
              </select>
            </div>
            {exportMsg && <div className="an-detected">{exportMsg}</div>}
            {!gameMode && (
            <button
              className="an-apply nodrag"
              title="Check this scene for problems (on demand — build freely first)"
              onClick={() => setReviewOpen((o) => !o)}
            >
              ⚑ Review{problems.length ? ` (${problems.length})` : ''}
            </button>
            )}
            {reviewOpen && !gameMode && (
              <div className="review-pop">
                {problems.length === 0 ? (
                  <div className="review-ok">No issues found — looks good!</div>
                ) : (
                  problems.map((p, i) => (
                    <button
                      key={i}
                      className={`review-item review-${p.severity}`}
                      title="Jump to this line in the code editor"
                      onClick={() => onJump(p.line)}
                    >
                      <span className="review-line">L{p.line + 1}</span> {p.message}
                    </button>
                  ))
                )}
              </div>
            )}
            {!gameMode && (
            <button
              className="an-apply nodrag"
              title="Declared variables (startup *create + this scene's *temp)"
              onClick={() => setVarsOpen((o) => !o)}
            >
              𝑥 Vars ({variables.length})
            </button>
            )}
            {varsOpen && !gameMode && (
              <div className="review-pop">
                {variables.map((v) => (
                  <div key={`${v.kind}:${v.name}`} className="var-item">
                    <span className={`var-kind var-${v.kind}`}>{v.kind === 'create' ? 'stat' : 'temp'}</span>
                    <span className="var-name">{v.name}</span>
                    <span className="var-value">{v.value}</span>
                  </div>
                ))}
                <div className="var-add">
                  <input
                    ref={newVarRef}
                    className="an-input nodrag"
                    placeholder="new variable name"
                    spellCheck={false}
                  />
                  <button
                    className="an-apply nodrag"
                    title={scene === 'startup' ? 'Add a *create stat' : 'Add a *temp for this scene'}
                    onClick={() => {
                      const name = newVarRef.current?.value.trim().toLowerCase()
                      if (!name || !/^[a-z_]\w*$/.test(name)) return
                      if (newVarRef.current) newVarRef.current.value = ''
                      const kind = scene === 'startup' ? 'create' : 'temp'
                      ctx.current.commit(() =>
                        ctx.current.ast.unshift({ type: 'command', name: kind, raw: `*${kind} ${name} 0` })
                      )
                    }}
                  >
                    + {scene === 'startup' ? '*create' : '*temp'}
                  </button>
                </div>
              </div>
            )}
            {onTypeColors && (
              <button className="an-apply nodrag" title="Customise node colours" onClick={() => setColorsOpen((o) => !o)}>
                🎨 Colors
              </button>
            )}
            {colorsOpen && onTypeColors && (
              <div className="review-pop">
                {(['text', 'command', 'choice', 'option', 'if'] as const).map((k) => (
                  <div key={k} className="var-item">
                    <span className="var-name">{k}</span>
                    <input
                      className="nodrag"
                      type="color"
                      value={colors[k]}
                      style={{ marginLeft: 'auto', width: 44, height: 22, border: 0, background: 'transparent' }}
                      onChange={(e) => onTypeColors({ [k]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="var-add">
                  <button
                    className="an-apply nodrag"
                    onClick={() =>
                      onTypeColors({ text: undefined, command: undefined, choice: undefined, option: undefined, if: undefined })
                    }
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            )}
            {!gameMode && (
            <label className="rf-toggle">
              <input
                type="checkbox"
                checked={reflowOnResize}
                onChange={(e) => setReflowOnResize(e.target.checked)}
              />
              Reflow on resize
            </label>
            )}
            {!gameMode && (
              <div className="an-indent">
                <span>Layout</span>
                <select
                  className="nodrag"
                  title="Layout engine — ELK routes edges around nodes (trial; switch back any time)"
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as 'dagre' | 'elk')}
                >
                  <option value="dagre">Standard</option>
                  <option value="elk">ELK (beta)</option>
                </select>
              </div>
            )}
            {!gameMode && (
            <div className="an-indent">
              <span>Indent</span>
              <select
                className="nodrag"
                value={indentStyle}
                onChange={(e) => onIndentChange({ indentStyle: e.target.value as 'tab' | 'space' })}
              >
                <option value="space">Spaces</option>
                <option value="tab">Tabs</option>
              </select>
              {indentStyle === 'space' && (
                <select
                  className="nodrag"
                  value={indentWidth}
                  onChange={(e) => onIndentChange({ indentWidth: Number(e.target.value) })}
                >
                  {[2, 3, 4, 8].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              )}
              <button className="an-apply nodrag" title="Reformat this scene" onClick={onNormalize}>
                Apply
              </button>
              <span className="an-detected">
                scene: {detected.style === 'tab' ? 'tabs' : `${detected.width}-space`}
              </span>
            </div>
            )}
          </div>
        </Panel>
        <Background color="#333" gap={20} />
        <MiniMap pannable zoomable style={{ background: '#252526' }} />
        <Controls />
      </ReactFlow>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {!targetG && (
            <>
              {kindRow(menu.sceneAt ? `Add to ${menu.sceneAt} (unconnected)` : 'Add here (unconnected)', (k) => {
                // Spawns a disconnected "island": an auto-labelled section at
                // the end of the scene's code, placed where clicked, with NO
                // incoming flow edge — the author wires it up by dragging a
                // connection when ready.
                const made = makeFor(k, '', ctx.current.unit)
                if (!made) return
                if (!gameModeRef.current) {
                  const fp = screenToFlowPosition({ x: menu.clientX, y: menu.clientY })
                  pendingPlace.current = { x: fp.x, y: fp.y, line0: text.split(/\r?\n/).length }
                }
                const own = menu.sceneAt
                ctx.current.commit(() => {
                  const ast = ctx.current.astFor(own)
                  const name = freshLabel(ast, 'island')
                  ast.push({ type: 'command', name: 'label', raw: `*label ${name}` })
                  ast.push(...made)
                }, own)
              })}
              {onNewScene && (
                <button
                  className="ctx-item"
                  onClick={act(() => {
                    const name = window.prompt('New scene name (letters, numbers, _ or -):')?.trim().toLowerCase()
                    if (!name) return
                    if (!/^[\w-]+$/.test(name)) return
                    if (!gameModeRef.current) {
                      const fp = screenToFlowPosition({ x: menu.clientX, y: menu.clientY })
                      pendingPlace.current = { x: fp.x, y: fp.y, line0: text.split(/\r?\n/).length }
                    }
                    onNewScene(name)
                    const own = menu.sceneAt
                    // An island jumping to the new scene → clickable stub here.
                    ctx.current.commit(() => {
                      const ast = ctx.current.astFor(own)
                      const label = freshLabel(ast, 'island')
                      ast.push({ type: 'command', name: 'label', raw: `*label ${label}` })
                      ast.push({ type: 'command', name: 'goto_scene', raw: `*goto_scene ${name}` })
                    }, own)
                  })}
                >
                  ⊕ New scene…
                </button>
              )}
            </>
          )}
          {targetG?.kind === 'content' &&
            (() => {
              const anchor = targetG.rows[targetG.rows.length - 1]?.node
              const first = targetG.rows[0]?.node
              return (
                <>
                  {anchor &&
                    kindRow('Insert after this block', (k) =>
                      ctx.current.commit(() => {
                        const made = makeFor(k, nodeIndent(anchor), ctx.current.unit)
                        if (!made) return
                        let a = anchor
                        for (const nn of made) {
                          insertAfter(ctx.current.astFor(tOwn), a, nn)
                          a = nn
                        }
                      }, tOwn)
                    )}
                  {first && nodeIndent(first) === '' && (
                    <button className="ctx-item" onClick={act(() => ctx.current.playFrom(targetG.startLine))}>
                      ▶ Play from here
                    </button>
                  )}
                  <button className="ctx-item" onClick={act(() => ctx.current.jump(targetG.startLine, tOwn))}>
                    ↪ Reveal in code
                  </button>
                </>
              )
            })()}
          {targetG?.kind === 'choice' && (
            <>
              <button
                className="ctx-item"
                onClick={act(() =>
                  ctx.current.commit(() => setChoiceCount(targetG.node, targetG.count + 1, ctx.current.unit), tOwn)
                )}
              >
                ＋ Add option
              </button>
              {kindRow('Insert after this choice', (k) =>
                ctx.current.commit(() => {
                  const made = makeFor(k, nodeIndent(targetG.node), ctx.current.unit)
                  if (!made) return
                  let a: AstNode = targetG.node
                  for (const nn of made) {
                    insertAfter(ctx.current.astFor(tOwn), a, nn)
                    a = nn
                  }
                }, tOwn)
              )}
              {nodeIndent(targetG.node) === '' && (
                <button className="ctx-item" onClick={act(() => ctx.current.playFrom(targetG.startLine))}>
                  ▶ Play from here
                </button>
              )}
              <button className="ctx-item" onClick={act(() => ctx.current.jump(targetG.startLine, tOwn))}>
                ↪ Reveal in code
              </button>
              <button
                className="ctx-item ctx-danger"
                onClick={act(() => ctx.current.commit(() => removeNode(ctx.current.astFor(tOwn), targetG.node), tOwn))}
              >
                ✕ Delete choice (and options)
              </button>
            </>
          )}
          {targetG?.kind === 'option' && (
            <>
              {kindRow('Insert at top of this option', (k) =>
                ctx.current.commit(() => {
                  const made = makeFor(k, nodeIndent(targetG.node) + ctx.current.unit, ctx.current.unit)
                  if (made) targetG.node.children.unshift(...made)
                }, tOwn)
              )}
              <button
                className="ctx-item"
                onClick={act(() =>
                  ctx.current.commit(
                    () =>
                      insertAfter(
                        ctx.current.astFor(tOwn),
                        targetG.node,
                        makeNode('option', nodeIndent(targetG.node), ctx.current.unit)
                      ),
                    tOwn
                  )
                )}
              >
                ＋ Add option after this one
              </button>
              <button className="ctx-item" onClick={act(() => ctx.current.jump(targetG.startLine, tOwn))}>
                ↪ Reveal in code
              </button>
              <button
                className="ctx-item ctx-danger"
                onClick={act(() => ctx.current.commit(() => removeNode(ctx.current.astFor(tOwn), targetG.node), tOwn))}
              >
                ✕ Delete option (and contents)
              </button>
            </>
          )}
          {targetG?.kind === 'stub' && targetG.scene && (
            <button className="ctx-item" onClick={act(() => ctx.current.switchScene(targetG.scene!))}>
              ↪ Open scene: {targetG.scene}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// (layout helpers live in canvasLayout.ts so diag can test them headlessly)
