import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join, basename, normalize, sep } from 'node:path'
import type { ProjectData, SavePoint, IdeConfig } from '../shared/types'
import { DEFAULT_CONFIG } from '../shared/types'
import * as saveStore from './saveStore'
import { buildStandaloneHtml } from './exportHtml'
import type { ExportOptions } from './exportHtml'
import { scaffoldProject } from './scaffold'
import { checkForUpdate, downloadAndInstall } from './updater'
import type { UpdateInfo } from '../shared/update'

function engineDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'engine')
    : join(__dirname, '../../resources/engine')
}

const NEW_SCENE_TEMPLATE = (name: string): string =>
  `*comment ${name}\n\nYour scene text here.\n\n*finish\n`

/** Candidate relative locations of the scenes dir within an opened folder. */
const SCENE_DIR_CANDIDATES = ['scenes', '.', 'web/mygame/scenes', 'mygame/scenes']

function sampleSourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sample-game')
    : join(__dirname, '../../resources/sample-game')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}

/** Locate the scenes directory (the one holding startup.txt) inside `root`. */
async function findScenesDir(root: string): Promise<string | null> {
  for (const rel of SCENE_DIR_CANDIDATES) {
    const dir = normalize(join(root, rel))
    if (await exists(join(dir, 'startup.txt'))) return dir
  }
  return null
}

async function loadProjectFromDir(root: string): Promise<ProjectData> {
  const scenesDir = await findScenesDir(root)
  if (!scenesDir) {
    throw new Error(`No startup.txt found under ${root} (looked in scenes/, ., web/mygame/scenes/, mygame/scenes/)`)
  }
  const files: Record<string, string> = {}
  for (const name of await fs.readdir(scenesDir)) {
    if (!name.toLowerCase().endsWith('.txt')) continue
    const text = await fs.readFile(join(scenesDir, name), 'utf8')
    files[name.replace(/\.txt$/i, '')] = text
  }
  return { root, scenesDir, files }
}

/** Guard a scene name to a safe, single-segment filename. */
function safeSceneFile(scenesDir: string, name: string): string {
  const clean = basename(name).replace(/\.txt$/i, '')
  if (!/^[\w-]+$/.test(clean)) throw new Error(`Invalid scene name: ${name}`)
  const filePath = normalize(join(scenesDir, `${clean}.txt`))
  if (filePath !== scenesDir && !filePath.startsWith(scenesDir + sep)) {
    throw new Error('Refusing to write outside the scenes directory')
  }
  return filePath
}

