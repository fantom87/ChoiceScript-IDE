import { listSaves, writeSave, deleteSave } from '../src/main/saveStore'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SavePoint } from '../src/shared/types'

function mk(id: string, name: string, createdAt: string, auto = false): SavePoint {
  return { id, name, scene: 'startup', lineNum: 5, createdAt, auto, state: '{"stats":{}}' }
}

async function main(): Promise<void> {
  const root = join(tmpdir(), `cside-savetest-${Date.now()}`)

  await writeSave(root, mk('save-a', 'First', '2026-01-01T00:00:00Z'))
  await writeSave(root, mk('save-b', 'Second', '2026-01-02T00:00:00Z'))

  let list = await listSaves(root)
  console.log(`count=${list.length} newestFirst=${list[0]?.id}`)

  // Overwrite (rename) by re-writing same id.
  await writeSave(root, mk('save-a', 'Renamed', '2026-01-01T00:00:00Z'))
  list = await listSaves(root)
  const a = list.find((s) => s.id === 'save-a')
  console.log(`renamed=${a?.name}`)

  await deleteSave(root, 'save-b')
  list = await listSaves(root)
  console.log(`afterDeleteCount=${list.length}`)

  let threw = false
  try {
    await writeSave(root, mk('../evil', 'x', '2026-01-01T00:00:00Z'))
  } catch {
    threw = true
  }
  console.log(`invalidIdThrows=${threw}`)

  await fs.rm(root, { recursive: true, force: true })

  const pass =
    list.length === 1 && list[0].id === 'save-a' && a?.name === 'Renamed' && threw
  console.log(pass ? 'PASS: saveStore works' : 'FAIL')
}

main()
