/**
 * Insert a scene name into startup.txt's *scene_list block (at the end, matching
 * the block's indentation). Returns the text unchanged if there's no *scene_list
 * or the scene is already listed. Pure — unit-tested in diagnose.ts.
 */
export function insertIntoSceneList(startupText: string, sceneName: string): string {
  const lines = startupText.split(/\r?\n/)
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\*scene_list\b/.test(lines[i])) {
      idx = i
      break
    }
  }
  if (idx === -1) return startupText

  let last = idx
  let indent = '  '
  let seen = false
  for (let j = idx + 1; j < lines.length; j++) {
    if (!lines[j].trim()) {
      if (seen) break
      continue
    }
    const m = /^(\s+)/.exec(lines[j])
    if (!m) break // dedented — end of the list
    seen = true
    last = j
    indent = m[1]
    if (lines[j].trim().toLowerCase() === sceneName.toLowerCase()) return startupText
  }

  lines.splice(last + 1, 0, indent + sceneName)
  return lines.join('\n')
}
