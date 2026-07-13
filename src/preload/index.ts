import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectData, SavePoint, IdeConfig } from '../shared/types'
import type { UpdateInfo } from '../shared/update'

/**
 * The typed API surface exposed to the renderer as `window.cside`.
 */
const api = {
  platform: process.platform,
  /** Dev-only: scene to open on launch (for headless verification). */
  initialScene: process.env['CSIDE_SCENE'] ?? null,
  /** Dev-only: run an edit+save self-test after boot. */
  selftest: process.env['CSIDE_SELFTEST'] === '1',
  /** Diagnostic mode: run a scripted UI/engine self-check and write a report. */
  diagnostic: process.env['CSIDE_DIAGNOSTIC'] === '1',
  /** Send the diagnostic report to the main process to write to disk. */
  reportDiagnostic: (markdown: string): Promise<void> =>
    ipcRenderer.invoke('diag:report', markdown),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  /** Prompt for a folder and load it as a ChoiceScript project. */
  openProjectDialog: (): Promise<ProjectData | null> =>
    ipcRenderer.invoke('project:openDialog'),
  /** Prompt for a folder and scaffold a new ChoiceScript project there. */
  newProjectDialog: (): Promise<ProjectData | null> => ipcRenderer.invoke('project:newDialog'),
  /** Load the bundled sample game (copied to a writable location). */
  loadSample: (): Promise<ProjectData> => ipcRenderer.invoke('project:loadSample'),
  /** Load (creating on first use) the build-a-game tutorial project. */
  loadTutorial: (): Promise<ProjectData> => ipcRenderer.invoke('project:loadTutorial'),
  /** Path of the most recently opened project, if any. */
  getLastProject: (): Promise<string | null> => ipcRenderer.invoke('app:getLastProject'),
  /** Remember the most recently opened project. */
  setLastProject: (root: string): Promise<void> =>
    ipcRenderer.invoke('app:setLastProject', root),
  /** Load a project from a known path. */
  loadProject: (root: string): Promise<ProjectData> =>
    ipcRenderer.invoke('project:load', root),
  /** Write a scene's text back to disk. */
  writeScene: (scenesDir: string, name: string, text: string): Promise<void> =>
    ipcRenderer.invoke('scene:write', scenesDir, name, text),
  /** List a scene's local-history snapshots (newest first). */
  listHistory: (scenesDir: string, scene: string): Promise<{ id: string; ts: number; size: number }[]> =>
    ipcRenderer.invoke('history:list', scenesDir, scene),
  /** Read one local-history snapshot's text. */
  readHistory: (scenesDir: string, scene: string, id: string): Promise<string> =>
    ipcRenderer.invoke('history:read', scenesDir, scene, id),
  /** List save points for a project. */
  listSaves: (root: string): Promise<SavePoint[]> => ipcRenderer.invoke('saves:list', root),
  /** Create or update a save point. */
  writeSave: (root: string, save: SavePoint): Promise<void> =>
    ipcRenderer.invoke('saves:write', root, save),
  /** Delete a save point. */
  deleteSave: (root: string, id: string): Promise<void> =>
    ipcRenderer.invoke('saves:delete', root, id),
  /** Read per-project IDE config. */
  readConfig: (root: string): Promise<IdeConfig> => ipcRenderer.invoke('config:read', root),
  /** Write per-project IDE config. */
  writeConfig: (root: string, config: IdeConfig): Promise<void> =>
    ipcRenderer.invoke('config:write', root, config),
  /** Rename a scene file on disk (refs are rewritten by the renderer). */
  renameScene: (scenesDir: string, oldName: string, newName: string): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('scene:rename', scenesDir, oldName, newName),
  /** Create a new scene file. */
  createScene: (scenesDir: string, name: string): Promise<{ created: boolean; reason?: string }> =>
    ipcRenderer.invoke('scene:create', scenesDir, name),
  /** Export the game to a self-contained HTML file. */
  exportHtml: (opts: {
    mygameJs: string
    scenes: Record<string, string>
    title: string
    author: string
  }): Promise<string | null> => ipcRenderer.invoke('export:html', opts),
  /** Ask where a graph image export should be saved (null = cancelled). */
  exportImagePath: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('export:imagePath', defaultName),
  /** Write a captured data-URL image to the chosen path. */
  exportImageWrite: (filePath: string, dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('export:imageWrite', filePath, dataUrl),
  /** Ask GitHub Releases whether a newer version exists (null = up to date). */
  updateCheck: (): Promise<UpdateInfo | null> => ipcRenderer.invoke('update:check'),
  /** Download the new portable exe, launch it and quit this instance. */
  updateApply: (info: UpdateInfo): Promise<string> => ipcRenderer.invoke('update:apply', info),
  /** Subscribe to download progress (0–100). Returns an unsubscribe fn. */
  onUpdateProgress: (cb: (pct: number) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, pct: number): void => cb(pct)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  }
}

export type CsideApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('cside', api)
  } catch (error) {
    console.error('Failed to expose cside API:', error)
  }
} else {
  ;(window as unknown as { cside: CsideApi }).cside = api
}
