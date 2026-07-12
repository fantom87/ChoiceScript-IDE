import type { ChoiceScriptIndex } from '../editor/setupMonaco'

/**
 * Scan project files for author-defined symbols used by editor completion:
 * variables (*create/*temp[_array]), scene names, and labels per scene.
 */
export function buildChoiceScriptIndex(
  files: Record<string, string>,
  sceneList: string[]
): ChoiceScriptIndex {
  const variables = new Set<string>()
  const labelsByScene: Record<string, string[]> = {}

  for (const scene in files) {
    const labels: string[] = []
    for (const raw of files[scene].split(/\r?\n/)) {
      const line = raw.trim()
      // *create / *temp  <name> ...
      let m = /^\*(?:create|temp)\s+(\w+)/.exec(line)
      if (m) variables.add(m[1].toLowerCase())
      // *create_array / *temp_array  <name> <len> ...
      m = /^\*(?:create_array|temp_array)\s+(\w+)/.exec(line)
      if (m) {
        variables.add(m[1].toLowerCase())
        variables.add(`${m[1].toLowerCase()}_count`)
      }
      // *label <name>
      m = /^\*label\s+(\w+)/.exec(line)
      if (m) labels.push(m[1])
    }
    labelsByScene[scene] = labels
  }

  const scenes = Array.from(new Set([...sceneList, ...Object.keys(files)]))
  return { variables: Array.from(variables).sort(), scenes, labelsByScene }
}
