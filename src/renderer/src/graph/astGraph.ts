/**
 * Turn a scene AST into a "flow of choices" graph for the Typed view:
 *   - Linear runs (text / commands / *if ladders) become CONTENT nodes.
 *   - Every *choice / *fake_choice becomes its own CHOICE node; each option docks
 *     its immediate linear content, and when an option leads onward to another
 *     choice (or more content) that breaks out into its own connected node.
 * Pure (no React) so it can be round-trip / structure tested in diagnose.ts.
 */
import {
  nodeTypeLabel,
  editableValue,
  optionCount,
  parseScene,
  generateScene,
  insertAfter,
  insertBefore,
  nodeIndent,
  type AstNode,
  type ChoiceNode,
  type OptionNode,
  type CommandNode
} from '../choicescript/ast'
import { countWords } from '../choicescript/wordCount'

export interface GRow {
  id: string
  node: AstNode
  nodeType: AstNode['type']
  typeLabel: string
  depth: number
  value: string
  multiline: boolean
  hasField: boolean
  fieldHint: string
  startLine: number
  endLine: number
}

export type GNode =
  | { id: string; kind: 'content'; rows: GRow[]; startLine: number; endLine: number; ownScene?: string }
  | {
      id: string
      kind: 'choice'
      node: ChoiceNode
      fake: boolean
      count: number
      preRows: GRow[]
      startLine: number
      endLine: number
      ownScene?: string
    }
  | {
      id: string
      kind: 'option'
      node: OptionNode
      label: string
      /** Inline modifier prefix (e.g. '*selectable_if (x > 1)'), if any. */
      modifier: string | null
      /** Prose word count of the option's whole subtree. */
      words: number
      rows: GRow[]
      startLine: number
      endLine: number
      ownScene?: string
    }
  | {
      id: string
      kind: 'stub'
      /** Target scene name, or null for the ending stub. */
      scene: string | null
      title: string
      startLine: number
      endLine: number
      ownScene?: string
    }
  | {
      id: string
      kind: 'scenehead'
      title: string
      startLine: number
      endLine: number
      /** The scene this header belongs to (whole-game view). */
      ownScene: string
    }

export interface GEdge {
  id: string
  source: string
  target: string
  kind: 'seq' | 'option' | 'scene' | 'goto'
}

/** Commands after which execution cannot fall through to the next statement. */
const HARD_TERMINATORS = new Set([
  'goto',
  'goto_scene',
  'redirect_scene',
  'goto_random_scene',
  'finish',
  'ending',
  'return',
  'restart',
  'abort'
])

/** Island labels mark canvas-added nodes that the author connects manually. */
const ISLAND_RE = /^\s*\*label\s+(island\w*)/i

function rowRaw(r: GRow): string {
  return r.node.type === 'command' ? r.node.raw : ''
}

/** Last meaningful row (skipping blank prose) ends in a hard terminator? */
function rowsTerminate(rows: GRow[]): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.node.type === 'text' && r.node.raw.every((l) => !l.trim())) continue
    return r.depth === 0 && r.node.type === 'command' && HARD_TERMINATORS.has(r.node.name)
  }
  return false
}

export interface ChoiceGraph {
  nodes: GNode[]
  edges: GEdge[]
}

function ownLines(n: AstNode): number {
  return n.type === 'text' ? n.raw.length : 1
}

function hasChildren(n: AstNode): n is ChoiceNode | OptionNode | Extract<AstNode, { type: 'if' }> {
  return n.type === 'choice' || n.type === 'option' || n.type === 'if'
}

function containsChoice(n: AstNode): boolean {
  if (n.type === 'choice') return true
  return hasChildren(n) && n.children.some(containsChoice)
}

