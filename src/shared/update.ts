/**
 * Update-check logic shared by the main process and the headless diagnostics.
 * Pure: version comparison + picking the right asset out of a GitHub release.
 * The network/download side lives in src/main/updater.ts.
 */

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

/** The subset of a GitHub /releases/latest response the updater reads. */
export interface GithubRelease {
  tag_name: string
  body?: string | null
  assets?: ReleaseAsset[] | null
}

export interface UpdateInfo {
  /** New version, no leading v (e.g. "0.0.42"). */
  version: string
  /** Asset filename (e.g. "ChoiceScript IDE-0.0.42-portable.exe"). */
  name: string
  url: string
  size: number
  notes: string
}

/** "v0.0.42" | "0.0.42" → [0, 0, 42]; missing/garbage parts become 0. */
export function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((p) => parseInt(p, 10) || 0)
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(candidate)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** Decide whether `release` is an applicable update over `currentVersion`:
 *  newer tag AND it ships a portable .exe asset. Returns null otherwise. */
export function pickUpdate(currentVersion: string, release: GithubRelease): UpdateInfo | null {
  if (!release?.tag_name || !isNewerVersion(currentVersion, release.tag_name)) return null
  const exe = (release.assets ?? []).find((a) => a.name.toLowerCase().endsWith('portable.exe'))
  if (!exe) return null
  return {
    version: release.tag_name.replace(/^v/i, ''),
    name: exe.name,
    url: exe.browser_download_url,
    size: exe.size,
    notes: release.body ?? ''
  }
}
