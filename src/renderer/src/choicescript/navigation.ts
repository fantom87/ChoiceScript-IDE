/**
 * Go-to-definition, project search, and rename logic. Pure — tested in
 * diagnose.ts. UI in App wires these to the editor and panels.
 */

export interface SourceLoc {
  scene: string
  /** 0-based line. */
  line: number
}

function findLabel(text: string, name: string): number {
  const lines = text.split(/\r?\n/)
  const lc = name.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\*label\s+(\w+)/.exec(lines[i])
    if (m && m[1].toLowerCase() === lc) return i
  }
  return -1
}

function findVarDef(files: Record<string, string>, scene: string, name: string): SourceLoc | null {
  const lc = name.toLowerCase()
  const scan = (text: string, cmd: RegExp): number => {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = cmd.exec(lines[i])
      if (m && m[1].toLowerCase() === lc) return i
    }
    return -1
  }
  const tempLine = scan(files[scene] ?? '', /^\s*\*temp(?:_array)?\s+(\w+)/)
  if (tempLine >= 0) return { scene, line: tempLine }
  const createLine = scan(files['startup'] ?? '', /^\s*\*create(?:_array)?\s+(\w+)/)
  if (createLine >= 0) return { scene: 'startup', line: createLine }
  return null
}

/** Resolve the definition of the token clicked/at-cursor. */
export function resolveDefinition(
  files: Record<string, string>,
  currentScene: string,
  lineText: string,
  word: string
): SourceLoc | null {
  const w = word.toLowerCase()

  const gsub = /^\s*\*(?:goto|gosub)\s+(\w+)/.exec(lineText)
  if (gsub && gsub[1].toLowerCase() === w) {
    const line = findLabel(files[currentScene] ?? '', w)
    if (line >= 0) return { scene: currentScene, line }
  }

  const gscene = /^\s*\*(?:goto_scene|gosub_scene|redirect_scene)\s+(\w+)(?:\s+(\w+))?/.exec(lineText)
  if (gscene) {
    if (gscene[1].toLowerCase() === w && files[gscene[1]] !== undefined) {
      return { scene: gscene[1], line: 0 }
    }
    if (gscene[2] && gscene[2].toLowerCase() === w) {
      const line = findLabel(files[gscene[1]] ?? '', w)
      if (line >= 0) return { scene: gscene[1], line }
    }
  }

  const varDef = findVarDef(files, currentScene, w)
  if (varDef) return varDef

  const label = findLabel(files[currentScene] ?? '', w)
  if (label >= 0) return { scene: currentScene, line: label }

  if (files[word] !== undefined) return { scene: word, line: 0 }
  return null
}

export interface SearchHit {
  scene: string
  line: number
  column: number
  preview: string
}

/** Search every scene for a query (plain or regex). */
export function searchProject(
  files: Record<string, string>,
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean } = {}
): SearchHit[] {
  if (!query) return []
  const hits: SearchHit[] = []
  let re: RegExp
  try {
    const flags = opts.caseSensitive ? 'g' : 'gi'
    re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    return []
  }
  for (const scene of Object.keys(files).sort()) {
    const lines = files[scene].split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      const m = re.exec(lines[i])
      if (m) hits.push({ scene, line: i, column: m.index + 1, preview: lines[i].trim() })
    }
  }
  return hits
}

/** Replace all matches of a query across the project. Returns changed files. */
export function replaceProject(
  files: Record<string, string>,
  query: string,
  replacement: string,
  opts: { regex?: boolean; caseSensitive?: boolean } = {}
): Record<string, string> {
  const changed: Record<string, string> = {}
  let re: RegExp
  try {
    const flags = opts.caseSensitive ? 'g' : 'gi'
    re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    return changed
  }
  for (const scene in files) {
    const next = files[scene].replace(re, replacement)
    if (next !== files[scene]) changed[scene] = next
  }
  return changed
}

export type SymbolKind = 'variable' | 'label' | 'scene'

/** Classify the symbol at the cursor for rename. */
export function detectSymbol(lineText: string, word: string): SymbolKind {
  const w = word.toLowerCase()
  const gscene = /^\s*\*(?:goto_scene|gosub_scene|redirect_scene)\s+(\w+)/.exec(lineText)
  if (gscene && gscene[1].toLowerCase() === w) return 'scene'
  if (/^\s*\*(?:goto|gosub|label)\s+(\w+)/.test(lineText)) {
    const m = /^\s*\*(?:goto|gosub|label)\s+(\w+)/.exec(lineText)!
    if (m[1].toLowerCase() === w) return 'label'
  }
  return 'variable'
}

/** Rename a variable across all scenes (whole-word). Returns changed files. */
export function renameVariable(
  files: Record<string, string>,
  oldName: string,
  newName: string
): Record<string, string> {
  const re = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
  const changed: Record<string, string> = {}
  for (const scene in files) {
    const next = files[scene].replace(re, newName)
    if (next !== files[scene]) changed[scene] = next
  }
  return changed
}

/** Rename a label within a single scene (its *label + *goto/*gosub refs). */
export function renameLabel(
  files: Record<string, string>,
  scene: string,
  oldName: string,
  newName: string
): Record<string, string> {
  const text = files[scene]
  if (text === undefined) return {}
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const next = text
    .split(/\r?\n/)
    .map((ln) => {
      const m = /^(\s*\*(?:label|goto|gosub)\s+)(\w+)(.*)$/.exec(ln)
      if (m && m[2].toLowerCase() === oldName.toLowerCase()) return m[1] + newName + m[3]
      return ln
    })
    .join('\n')
  return next !== text ? { [scene]: next } : {}
}
