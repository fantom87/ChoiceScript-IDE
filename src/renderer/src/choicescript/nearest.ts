/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/**
 * Closest candidate to `word` within a sensible edit-distance threshold,
 * or null if nothing is close enough (avoids nonsense suggestions).
 */
export function nearest(candidates: Iterable<string>, word: string): string | null {
  const w = word.toLowerCase()
  const threshold = Math.max(2, Math.floor(w.length * 0.4))
  let best: string | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    if (c === word) continue
    const d = levenshtein(w, c.toLowerCase())
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best !== null && bestDist <= threshold ? best : null
}