export function buildChoiceGraph(ast: AstNode[]): ChoiceGraph {
  // Source-order line ranges for every node (matches generateScene output).
  const lines = new Map<AstNode, [number, number]>()
  {
    let line = 0
    const walk = (list: AstNode[]): void => {
      for (const n of list) {
        const s = line
        line += ownLines(n)
        if (hasChildren(n)) walk(n.children)
        lines.set(n, [s, line])
      }
    }
    walk(ast)
  }
  const lineOf = (n: AstNode): [number, number] => lines.get(n) ?? [0, 0]

  const nodes: GNode[] = []
  const edges: GEdge[] = []
  let uid = 0
  const id = (p: string): string => `${p}${uid++}`

  const makeRow = (node: AstNode, depth: number): GRow => {
    const [s, e] = lineOf(node)
    const isElse = node.type === 'if' && node.kind === 'else'
    return {
      id: id('r'),
      node,
      nodeType: node.type,
      typeLabel: nodeTypeLabel(node),
      depth,
      value: editableValue(node),
      multiline: node.type === 'text',
      hasField: node.type !== 'choice' && !isElse,
      fieldHint: node.type === 'option' ? '#' : '',
      startLine: s,
      endLine: e
    }
  }

  // Flatten a linear (choice-free) statement into docked rows.
  const toRows = (node: AstNode, depth: number, out: GRow[]): void => {
    out.push(makeRow(node, depth))
    if (node.type === 'if') for (const c of node.children) toRows(c, depth + 1, out)
  }

  const span = (list: { startLine: number; endLine: number }[]): [number, number] =>
    list.length ? [list[0].startLine, list[list.length - 1].endLine] : [0, 0]

  // Process a statement list into a seq-linked chain of nodes; returns the first
  // and last node ids (for the caller to connect into). Content splits at
  // top-level *label lines (section anchors); a seq edge is skipped when the
  // previous flow cannot fall through, or into an 'island' node (canvas-added,
  // awaiting a manual connection).
  const processList = (list: AstNode[]): { first: string | null; last: string | null } => {
    let buffer: GRow[] = []
    let first: string | null = null
    let prev: string | null = null
    let prevTerminates = false

    const link = (nid: string, island = false): void => {
      if (prev && !prevTerminates && !island) {
        edges.push({ id: `e${prev}-${nid}`, source: prev, target: nid, kind: 'seq' })
      }
      if (!first) first = nid
      prev = nid
    }
    const flush = (): void => {
      if (!buffer.length) return
      const rows = buffer
      buffer = []
      const [s, e] = span(rows)
      const nid = id('n')
      nodes.push({ id: nid, kind: 'content', rows, startLine: s, endLine: e })
      link(nid, ISLAND_RE.test(rowRaw(rows[0])))
      prevTerminates = rowsTerminate(rows)
    }

    for (const stmt of list) {
      if (stmt.type === 'choice') {
        flush()
        link(emitChoice(stmt))
        prevTerminates = false
      } else if (hasChildren(stmt) && containsChoice(stmt)) {
        // e.g. an *if guarding a nested choice: show the guard as its own small
        // content node, then break its body out as a continuation.
        flush()
        const guard = id('n')
        const [s, e] = lineOf(stmt)
        nodes.push({ id: guard, kind: 'content', rows: [makeRow(stmt, 0)], startLine: s, endLine: e })
        link(guard)
        prevTerminates = false
        const sub = processList(stmt.children)
        if (sub.first) {
          edges.push({ id: `e${guard}-${sub.first}`, source: guard, target: sub.first, kind: 'seq' })
          prev = sub.last
        }
      } else {
        // Top-level *label starts a fresh section node.
        if (stmt.type === 'command' && stmt.name === 'label') flush()
        toRows(stmt, 0, buffer)
      }
    }
    flush()
    return { first, last: prev }
  }

  function emitChoice(choice: ChoiceNode): string {
    const nid = id('c')
    const preRows: GRow[] = []

    const [s, e] = lineOf(choice)
    nodes.push({
      id: nid,
      kind: 'choice',
      node: choice,
      fake: choice.fake,
      count: optionCount(choice),
      preRows,
      startLine: s,
      endLine: e
    })

    for (const child of choice.children) {
      if (child.type !== 'option') {
        // Non-option guard/prose directly under the choice — dock it up top.
        toRows(child, 0, preRows)
        continue
      }
      // Every #option is its own node; split its body into the content that
      // docks in the option and the branch that continues on from it.
      const kids = child.children
      let cut = kids.length
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].type === 'choice' || containsChoice(kids[i])) {
          cut = i
          break
        }
      }
      const rows: GRow[] = []
      for (let i = 0; i < cut; i++) toRows(kids[i], 0, rows)

      const oid = id('o')
      const [os, oe] = lineOf(child)
      nodes.push({
        id: oid,
        kind: 'option',
        node: child,
        label: child.label,
        modifier: child.modifier ? child.modifier.trim() : null,
        words: countWords(generateScene(child.children)),
        rows,
        startLine: os,
        endLine: oe
      })
      edges.push({ id: `e${nid}-${oid}`, source: nid, target: oid, kind: 'option' })

      if (cut < kids.length) {
        const sub = processList(kids.slice(cut))
        if (sub.first) edges.push({ id: `e${oid}-${sub.first}`, source: oid, target: sub.first, kind: 'seq' })
      }
    }
    return nid
  }

  processList(ast)

  const rowsOf = (n: GNode): GRow[] =>
    n.kind === 'content' ? n.rows : n.kind === 'option' ? n.rows : n.kind === 'choice' ? n.preRows : []

  // *goto / *gosub edges: label rows anchor their node; each goto row draws an
  // edge from its containing node to the label's node.
  const labelHome = new Map<string, string>()
  for (const gn of nodes) {
    for (const r of rowsOf(gn)) {
      const m = /^\s*\*label\s+(\w+)/.exec(rowRaw(r))
      if (m) labelHome.set(m[1].toLowerCase(), gn.id)
    }
  }
  for (const gn of [...nodes]) {
    for (const r of rowsOf(gn)) {
      const m = /^\s*\*(goto|gosub)\s+(\w+)/.exec(rowRaw(r))
      if (!m) continue
      const target = labelHome.get(m[2].toLowerCase())
      if (target && target !== gn.id) {
        edges.push({ id: `g${gn.id}-${target}-${r.id}`, source: gn.id, target, kind: 'goto' })
      }
    }
  }

  // Cross-scene + ending stubs: any node whose rows jump to another scene (or
  // finish/end the game) gets an edge to a clickable stub node.
  const sceneStubs = new Map<string, string>() // scene -> stub node id
  let endingStub: string | null = null
  for (const gn of [...nodes]) {
    for (const r of rowsOf(gn)) {
      if (r.nodeType !== 'command') continue
      const raw = (r.node as { raw: string }).raw
      const sceneM = /^\s*\*(?:goto_scene|gosub_scene|redirect_scene)\s+(\w+)/.exec(raw)
      if (sceneM) {
        let sid = sceneStubs.get(sceneM[1])
        if (!sid) {
          sid = id('s')
          sceneStubs.set(sceneM[1], sid)
          nodes.push({ id: sid, kind: 'stub', scene: sceneM[1], title: `→ scene: ${sceneM[1]}`, startLine: r.startLine, endLine: r.endLine })
        }
        edges.push({ id: `e${gn.id}-${sid}-${r.id}`, source: gn.id, target: sid, kind: 'scene' })
      } else if (/^\s*\*(?:finish|ending)\b/.test(raw)) {
        if (!endingStub) {
          endingStub = id('s')
          nodes.push({ id: endingStub, kind: 'stub', scene: null, title: '■ ending', startLine: r.startLine, endLine: r.endLine })
        }
        edges.push({ id: `e${gn.id}-${endingStub}-${r.id}`, source: gn.id, target: endingStub, kind: 'scene' })
      }
    }
  }
  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Whole-game view: every scene's graph, stitched, with cross-scene edges.

