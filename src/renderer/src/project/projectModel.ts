import type { ProjectData } from '../../../shared/types'
import { generateMygameJs, getSceneList } from '../choicescript/mygameGen'

export interface SceneNode {
  name: string
  /** True if present in startup.txt's *scene_list. */
  listed: boolean
  /** True if referenced by *scene_list but missing on disk. */
  missing?: boolean
}

export interface LoadedProject {
  data: ProjectData
  /** Ordered scene names from *scene_list. */
  sceneList: string[]
  /** Scene tree: listed scenes in order, then unlisted files. */
  scenes: SceneNode[]
  startupText: string
  mygameJs: string
}

/** Derive scene list, tree, and generated mygame.js from a loaded project. */
export function buildProject(data: ProjectData): LoadedProject {
  const startupText = data.files['startup'] ?? ''
  const sceneList = getSceneList(startupText)
  const listedSet = new Set(sceneList)

  const scenes: SceneNode[] = []
  for (const name of sceneList) {
    scenes.push({ name, listed: true, missing: data.files[name] === undefined })
  }
  for (const name of Object.keys(data.files).sort()) {
    if (!listedSet.has(name)) scenes.push({ name, listed: false })
  }

  const mygameJs = generateMygameJs(startupText, data.files)
  return { data, sceneList, scenes, startupText, mygameJs }
}
