/**
 * Canvas layout helpers (dagre + choice-grid wrapping, plus an optional ELK
 * engine with real orthogonal edge routing), extracted so the layout
 * behaviour is headlessly testable in diagnose.ts.
 */
import dagre from 'dagre'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'
import type { GNode } from './astGraph'
import type { Pt } from './edgeRouting'

export const GRID_COLS = 5 // options per row before a choice fan wraps

export function sizeOf(n: Node): { w: number; h: number } {
  return {
    w: n.width ?? n.measured?.width ?? n.initialWidth ?? 300,
    h: n.height ?? n.measured?.height ?? n.initialHeight ?? 80
  }
}

function kindOfNode(n: Node): string | undefined {
  return ((n.data as { g?: GNode } | undefined)?.g as GNode | undefined)?.kind
}

/** dagre top-to-bottom layout using each node's current (or estimated) size.
 *  Choice fans wider than GRID_COLS wrap into grid rows via invisible
 *  rank-spacer chain nodes (each option keeps its subtree beneath it). */
/** ELK layered layout with true orthogonal, obstacle-aware edge routing —
 *  the trial alternative to dagre. Returns repositioned nodes plus per-edge
 *  routed waypoints (flow coordinates). */
export async function layoutWithElk(
  nds: Node[],
  eds: Edge[],
  sizes?: Map<string, { w: number; h: number }>
): Promise<{ nodes: Node[]; routes: Map<string, Pt[]> }> {
  const elk = new ELK()
  const dims = (n: Node): { w: number; h: number } => sizes?.get(n.id) ?? sizeOf(n)
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.spacing.nodeNode': '42',
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeEdge': '14',
      'elk.layered.mergeEdges': 'false'
    },
    children: nds.map((n) => {
      const { w, h } = dims(n)
      return { id: n.id, width: w, height: h }
    }),
    edges: eds
      .filter((e) => nds.some((n) => n.id === e.source) && nds.some((n) => n.id === e.target))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  }
  const res = await elk.layout(graph)
  const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))
  const routes = new Map<string, Pt[]>()
  type ElkSection = { startPoint: Pt; bendPoints?: Pt[]; endPoint: Pt }
  for (const e of (res.edges ?? []) as Array<{ id: string; sections?: ElkSection[] }>) {
    const sec = e.sections?.[0]
    if (!sec) continue
    routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint])
  }
  return {
    nodes: nds.map((n) => {
      const p = pos.get(n.id)
      return p ? { ...n, position: { x: p.x, y: p.y } } : n
    }),
    routes
  }
}

export function layoutWith(nds: Node[], eds: Edge[], sizes?: Map<string, { w: number; h: number }>): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 55 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nds) {
    const { w, h } = sizes?.get(n.id) ?? sizeOf(n)
    g.setNode(n.id, { width: w, height: h })
  }
  const kindOf = new Map(nds.map((n) => [n.id, kindOfNode(n)]))
  // Row index via minlen + heavy weight: without the weight, the options'
  // common continuation (e.g. every option's *goto done) pulls all of them
  // back into a single rank and no wrapping happens.
  const wrapped = new Set<Edge>()
  const gridChoices = new Map<string, Edge[]>()
  for (const n of nds) {
    if (kindOf.get(n.id) !== 'choice') continue
    const optEdges = eds.filter((e) => e.source === n.id && kindOf.get(e.target) === 'option')
    if (optEdges.length <= GRID_COLS) continue
    gridChoices.set(n.id, optEdges)
    optEdges.forEach((e, i) => {
      wrapped.add(e)
      g.setEdge(e.source, e.target, { minlen: Math.floor(i / GRID_COLS) + 1, weight: 50 })
    })
  }
  for (const e of eds) {
    if (!wrapped.has(e) && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const laid = nds.map((n) => {
    const p = g.node(n.id)
    const { w, h } = sizes?.get(n.id) ?? sizeOf(n)
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } }
  })

  // Align each wrapped fan into true columns centred under its choice (dagre
  // staggers the rows to dodge edges — a grid reads far better). Each option
  // drags its EXCLUSIVE descendants along so subtrees stay attached.
  if (gridChoices.size) {
    const byId = new Map(laid.map((n) => [n.id, n]))
    const adj = new Map<string, string[]>()
    for (const e of eds) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
    for (const [choiceId, optEdges] of gridChoices) {
      const choice = byId.get(choiceId)
      if (!choice) continue
      const opts = optEdges.map((e) => byId.get(e.target)).filter((n): n is Node => !!n)
      // Exclusive descendants: nodes below an option reachable from ONLY it.
      const reach = new Map<string, Set<string>>()
      for (const o of opts) {
        const seen = new Set<string>()
        const stack = [o.id]
        while (stack.length) {
          const cur = stack.pop()!
          for (const next of adj.get(cur) ?? []) {
            const nn = byId.get(next)
            if (!nn || seen.has(next)) continue
            if (nn.position.y <= o.position.y) continue // only below the option
            seen.add(next)
            stack.push(next)
          }
        }
        reach.set(o.id, seen)
      }
      const ownerCount = new Map<string, number>()
      for (const [, set] of reach) for (const id of set) ownerCount.set(id, (ownerCount.get(id) ?? 0) + 1)

      const colW = Math.max(...opts.map((o) => (sizes?.get(o.id) ?? sizeOf(o)).w)) + 36
      const centerX = choice.position.x + (sizes?.get(choice.id) ?? sizeOf(choice)).w / 2
      const rowW = GRID_COLS * colW
      opts.forEach((o, i) => {
        const col = i % GRID_COLS
        const newX = centerX - rowW / 2 + col * colW
        const dx = newX - o.position.x
        if (dx === 0) return
        o.position = { x: newX, y: o.position.y }
        for (const id of reach.get(o.id) ?? []) {
          if ((ownerCount.get(id) ?? 0) !== 1) continue
          const nn = byId.get(id)!
          nn.position = { x: nn.position.x + dx, y: nn.position.y }
        }
      })
    }
  }
  return laid
}
