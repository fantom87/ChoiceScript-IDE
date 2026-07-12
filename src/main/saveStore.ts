import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SavePoint } from '../shared/types'

/** Save points live in <root>/.cside/saves/<id>.json. */
export function savesDir(root: string): string {
  return join(root, '.cside', 'saves')
}

function saveFile(root: string, id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid save id: ${id}`)
  return join(savesDir(root), `${id}.json`)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** List a project's save points, newest first. Skips corrupt files. */
export async function listSaves(root: string): Promise<SavePoint[]> {
  const dir = savesDir(root)
  if (!(await exists(dir))) return []
  const out: SavePoint[] = []
  for (const name of await fs.readdir(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(await fs.readFile(join(dir, name), 'utf8')) as SavePoint)
    } catch {
      // ignore corrupt file
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Create or overwrite a save point. */
export async function writeSave(root: string, save: SavePoint): Promise<void> {
  await fs.mkdir(savesDir(root), { recursive: true })
  await fs.writeFile(saveFile(root, save.id), JSON.stringify(save, null, 2), 'utf8')
}

/** Delete a save point (no-op if already gone). */
export async function deleteSave(root: string, id: string): Promise<void> {
  try {
    await fs.unlink(saveFile(root, id))
  } catch {
    // already gone
  }
}
