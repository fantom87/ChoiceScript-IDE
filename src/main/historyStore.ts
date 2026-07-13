/**
 * Local file history: every save of a scene snapshots the PREVIOUS content
 * into <root>/.cside/history/<scene>/<timestamp>.txt (skipped when nothing
 * changed), capped per scene. Undo stacks die with the session — this is the
 * safety net for prose.
 */
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'

const MAX_SNAPSHOTS = 25

export interface HistoryEntry {
  /** Snapshot id = filename (sortable timestamp). */
  id: string
  /** Epoch ms the snapshot was taken. */
  ts: number
  /** Byte size, for the list UI. */
  size: number
}

function historyDir(root: string, scene: string): string {
  return join(root, '.cside', 'history', basename(scene))
}

/** Snapshot `previousText` (the content being overwritten) for `scene`. */
export async function snapshot(root: string, scene: string, previousText: string): Promise<void> {
  const dir = historyDir(root, scene)
  await fs.mkdir(dir, { recursive: true })
  const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.txt')).sort()
  // Skip when identical to the newest snapshot (rapid Ctrl+S spam).
  const newest = entries[entries.length - 1]
  if (newest) {
    const last = await fs.readFile(join(dir, newest), 'utf8')
    if (last === previousText) return
  }
  const id = `${String(Date.now()).padStart(14, '0')}.txt`
  await fs.writeFile(join(dir, id), previousText, 'utf8')
  // Cap: drop the oldest beyond the limit.
  const all = [...entries, id].sort()
  for (const f of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) {
    await fs.rm(join(dir, f), { force: true })
  }
}

export async function listSnapshots(root: string, scene: string): Promise<HistoryEntry[]> {
  try {
    const dir = historyDir(root, scene)
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.txt')).sort().reverse()
    const out: HistoryEntry[] = []
    for (const f of files) {
      const st = await fs.stat(join(dir, f))
      out.push({ id: f, ts: parseInt(f, 10), size: st.size })
    }
    return out
  } catch {
    return []
  }
}

export async function readSnapshot(root: string, scene: string, id: string): Promise<string> {
  if (!/^\d+\.txt$/.test(id)) throw new Error('bad snapshot id')
  return fs.readFile(join(historyDir(root, scene), id), 'utf8')
}
