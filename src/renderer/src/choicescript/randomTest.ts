import type { Diagnostic } from './lint'
import { parseEngineError } from '../engine/enginePmProtocol'

export interface RandomResult {
  passed: boolean
  errors: Diagnostic[]
  /** Number of source lines never reached across all playthroughs. */
  uncovered: number
  summary: string
}

/** Parse the streamed randomtest console output into a structured result. */
export function parseRandomResults(messages: string[], iterations: number): RandomResult {
  const text = messages.join('\n')
  const failed = /RANDOMTEST FAILED/.test(text)
  const passed = /RANDOMTEST PASSED/.test(text) && !failed

  const errors: Diagnostic[] = []
  for (const m of messages) {
    const fail = /^RANDOMTEST FAILED:?\s*(.*)$/.exec(m)
    const raw = fail ? fail[1] : /\w+ line \d+:/.test(m) ? m : ''
    if (raw) {
      const p = parseEngineError(raw.replace(/^Error:\s*/, ''))
      errors.push({
        scene: p.scene ?? 'startup',
        line: (p.line ?? 1) - 1,
        startCol: 1,
        endCol: 1,
        severity: 'error',
        message: p.message,
        code: 'randomtest',
        deferred: true
      })
    }
  }

  // Coverage lines look like "scene <count>: <text>"; count 0 = never reached.
  let uncovered = 0
  for (const m of messages) {
    if (/^\w+ 0: /.test(m)) uncovered++
  }

  const summary = passed
    ? `RandomTest passed — ${iterations} playthroughs, ${uncovered} line(s) never reached`
    : `RandomTest FAILED after random play (${errors.length} error${errors.length === 1 ? '' : 's'})`

  return { passed, errors, uncovered, summary }
}

/** Run RandomTest in a worker, streaming console output; resolves when done. */
export function runRandomTest(
  mygameJs: string,
  files: Record<string, string>,
  iterations: number,
  seed: number,
  onLine?: (line: string) => void
): Promise<string[]> {
  return new Promise((resolve) => {
    const worker = new Worker('worker-random.js')
    const messages: string[] = []
    const scenes: Record<string, string> = {}
    for (const name in files) scenes[`${name}.txt`] = files[name]

    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m && m.type === 'DONE') {
        worker.terminate()
        resolve(messages)
        return
      }
      if (m && m.msg != null) {
        messages.push(String(m.msg))
        onLine?.(String(m.msg))
      }
    }
    worker.onerror = () => {
      worker.terminate()
      resolve(messages)
    }
    worker.postMessage({ type: 'RUN', mygameJs, scenes, iterations, seed })
  })
}
