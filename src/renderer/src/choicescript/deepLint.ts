import type { Diagnostic } from './lint'

/**
 * Client for the deep-analysis Web Worker (worker-test.js). Runs the engine's
 * autotester over the whole project to find execution-time errors + coverage.
 * A single worker is reused; only the latest request resolves.
 */

let worker: Worker | null = null
let pending: ((d: Diagnostic[]) => void) | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker('worker-test.js')
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg && msg.type === 'RESULT' && pending) {
        const cb = pending
        pending = null
        cb((msg.diagnostics as Diagnostic[]) || [])
      }
    }
    worker.onerror = () => {
      if (pending) {
        const cb = pending
        pending = null
        cb([])
      }
    }
  }
  return worker
}

export function runDeepLint(
  files: Record<string, string>,
  sceneList: string[]
): Promise<Diagnostic[]> {
  return new Promise((resolve) => {
    pending = resolve
    getWorker().postMessage({
      type: 'RUN',
      engineBase: 'app://engine',
      files,
      sceneList
    })
  })
}