export interface GameGraph {
  nodes: GNode[]
  edges: GEdge[]
  /** Per-scene parsed ASTs (the graphs' backing objects). */
  asts: Record<string, AstNode[]>
  /** Scenes in display order. */
  scenes: string[]
}

/** Build one graph for the WHOLE game: per-scene choice-flow graphs with
 *  namespaced ids, scene-header nodes, and goto_scene stubs replaced by real
 *  cross-scene edges into the target scene's entry node. Pure. */
export function buildGameGraph(files: Record<string, string>, sceneList: string[]): GameGraph {
  const listed = sceneList.filter((s) => files[s] != null)
  const rest = Object.keys(files).filter((s) => s !== 'choicescript_stats' && !listed.includes(s))
  const scenes = [...listed, ...rest]

  const asts: Record<string, AstNode[]> = {}
  const nodes: GNode[] = []
  const edges: GEdge[] = []
  const entry: Record<string, string | null> = {}

  for (const scene of scenes) {
    const ast = parseScene(files[scene])
    asts[scene] = ast
    const g = buildChoiceGraph(ast)
    const pre = `${scene}::`
    nodes.push({ id: `${pre}head`, kind: 'scenehead', title: scene, startLine: 0, endLine: 0, ownScene: scene })
    entry[scene] = g.nodes.find((n) => n.kind !== 'stub')?.id ?? null
    if (entry[scene]) entry[scene] = pre + entry[scene]
    for (const n of g.nodes) nodes.push({ ...n, id: pre + n.id, ownScene: scene } as GNode)
    for (const e of g.edges) edges.push({ ...e, id: pre + e.id, source: pre + e.source, target: pre + e.target })
  }

  // Replace scene stubs whose target exists with direct edges to its entry.
  const dropIds = new Set<string>()
  for (const n of nodes) {
    if (n.kind !== 'stub' || !n.scene) continue
    const target = entry[n.scene]
    if (!target) continue
    dropIds.add(n.id)
    for (const e of edges) {
      if (e.target === n.id) e.target = target
    }
  }
  return {
    nodes: nodes.filter((n) => !dropIds.has(n.id)),
    edges,
    asts,
    scenes
  }
}

