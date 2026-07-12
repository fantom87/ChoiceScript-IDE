/**
 * Cross-scene edge routing for the whole-game view. Edges leave a scene plate
 * through its bottom, travel the plate-free corridors (the horizontal bands
 * between shelves and the "highways" outside the map), and enter the target
 * plate through its title gateway at top-centre — never cutting through other
 * plates in the packed layout. Pure — geometry tested in diagnose.ts.
 */

export interface Pt {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Interior continuation after the gateway: down the plate's left channel to
 *  the target node's row, then in from the side. */
export interface Continuation {
  /** Node-free vertical channel x inside the plate's left margin. */
  chanX: number
  /** Node-free horizontal strip y under the title, above the first nodes. */
  stripY: number
  /** Top-centre of the actual target node. */
  tgt: Pt
}

/** Waypoints from a source point (inside srcPlate) to the target's gateway.
 *  `lane` staggers parallel paths; `gap` is the plate corridor width;
 *  `bounds` is the bounding box of all plates (highways run outside it). */
/** How the path leaves the source node: sideways into a verified-clear
 *  vertical gutter between node columns, then down. */
export interface ExitVia {
  gutterX: number
  outY: number
}

export function routeCross(
  src: Pt,
  srcPlate: Rect,
  tgtPlate: Rect,
  exitX: number,
  gateX: number,
  /** out: keyed to the EXIT (unique per source plate) — separates the
   *  corridor below the source. in: keyed to the GATEWAY (unique per target)
   *  — separates the approach corridor. */
  lanes: { out: number; in: number },
  bounds: Rect,
  gap: number,
  cont?: Continuation,
  exit?: ExitVia,
  /** Bottom of the source SHELF (tallest plate in the row) — corridors must
   *  clear taller neighbours, not just the source plate itself. */
  shelfBottom?: number
): Pt[] {
  const pts: Pt[] = []
  const srcBottom = srcPlate.y + srcPlate.h
  const stripY = srcBottom - 14 // node-free bottom margin inside the plate
  const belowY = (shelfBottom ?? srcBottom) + 16 + lanes.out // corridor below the shelf
  const approachY = tgtPlate.y - 16 - lanes.in // corridor above the target shelf
  const gateY = tgtPlate.y + 8 // just inside the title

  // Interior: out to the side into a clear gutter (if found), down to the
  // bottom strip, slide to the exit, leave. The path starts AT the node so
  // every segment stays axis-parallel (no diagonal jogs to a nearby handle).
  pts.push({ x: src.x, y: src.y })
  if (exit) {
    pts.push({ x: src.x, y: exit.outY })
    pts.push({ x: exit.gutterX, y: exit.outY })
    pts.push({ x: exit.gutterX, y: stripY })
  } else {
    pts.push({ x: src.x, y: stripY })
  }
  pts.push({ x: exitX, y: stripY })
  pts.push({ x: exitX, y: belowY })

  // If the corridor below the source is the same band as the corridor above
  // the target (target on the next shelf), go straight across.
  const direct = approachY >= belowY - gap * 0.9 && approachY <= belowY + gap * 0.9
  if (direct) {
    pts.push({ x: gateX, y: belowY })
  } else {
    // Otherwise take the nearest highway (outside all plates) up/down.
    const mid = (exitX + gateX) / 2
    const hw =
      mid < bounds.x + bounds.w / 2 ? bounds.x - 60 - lanes.out : bounds.x + bounds.w + 60 + lanes.out
    pts.push({ x: hw, y: belowY })
    pts.push({ x: hw, y: approachY })
    pts.push({ x: gateX, y: approachY })
  }
  pts.push({ x: gateX, y: gateY })
  // Continue inside: along the strip under the title, then straight down when
  // the target sits just below (the entry node) — the left channel is only
  // for targets deep inside the plate.
  if (cont) {
    pts.push({ x: gateX, y: cont.stripY })
    if (cont.tgt.y > cont.stripY + 80) {
      pts.push({ x: cont.chanX, y: cont.stripY })
      pts.push({ x: cont.chanX, y: cont.tgt.y - 16 })
      pts.push({ x: cont.tgt.x, y: cont.tgt.y - 16 })
    } else {
      pts.push({ x: cont.tgt.x, y: cont.stripY })
    }
    pts.push({ x: cont.tgt.x, y: cont.tgt.y })
  }
  return pts
}

/** Waypoints for an in-scene jump (*goto): down from the source, across to a
 *  node-free vertical channel at `chanX`, along it to the target's row, then
 *  in from the side — never crossing the nodes in between. */
export function routeInterior(src: Pt, tgt: Pt, chanX: number, lane: number): Pt[] {
  const outY = src.y + 10 + (lane % 4) * 5
  const inY = tgt.y - 14 - (lane % 4) * 5
  // No vertical room for a channel run (target ~adjacent below): a channel
  // would double back into a pigtail — take a simple stepped direct path.
  if (inY <= outY + 6) {
    const midY = (src.y + tgt.y) / 2
    return [
      { x: src.x, y: src.y },
      { x: src.x, y: midY },
      { x: tgt.x, y: midY },
      { x: tgt.x, y: tgt.y }
    ]
  }
  return [
    { x: src.x, y: src.y },
    { x: src.x, y: outY },
    { x: chanX, y: outY },
    { x: chanX, y: inY },
    { x: tgt.x, y: inY },
    { x: tgt.x, y: tgt.y }
  ]
}

/** An orthogonal SVG path through `pts` with rounded corners. */
/** Merge a fan-in: several sources converging on one target share a trunk.
 *  Each source drops to a horizontal bus just above the target, runs along it,
 *  and the final descent into the target is one shared segment — so a choice
 *  tree's converging paths read as a single line instead of a parallel bundle.
 *  Per-source obstacle lists veto blocked candidates (those stay unmerged =
 *  null); if fewer than two sources can reach the bus cleanly there is nothing
 *  to merge and every entry is null. */
export function routeTrunk(srcs: Pt[], tgt: Pt, obstaclesPer: Rect[][], busGap = 18): (Pt[] | null)[] {
  const busY = tgt.y - busGap
  const cands = srcs.map((s, i) => {
    if (s.y + 8 >= busY) return null // no room below the source for the bus
    const pts: Pt[] = [s, { x: s.x, y: busY }, { x: tgt.x, y: busY }, { x: tgt.x, y: tgt.y }]
    return obstaclesPer[i]?.some((r) => pathHitsRect(pts, r)) ? null : pts
  })
  return cands.filter(Boolean).length >= 2 ? cands : srcs.map(() => null)
}

export function pointsToPath(pts: Pt[], radius = 8): string {
  if (!pts.length) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]
    const c = pts[i]
    const n = pts[i + 1]
    const rIn = Math.min(radius, Math.abs(c.x - p.x) / 2 + Math.abs(c.y - p.y) / 2)
    const rOut = Math.min(radius, Math.abs(n.x - c.x) / 2 + Math.abs(n.y - c.y) / 2)
    const r = Math.max(0, Math.min(rIn, rOut))
    const inX = c.x === p.x ? c.x : c.x > p.x ? c.x - r : c.x + r
    const inY = c.y === p.y ? c.y : c.y > p.y ? c.y - r : c.y + r
    const outX = c.x === n.x ? c.x : c.x < n.x ? c.x + r : c.x - r
    const outY = c.y === n.y ? c.y : c.y < n.y ? c.y + r : c.y - r
    d += ` L ${inX} ${inY} Q ${c.x} ${c.y} ${outX} ${outY}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/** Find a clear vertical gutter next to a node: prefer the given side, step
 *  outward until the corridor [x±5, yTop..yBottom] misses every obstacle.
 *  Returns null when no clear gutter exists within reach. */
export function findGutter(
  obstacles: Rect[],
  startX: number,
  dir: -1 | 1,
  yTop: number,
  yBottom: number,
  maxSteps = 8
): number | null {
  for (let s = 0; s < maxSteps; s++) {
    const x = startX + dir * s * 10
    const blocked = obstacles.some(
      (r) => x + 5 > r.x && x - 5 < r.x + r.w && yBottom > r.y && yTop < r.y + r.h
    )
    if (!blocked) return x
  }
  return null
}

/** True if any segment of the polyline passes through the rect's interior. */
export function pathHitsRect(pts: Pt[], r: Rect, inset = 1): boolean {
  const x1 = r.x + inset
  const y1 = r.y + inset
  const x2 = r.x + r.w - inset
  const y2 = r.y + r.h - inset
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (a.x === b.x) {
      // vertical segment
      if (a.x > x1 && a.x < x2 && Math.max(y1, Math.min(a.y, b.y)) < Math.min(y2, Math.max(a.y, b.y))) return true
    } else {
      // horizontal segment
      if (a.y > y1 && a.y < y2 && Math.max(x1, Math.min(a.x, b.x)) < Math.min(x2, Math.max(a.x, b.x))) return true
    }
  }
  return false
}
