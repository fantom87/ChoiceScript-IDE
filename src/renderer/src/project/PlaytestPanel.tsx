/**
 * Playtest Lab: seeded automated playthroughs with structured analytics —
 * ending distribution, stat ranges, rarely-picked options, reproducible
 * failures — plus a traversal heatmap the canvas can render.
 */
import { useRef, useState } from 'react'
import {
  runPlaytest,
  cancelPlaytest,
  nearestLabel,
  type PlaytestResult
} from '../choicescript/playtest'

export function PlaytestPanel({
  files,
  mygameJs,
  onJump,
  onHeat,
  onClose
}: {
  files: Record<string, string>
  mygameJs: string
  /** Jump the editor to (scene, 0-based line). */
  onJump: (scene: string, line0: number) => void
  /** Publish (or clear) the traversal heat for the node canvas. */
  onHeat: (heat: Record<string, number[]> | null) => void
  onClose: () => void
}): React.JSX.Element {
  const [runs, setRuns] = useState(500)
  const [strategy, setStrategy] = useState<'uniform' | 'coverage'>('uniform')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<PlaytestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startRef = useRef(0)

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress(`Running 0/${runs}…`)
    startRef.current = Date.now()
    try {
      const r = await runPlaytest(files, mygameJs, {
        runs,
        strategy,
        onProgress: (done, total) => setProgress(`Running ${done}/${total}…`)
      })
      setResult(r)
      onHeat(r.lineCoverage)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const endingName = (key: string, e: { scene: string | null; line: number }): string => {
    if (!e.scene) return 'ran out of scenes (*finish at the end)'
    const label = nearestLabel(files[e.scene] ?? '', e.line)
    return `${e.scene}${label ? ` — ${label}` : ''} (line ${e.line})`
  }

  const endings = result
    ? Object.entries(result.endings).sort((a, b) => b[1].count - a[1].count)
    : []
  const rare = result
    ? Object.values(result.choices)
        .flatMap((c) => {
          const visits = c.picks.reduce((a, b) => a + b, 0)
          return c.options.map((label, i) => ({
            scene: c.scene,
            line: c.line,
            label,
            picks: c.picks[i] ?? 0,
            rate: visits ? (c.picks[i] ?? 0) / visits : 0
          }))
        })
        .filter((o) => o.picks === 0)
        .slice(0, 12)
    : []
  const statRows = result
    ? Object.entries(result.statsAgg)
        .filter(([, a]) => a.n > 0 && (a.min !== a.max || a.min !== 0))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, 14)
    : []

  return (
    <div className="rename-overlay" onClick={onClose}>
      <div className="rename-box playtest-box" onClick={(e) => e.stopPropagation()}>
        <h3>🎲 Playtest Lab</h3>
        <div className="playtest-controls">
          <label>
            Runs{' '}
            <select value={runs} onChange={(e) => setRuns(Number(e.target.value))} disabled={busy}>
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={2000}>2,000</option>
              <option value={10000}>10,000</option>
            </select>
          </label>
          <label>
            Strategy{' '}
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as 'uniform' | 'coverage')}
              disabled={busy}
              title="Uniform picks options at random. Coverage-seeking prefers options it has picked least — finds rare branches faster."
            >
              <option value="uniform">Uniform random</option>
              <option value="coverage">Coverage-seeking</option>
            </select>
          </label>
          {busy ? (
            <button
              className="header-btn"
              onClick={() => {
                cancelPlaytest()
                setBusy(false)
                setProgress('')
              }}
            >
              Cancel
            </button>
          ) : (
            <button className="header-btn tut-next" onClick={() => void start()}>
              ▶ Run
            </button>
          )}
          <span className="playtest-progress">{progress}</span>
        </div>

        {error && <p className="update-err">Playtest failed: {error}</p>}

        {result && (
          <div className="playtest-results">
            <p className="playtest-summary">
              {result.completed.toLocaleString()}/{result.total.toLocaleString()} runs completed •{' '}
              {result.errors.length} error{result.errors.length === 1 ? '' : 's'} •{' '}
              {Math.round(result.steps / Math.max(1, result.completed))} choices per run •{' '}
              {((Date.now() - startRef.current) / 1000).toFixed(1)}s • heat painted on the canvas
            </p>

            {result.errors.length > 0 && (
              <>
                <h4>Errors (seeded — same seed reproduces the run)</h4>
                <ul className="playtest-list playtest-errors">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      <b>seed {e.seed}</b> — {e.message}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h4>Endings reached</h4>
            <ul className="playtest-list">
              {endings.map(([key, e]) => (
                <li key={key}>
                  <button
                    className="playtest-row"
                    onClick={() => e.scene && onJump(e.scene, e.line - 1)}
                  >
                    <span className="playtest-bar">
                      <span
                        className="playtest-bar-fill"
                        style={{ width: `${(e.count / Math.max(1, result.completed)) * 100}%` }}
                      />
                    </span>
                    <span className="playtest-pct">
                      {((e.count / Math.max(1, result.completed)) * 100).toFixed(1)}%
                    </span>
                    {endingName(key, e)}
                  </button>
                </li>
              ))}
            </ul>

            {rare.length > 0 && (
              <>
                <h4>Options never picked ({result.strategy === 'coverage' ? 'even coverage-seeking' : 'try coverage-seeking'})</h4>
                <ul className="playtest-list">
                  {rare.map((o, i) => (
                    <li key={i}>
                      <button className="playtest-row" onClick={() => onJump(o.scene, o.line - 1)}>
                        “{o.label}” — {o.scene} line {o.line}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {statRows.length > 0 && (
              <>
                <h4>Stats at game end</h4>
                <table className="playtest-stats">
                  <tbody>
                    {statRows.map(([name, a]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>min {a.min}</td>
                        <td>avg {(a.sum / a.n).toFixed(1)}</td>
                        <td>max {a.max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        <div className="history-foot">
          {result && (
            <button className="header-btn" onClick={() => onHeat(null)} title="Remove the traversal heat from the canvas">
              Clear heat
            </button>
          )}
          <button className="header-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