// ---------------------------------------------------------------------------
// Drag-to-connect: turn a canvas connection into real ChoiceScript.

function cmd(name: string, raw: string): CommandNode {
  return { type: 'command', name, raw }
}

/** All label names currently in the scene (lowercased). */
export function existingLabels(ast: AstNode[]): Set<string> {
  const out = new Set<string>()
  for (const m of generateScene(ast).matchAll(/^\s*\*label\s+(\w+)/gm)) out.add(m[1].toLowerCase())
  return out
}

/** A fresh label name with the given prefix (island1, link2, …). */
export function freshLabel(ast: AstNode[], prefix: string): string {
  const used = existingLabels(ast)
  for (let n = 1; ; n++) {
    if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
  }
}

/** The label already anchoring a node's first statement, if any. */
function anchorLabel(g: GNode): string | null {
  if (g.kind !== 'content') return null
  const first = g.rows[0]
  const m = first ? /^\s*\*label\s+(\w+)/.exec(rowRaw(first)) : null
  return m ? m[1] : null
}

/** Append a command to the END of a node's flow (option body / after content). */
function appendToSource(ast: AstNode[], src: GNode, make: (indent: string) => CommandNode, unit: string): boolean {
  if (src.kind === 'option') {
    src.node.children.push(make(nodeIndent(src.node) + unit))
    return true
  }
  if (src.kind === 'content') {
    const last = src.rows.filter((r) => r.depth === 0).pop()?.node
    return last ? insertAfter(ast, last, make(nodeIndent(last))) : false
  }
  if (src.kind === 'choice') {
    // Connection from the choice itself = after the whole block (convergence).
    return insertAfter(ast, src.node, make(nodeIndent(src.node)))
  }
  return false
}

/** Create the ChoiceScript for a canvas drag src → tgt: a *goto (labelling the
 *  target if needed) or *goto_scene for scene stubs. Mutates; true on success. */
/** Cross-scene drag-connect: writes `*goto_scene <scene> [label]` into the
 *  SOURCE scene's AST, auto-labelling the target inside the TARGET scene's
 *  AST when the drop landed on a specific node. Mutates both; true on success. */
export function connectAcross(
  srcAst: AstNode[],
  tgtAst: AstNode[],
  src: GNode,
  tgt: GNode,
  tgtScene: string,
  unit: string
): boolean {
  if (src.kind === 'stub' || src.kind === 'scenehead') return false
  // Dropping on the plate/title = jump to the scene's start (no label).
  if (tgt.kind === 'scenehead' || tgt.kind === 'stub') {
    return appendToSource(srcAst, src, (ind) => cmd('goto_scene', `${ind}*goto_scene ${tgtScene}`), unit)
  }
  let label = anchorLabel(tgt)
  if (!label) {
    label = freshLabel(tgtAst, 'link')
    if (tgt.kind === 'option') {
      tgt.node.children.unshift(cmd('label', `${nodeIndent(tgt.node)}${unit}*label ${label}`))
    } else {
      const first = tgt.kind === 'content' ? tgt.rows[0]?.node : tgt.node
      if (!first) return false
      if (!insertBefore(tgtAst, first, cmd('label', `${nodeIndent(first)}*label ${label}`))) return false
    }
  }
  return appendToSource(srcAst, src, (ind) => cmd('goto_scene', `${ind}*goto_scene ${tgtScene} ${label}`), unit)
}

export function connectNodes(ast: AstNode[], src: GNode, tgt: GNode, unit: string): boolean {
  if (src.kind === 'stub' || src.kind === 'scenehead' || tgt.kind === 'scenehead') return false
  if (tgt.kind === 'stub') {
    if (!tgt.scene) return false
    return appendToSource(ast, src, (ind) => cmd('goto_scene', `${ind}*goto_scene ${tgt.scene}`), unit)
  }
  let label = anchorLabel(tgt)
  if (!label) {
    label = freshLabel(ast, 'link')
    if (tgt.kind === 'option') {
      // A label between #options is illegal — anchor inside the option's body.
      tgt.node.children.unshift(cmd('label', `${nodeIndent(tgt.node)}${unit}*label ${label}`))
    } else {
      const first = tgt.kind === 'content' ? tgt.rows[0]?.node : tgt.node
      if (!first) return false
      if (!insertBefore(ast, first, cmd('label', `${nodeIndent(first)}*label ${label}`))) return false
    }
  }
  return appendToSource(ast, src, (ind) => cmd('goto', `${ind}*goto ${label}`), unit)
}
