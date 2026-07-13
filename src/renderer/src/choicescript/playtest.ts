/**
 * Client for the Playtest Lab worker: seeded automated playthroughs with
 * structured results (endings, stats, per-choice pick rates, line heat).
 */

export interface PlaytestChoice {
  scene: string
  line: number
  options: string[]
  picks: number[]
}

export interface PlaytestResult {
  total: number
  completed: number
  seedBase: number
  strategy: 'uniform' | 'coverage'
  errors: { seed: number; message: string }[]
  endings: Record<string, { scene: string | null; line: number; count: number }>
  statsAgg: Record<string, { min: number; max: number; sum: number; n: number }>
  choices: Record<string, PlaytestChoice>
  /** scene -> visits per 1-based line (heat). */
  lineCoverage: Record<string, number[]>
  steps: number
}

export interface PlaytestOptions {
  runs: number
  strategy: 'uniform' | 'coverage'
  seedBase?: number
  onProgress?: (done: number, total: number) => void
}

let worker: Worker | null = null
let active: {
  resolve: (r: PlaytestResult) => void
  reject: (e: Error) => void
  onProgress?: (done: number, total: number) => void
} | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker('worker-playtest.js')
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (!active) return
      if (msg?.type === 'PROGRESS') {
        active.onProgress?.(msg.done, msg.total)
      } else if (msg?.type === 'RESULT') {
        const a = active
        active = null
        if (msg.result) a.resolve(msg.result as PlaytestResult)
        else a.reject(new Error(msg.error || 'playtest failed'))
      }
    }
    worker.onerror = (e) => {
      const a = active
      active = null
      a?.reject(new Error(e.message || 'playtest worker error'))
    }
  }
  return worker
}

/** Kill the worker mid-run (a fresh one spawns on the next run). */
export function cancelPlaytest(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  const a = active
  active = null
  a?.reject(new Error('cancelled'))
}

export function runPlaytest(
  files: Record<string, string>,
  mygameJs: string,
  opts: PlaytestOptions
): Promise<PlaytestResult> {
  return new Promise((resolve, reject) => {
    if (active) {
      reject(new Error('a playtest is already running'))
      return
    }
    active = { resolve, reject, onProgress: opts.onProgress }
    getWorker().postMessage({
      type: 'RUN',
      engineBase: 'app://engine',
      files,
      mygameJs,
      runs: opts.runs,
      strategy: opts.strategy,
      seedBase: opts.seedBase ?? 0
    })
  })
}

/** The nearest *label at or above `line` (1-based) — names an ending nicely. */
export function nearestLabel(sceneText: string, line: number): string | null {
  const lines = sceneText.split(/\r?\n/)
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = /^\s*\*label\s+(\S+)/.exec(lines[i])
    if (m) return m[1]
  }
  return null
}
