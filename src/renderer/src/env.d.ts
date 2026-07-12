/// <reference types="vite/client" />

import type { ProjectData, SavePoint, IdeConfig } from '../../shared/types'
import type { UpdateInfo } from '../../shared/update'

export {}

declare global {
  interface Window {
    cside: {
      platform: string
      initialScene: string | null
      selftest: boolean
      diagnostic: boolean
      reportDiagnostic: (markdown: string) => Promise<void>
      versions: { electron: string; chrome: string; node: string }
      openProjectDialog: () => Promise<ProjectData | null>
      newProjectDialog: () => Promise<ProjectData | null>
      loadSample: () => Promise<ProjectData>
      loadTutorial: () => Promise<ProjectData>
      loadProject: (root: string) => Promise<ProjectData>
      getLastProject: () => Promise<string | null>
      setLastProject: (root: string) => Promise<void>
      writeScene: (scenesDir: string, name: string, text: string) => Promise<void>
      listSaves: (root: string) => Promise<SavePoint[]>
      writeSave: (root: string, save: SavePoint) => Promise<void>
      deleteSave: (root: string, id: string) => Promise<void>
      readConfig: (root: string) => Promise<IdeConfig>
      writeConfig: (root: string, config: IdeConfig) => Promise<void>
      createScene: (
        scenesDir: string,
        name: string
      ) => Promise<{ created: boolean; reason?: string }>
      exportHtml: (opts: {
        mygameJs: string
        scenes: Record<string, string>
        title: string
        author: string
      }) => Promise<string | null>
      exportImagePath: (defaultName: string) => Promise<string | null>
      exportImageWrite: (filePath: string, dataUrl: string) => Promise<void>
      updateCheck: () => Promise<UpdateInfo | null>
      updateApply: (info: UpdateInfo) => Promise<string>
      onUpdateProgress: (cb: (pct: number) => void) => () => void
    }
  }
}
