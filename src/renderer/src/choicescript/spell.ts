/**
 * Prose spellcheck for ChoiceScript: extracts the WORDS a player will read —
 * skipping command lines, ${…}/@{…} interpolations, [b]-style markup, option
 * modifiers — and checks them against a hunspell dictionary (nspell).
 * Pure/injectable: the dictionary instance is passed in, so the logic is
 * fully diag-testable in Node.
 */

export interface ProseWord {
  word: string
  /** 1-based line. */
  line: number
  /** 1-based inclusive start / exclusive end columns (Monaco convention). */
  startCol: number
  endCol: number
}

/** Minimal surface of an nspell instance the checker needs. */
export interface SpellDict {
  correct: (word: string) => boolean
  suggest: (word: string) => string[]
  add: (word: string) => unknown
}

const WORD_RE = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g

/** Blank out a span in-place (keeps columns aligned with the original). */
function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end && i < chars.length; i++) chars[i] = ' '
}

/** Mask the non-prose parts of a line, preserving character positions. */
export function maskLine(raw: string): string | null {
  const trimmed = raw.trimStart()
  if (trimmed === '' || trimmed.startsWith('*comment')) return null
  const chars = [...raw]
  if (trimmed.startsWith('*')) return null // command line — no player prose
  // #Option lines: the '#' and any modifier prefix are structure; what
  // follows is prose. (Modifier-prefixed options start with '*' → skipped.)
  const hash = raw.indexOf('#')
  if (trimmed.startsWith('#')) blank(chars, 0, hash + 1)
  const s = chars.join('')
  // Interpolations + multireplace + [markup] are not player-spelled prose.
  // (Positions are stable: blanking preserves length, and each pattern is
  // matched against the original string.)
  for (const re of [/\$!?\{[^}]*\}/g, /@\{[^}]*\}/g, /\[[^\]]*\]/g]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) blank(chars, m.index, m.index + m[0].length)
  }
  return chars.join('')
}

/** All prose words in a scene, with Monaco-style positions. */
export function extractProseWords(text: string): ProseWord[] {
  const out: ProseWord[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const masked = maskLine(lines[i])
    if (masked === null) continue
    let m: RegExpExecArray | null
    WORD_RE.lastIndex = 0
    while ((m = WORD_RE.exec(masked))) {
      const w = m[0]
      if (w.length < 2) continue
      if (/^[A-Z']+$/.test(w)) continue // shouting/acronyms are style, not spelling
      out.push({ word: w, line: i + 1, startCol: m.index + 1, endCol: m.index + 1 + w.length })
    }
  }
  return out
}

export interface Misspelling extends ProseWord {}

/** Words the dictionary rejects (ignore list + normalised apostrophes). */
export function checkProse(dict: SpellDict, text: string, ignore: ReadonlySet<string>): Misspelling[] {
  const out: Misspelling[] = []
  const seenOk = new Set<string>() // per-call cache: dictionaries are slow-ish
  const seenBad = new Set<string>()
  for (const pw of extractProseWords(text)) {
    const norm = pw.word.replace(/’/g, "'")
    const key = norm.toLowerCase()
    if (ignore.has(key) || seenOk.has(key)) continue
    if (!seenBad.has(key)) {
      if (dict.correct(norm) || dict.correct(norm.toLowerCase())) {
        seenOk.add(key)
        continue
      }
      seenBad.add(key)
    }
    out.push(pw)
  }
  return out
}
