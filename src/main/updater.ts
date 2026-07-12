/**
 * In-app updater for the portable build. Checks the GitHub Releases API for a
 * newer version; on request, streams the new portable exe down next to the
 * running one (or into Downloads), launches it and quits. No installer —
 * matches the unzip-and-run distribution model.
 */
import { app } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pickUpdate, type UpdateInfo, type GithubRelease } from '../shared/update'

const REPO = 'fantom87/ChoiceScript-IDE'
const API = `https://api.github.com/repos/${REPO}/releases/latest`

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!app.isPackaged) return null // dev runs aren't updatable
  try {
    const res = await fetch(API, {
      headers: { 'User-Agent': 'ChoiceScript-IDE', Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return null
    return pickUpdate(app.getVersion(), (await res.json()) as GithubRelease)
  } catch {
    return null // offline / rate-limited — never bother the user about it
  }
}

/** Where the downloaded exe should land: beside the running portable exe when
 *  that folder is writable, else the user's Downloads folder. */
async function updateDir(): Promise<string> {
  const portableDir = process.env['PORTABLE_EXECUTABLE_DIR'] || dirname(process.execPath)
  try {
    await fs.access(portableDir, fs.constants.W_OK)
    return portableDir
  } catch {
    return app.getPath('downloads')
  }
}

/** Download the new exe (streaming, with progress callbacks), then hand off:
 *  launch it detached and quit this instance. Returns the downloaded path. */
export async function downloadAndInstall(
  info: UpdateInfo,
  onProgress: (pct: number) => void
): Promise<string> {
  const res = await fetch(info.url, { headers: { 'User-Agent': 'ChoiceScript-IDE' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || info.size || 0
  const target = join(await updateDir(), info.name)
  const part = `${target}.part`
  let done = 0
  const reader = Readable.fromWeb(res.body as never)
  reader.on('data', (chunk: Buffer) => {
    done += chunk.length
    if (total) onProgress(Math.min(99, Math.round((done / total) * 100)))
  })
  await pipeline(reader, createWriteStream(part))
  await fs.rm(target, { force: true })
  await fs.rename(part, target)
  onProgress(100)
  // Hand off to the new version.
  spawn(target, [], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 400)
  return target
}
