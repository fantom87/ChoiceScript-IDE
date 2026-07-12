/**
 * Prose word counting. Counts player-facing words only: skips *command lines
 * and the leading # of choice options, strips interpolation/formatting markup,
 * counts what's left. Pure — tested in diagnose.ts.
 */

export function countWords(text: string): number {
  let words = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('*')) continue // command line
    // Choice option: count the label text (drop the leading #).
    const prose = line.replace(/^#/, ' ')
    const cleaned = prose
      .replace(/\[\/?[a-zA-Z]+\/?\]/g, ' ') // [b] [/i] [n/] tags
      .replace(/[$@]!?\{[^}]*\}/g, ' x ') // ${var} / @{...} count as one word
      .replace(/[^\w'-]+/g, ' ')
    const parts = cleaned.split(/\s+/).filter(Boolean)
    words += parts.length
  }
  return words
}

/** Word count per scene plus the project total. */
export function countProject(files: Record<string, string>): {
  perScene: Record<string, number>
  total: number
} {
  const perScene: Record<string, number> = {}
  let total = 0
  for (const scene in files) {
    const n = countWords(files[scene])
    perScene[scene] = n
    total += n
  }
  return { perScene, total }
}
