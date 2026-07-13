/** Shared types used across main, preload, and renderer. */

/** A loaded ChoiceScript project. */
export interface ProjectData {
  /** The folder the user opened. */
  root: string
  /** The directory containing the scene .txt files. */
  scenesDir: string
  /** Map of scene name (no `.txt`) to its full source text. */
  files: Record<string, string>
}

/** User-customisable colours for the node types on the canvas. */
export interface TypeColors {
  text?: string
  command?: string
  choice?: string
  option?: string
  if?: string
}

/** Per-project IDE settings, stored in <root>/.cside/config.json. */
export interface IdeConfig {
  indentStyle: 'tab' | 'space'
  indentWidth: number
  /** Colour code-editor commands to match the node canvas palette. */
  matchNodeColors?: boolean
  /** Custom node-type colours (canvas headers + option edges). */
  typeColors?: TypeColors
  /** Prose spellcheck squiggles in the editor (default on). */
  spellcheck?: boolean
  /** Project dictionary: words the spellchecker should accept (lowercased). */
  spellIgnore?: string[]
}

export const DEFAULT_CONFIG: IdeConfig = { indentStyle: 'space', indentWidth: 2, matchNodeColors: true }

/** A saved game state the author can jump back to. */
export interface SavePoint {
  id: string
  name: string
  /** Scene the save lands in. */
  scene: string
  /** 0-based line number within the scene. */
  lineNum: number
  /** ISO timestamp. */
  createdAt: string
  /** True for rotating autosaves, false for manual saves. */
  auto: boolean
  /** The computeCookie() JSON state string. */
  state: string
}