export function registerIpc(): void {
  ipcMain.handle('project:openDialog', async (event): Promise<ProjectData | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open ChoiceScript Project',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return loadProjectFromDir(result.filePaths[0])
  })

  ipcMain.handle('project:newDialog', async (event): Promise<ProjectData | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'New ChoiceScript Project — choose a folder',
      buttonLabel: 'Create Here',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    const root = result.filePaths[0]
    if (!(await exists(join(root, 'scenes', 'startup.txt')))) {
      await scaffoldProject(root)
    }
    return loadProjectFromDir(root)
  })

  const lastProjectFile = (): string => join(app.getPath('userData'), 'last-project.json')
  ipcMain.handle('app:getLastProject', async (): Promise<string | null> => {
    try {
      return (JSON.parse(await fs.readFile(lastProjectFile(), 'utf8')).root as string) ?? null
    } catch {
      return null
    }
  })
  ipcMain.handle('app:setLastProject', async (_e, root: string): Promise<void> => {
    try {
      await fs.writeFile(lastProjectFile(), JSON.stringify({ root }), 'utf8')
    } catch {
      // best effort
    }
  })

  ipcMain.handle('project:loadSample', async (): Promise<ProjectData> => {
    // Copy the bundled sample into a writable location so edits can be saved
    // without touching read-only packaged resources.
    const dest = join(app.getPath('userData'), 'sample-game')
    if (!(await exists(join(dest, 'scenes', 'startup.txt')))) {
      await copyDir(sampleSourceDir(), dest)
    }
    return loadProjectFromDir(dest)
  })

  ipcMain.handle('project:load', async (_e, root: string): Promise<ProjectData> => {
    return loadProjectFromDir(root)
  })

  // The build-a-game tutorial works on its own real project (in userData so
  // no dialog is needed); created minimal on first use, preserved after.
  ipcMain.handle('project:loadTutorial', async (): Promise<ProjectData> => {
    const dest = join(app.getPath('userData'), 'tutorial-game')
    const startupPath = join(dest, 'scenes', 'startup.txt')
    if (!(await exists(startupPath))) {
      await fs.mkdir(join(dest, 'scenes'), { recursive: true })
      await fs.writeFile(
        startupPath,
        [
          '*title My First Game',
          '*author Your Name Here',
          '*scene_list',
          '  startup',
          '',
          'The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.',
          '',
          '*finish',
          ''
        ].join('\n'),
        'utf8'
      )
    }
    return loadProjectFromDir(dest)
  })

  ipcMain.handle(
    'scene:write',
    async (_e, scenesDir: string, name: string, text: string): Promise<void> => {
      await fs.writeFile(safeSceneFile(scenesDir, name), text, 'utf8')
    }
  )

  // --- Save points (stored in <root>/.cside/saves/<id>.json) ---------------
  ipcMain.handle('saves:list', (_e, root: string): Promise<SavePoint[]> =>
    saveStore.listSaves(root)
  )
  ipcMain.handle('saves:write', (_e, root: string, save: SavePoint): Promise<void> =>
    saveStore.writeSave(root, save)
  )
  ipcMain.handle('saves:delete', (_e, root: string, id: string): Promise<void> =>
    saveStore.deleteSave(root, id)
  )

  // --- New scene -----------------------------------------------------------
  ipcMain.handle(
    'scene:create',
    async (_e, scenesDir: string, name: string): Promise<{ created: boolean; reason?: string }> => {
      if (!/^[\w-]+$/.test(name)) return { created: false, reason: 'Invalid scene name' }
      const filePath = safeSceneFile(scenesDir, name)
      if (await exists(filePath)) return { created: false, reason: 'Scene already exists' }
      await fs.writeFile(filePath, NEW_SCENE_TEMPLATE(name), 'utf8')
      return { created: true }
    }
  )

  // --- Export to a self-contained HTML -------------------------------------
  ipcMain.handle('export:html', async (event, opts: ExportOptions): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export Game to HTML',
      defaultPath: `${(opts.title || 'game').replace(/[^\w-]+/g, '-')}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (result.canceled || !result.filePath) return null
    const html = await buildStandaloneHtml(engineDir(), opts)
    await fs.writeFile(result.filePath, html, 'utf8')
    return result.filePath
  })

  // Pick where a graph image export should go (before the heavy capture).
  ipcMain.handle('export:imagePath', async (event, defaultName: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export Graph Image',
      defaultPath: defaultName,
      filters: [
        { name: 'PNG image', extensions: ['png'] },
        { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }
      ]
    })
    return result.canceled || !result.filePath ? null : result.filePath
  })

  // Write a captured data-URL image to the chosen path.
  ipcMain.handle('export:imageWrite', async (_e, filePath: string, dataUrl: string): Promise<void> => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'))
  })

  // --- Per-project config --------------------------------------------------
  const configFile = (root: string): string => join(root, '.cside', 'config.json')

  ipcMain.handle('config:read', async (_e, root: string): Promise<IdeConfig> => {
    try {
      const raw = await fs.readFile(configFile(root), 'utf8')
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  })

  ipcMain.handle('config:write', async (_e, root: string, config: IdeConfig): Promise<void> => {
    await fs.mkdir(join(root, '.cside'), { recursive: true })
    await fs.writeFile(configFile(root), JSON.stringify(config, null, 2), 'utf8')
  })

  // --- In-app updates (GitHub Releases) ------------------------------------
  ipcMain.handle('update:check', (): Promise<UpdateInfo | null> => checkForUpdate())
  ipcMain.handle('update:apply', async (event, info: UpdateInfo): Promise<string> => {
    const wc = event.sender
    return downloadAndInstall(info, (pct) => {
      if (!wc.isDestroyed()) wc.send('update:progress', pct)
    })
  })

  // --- Diagnostic mode -----------------------------------------------------
  ipcMain.handle('diag:report', async (_e, markdown: string): Promise<void> => {
    const out = process.env['CSIDE_DIAG_OUT'] || join(process.cwd(), 'diag-app-report.md')
    try {
      await fs.writeFile(out, markdown, 'utf8')
      console.log(`[diag] wrote ${out}`)
    } catch (e) {
      console.error('[diag] failed to write report:', e)
    }
    // The diagnostic run is complete; exit so the command returns.
    setTimeout(() => app.quit(), 300)
  })
}
