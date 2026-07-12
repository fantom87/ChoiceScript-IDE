/**
 * Indentation detection + normalization. ChoiceScript is indentation-significant,
 * so normalization preserves each line's logical depth and only re-emits the
 * whitespace unit (tabs vs N spaces). Pure — unit-tested in diagnose.ts.
 */

export interface IndentConfig {
  style: 'tab' | 'space'
  width: number
}

/** Detect a file's indent unit (tabs, or the smallest space step used). */
export function detectIndentUnit(text: string): IndentConfig {
  let usesTab = false
  let minSpaces = Infinity
  for (const line of text.split(/\r?\n/)) {
    const m = /^([ \t]+)\S/.exec(line)
    if (!m) continue
    if (m[1].includes('\t')) usesTab = true
    else if (m[1].length < minSpaces) minSpaces = m[1].length
  }
  if (usesTab) return { style: 'tab', width: 1 }
  if (minSpaces !== Infinity) return { style: 'space', width: minSpaces }
  return { style: 'space', width: 2 }
}

export interface NormalizeResult {
  text: string
  /** Number of lines whose indentation changed. */
  changed: number
  /** 1-based line numbers with ambiguous (mixed tab+space) indentation. */
  ambiguous: number[]
}

/** Re-emit every line's indentation in the target unit, preserving depth. */
export function normalizeIndentation(text: string, target: IndentConfig): NormalizeResult {
  const src = detectIndentUnit(text)
  const spaceStep = src.style === 'space' ? src.width : 2
  const lines = text.split(/\r?\n/)
  const ambiguous: number[] = []
  let changed = 0

  const out = lines.map((line, i) => {
    const m = /^([ \t]*)(.*)$/.exec(line)!
    const ws = m[1]
    const rest = m[2]
    if (rest === '') return line // blank line — leave as-is

    let depth: number
    if (ws.includes('\t') && ws.includes(' ')) {
      ambiguous.push(i + 1)
      const tabs = (ws.match(/\t/g) || []).length
      const spaces = (ws.match(/ /g) || []).length
      depth = tabs + Math.round(spaces / spaceStep)
    } else if (ws.includes('\t')) {
      depth = ws.length // tabs: one per level
    } else {
      depth = Math.round(ws.length / spaceStep)
    }

    const newWs = target.style === 'tab' ? '\t'.repeat(depth) : ' '.repeat(depth * target.width)
    const newLine = newWs + rest
    if (newLine !== line) changed++
    return newLine
  })

  return { text: out.join('\n'), changed, ambiguous }
}
