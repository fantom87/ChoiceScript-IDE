import { useState } from 'react'

interface RandomTestPanelProps {
  running: boolean
  log: string[]
  summary: string | null
  onRun: (iterations: number, seed: number) => void
  onClose: () => void
}

export function RandomTestPanel({ running, log, summary, onRun, onClose }: RandomTestPanelProps) {
  const [iterations, setIterations] = useState(1000)
  const [seed, setSeed] = useState(0)

  return (
    <div className="rt-overlay">
      <div className="rt-panel">
        <div className="rt-header">
          <span>RandomTest</span>
          <button className="rt-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="rt-controls">
          <label>
            Iterations
            <input
              type="number"
              min={1}
              value={iterations}
              onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label>
            Seed
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
          <button className="rt-run" disabled={running} onClick={() => onRun(iterations, seed)}>
            {running ? 'Running…' : '▶ Run'}
          </button>
        </div>

        {summary && (
          <div className={`rt-summary ${summary.includes('FAILED') ? 'fail' : 'pass'}`}>{summary}</div>
        )}

        <pre className="rt-log">{log.slice(-400).join('\n')}</pre>
      </div>
    </div>
  )
}
