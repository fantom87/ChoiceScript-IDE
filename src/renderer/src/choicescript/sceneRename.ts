/**
 * Rename a scene across the whole project: its *scene_list entry plus every
 * *goto_scene / *gosub_scene / *redirect_scene reference (label arguments
 * preserved). Pure — returns only the files whose text changed; the caller
 * renames the actual file. Diag-tested.
 */

const REF_COMMANDS = ['goto_scene', 'gosub_scene', 'redirect_scene']

export function renameSceneRefs(
  files: Record<string, string>,
  oldName: string,
  newName: string
): Record<string, string> {
  const changed: Record<string, string> = {}
  const refRe = new RegExp(`^(\\s*\\*(?:${REF_COMMANDS.join('|')})\\s+)${oldName}(\\s|$)`)
  for (const scene of Object.keys(files)) {
    const lines = files[scene].split(/\r?\n/)
    let touched = false
    let inSceneList = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Track the *scene_list block (its entries are the indented lines that
      // immediately follow; the block ends at the first non-indented line).
      if (/^\*scene_list\b/.test(line)) {
        inSceneList = true
        continue
      }
      if (inSceneList) {
        if (/^\s+\S/.test(line)) {
          if (line.trim() === oldName) {
            lines[i] = line.replace(oldName, newName)
            touched = true
          }
          continue
        }
        inSceneList = false
      }
      const m = refRe.exec(line)
      if (m) {
        lines[i] = line.replace(refRe, `$1${newName}$2`)
        touched = true
      }
    }
    if (touched) changed[scene] = lines.join('\n')
  }
  return changed
}

export function validSceneName(name: string): boolean {
  return /^[\w-]+$/.test(name)
}
