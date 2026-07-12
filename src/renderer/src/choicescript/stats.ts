/**
 * Stat enumeration + seeding for isolated single-scene preview.
 * Enumerates the game's permanent scalar variables (*create in startup) so the
 * author can seed values, then builds the RUN_FROM state to launch one scene in
 * isolation. Array variables auto-fill from the engine's starting stats via
 * nav.repairStats, so only scalars need seeding here.
 */

export type StatType = 'boolean' | 'number' | 'string'

export interface StatDef {
  name: string
  type: StatType
  /** Seed value as a string ('true'/'false' for booleans). */
  value: string
}

export function inferType(raw: string): StatType {
  if (/^(true|false)$/i.test(raw.trim())) return 'boolean'
  if (/^[+-]?\d+(\.\d+)?$/.test(raw.trim())) return 'number'
  return 'string'
}

function parseCreateValue(value: string): string {
  const v = value.trim()
  if (/^true$/i.test(v)) return 'true'
  if (/^false$/i.test(v)) return 'false'
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\(.)/g, '$1')
  return v
}

/** Enumerate permanent scalar stats declared via *create in startup.txt. */
export function enumerateStats(startupText: string): StatDef[] {
  const out: StatDef[] = []
  for (const raw of startupText.split(/\r?\n/)) {
    const m = /^\s*\*create\s+(\w+)\s+(.*)$/.exec(raw)
    if (!m) continue
    const value = parseCreateValue(m[2])
    out.push({ name: m[1].toLowerCase(), type: inferType(value), value })
  }
  return out
}

/** Return a copy with numeric/boolean stats randomised (strings left as-is). */
export function randomizeStats(stats: StatDef[], rand: () => number = Math.random): StatDef[] {
  return stats.map((s) => {
    if (s.type === 'number') return { ...s, value: String(Math.floor(rand() * 101)) }
    if (s.type === 'boolean') return { ...s, value: rand() < 0.5 ? 'true' : 'false' }
    return s
  })
}

/** Coerce a StatDef's string value to its typed JS value. */
export function coerceStat(s: StatDef): boolean | number | string {
  if (s.type === 'boolean') return /^true$/i.test(s.value)
  if (s.type === 'number') return Number(s.value) || 0
  return s.value
}

export interface IsolatedRun {
  state: string
  forcedScene: string
  forcedStats: Record<string, boolean | number | string>
}

/** Build the RUN_FROM payload to launch `scene` from its start with seeds. */
export function buildIsolatedRun(scene: string, stats: StatDef[]): IsolatedRun {
  const forcedStats: Record<string, boolean | number | string> = {}
  for (const s of stats) forcedStats[s.name] = coerceStat(s)
  const state = JSON.stringify({
    version: 'IDE',
    stats: { sceneName: scene, ...forcedStats },
    temps: {},
    lineNum: 0,
    indent: 0
  })
  return { state, forcedScene: scene, forcedStats }
}
