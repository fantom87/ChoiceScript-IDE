/**
 * Local file history: the snapshots taken automatically on every save of a
 * scene. Pick one to preview; Restore applies it as an UNDOABLE edit (so
 * even restoring is reversible).
 */
import { useEffect, useState } from 'react'

interface Entry {
  id: string
  ts: number
  size: number
}

function ago(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function HistoryPanel({
  scenesDir,
  scene,
  onRestore,
  onClose
}: {
  scenesDir: string
  scene: string
  onRestore: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [preview, setPreview] = useState('')

  useEffect(() => {
    window.cside
      .listHistory(scenesDir, scene)
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [scenesDir, scene])

  useEffect(() => {
    if (!sel) return
    window.cside
      .readHistory(scenesDir, scene, sel)
      .then(setPreview)
      .catch(() => setPreview('(could not read snapshot)'))
  }, [scenesDir, scene, sel])

  return (
    <div className="rename-overlay" onClick={onClose}>
      <div className="rename-box history-box" onClick={(e) => e.stopPropagation()}>
        <h3>🕘 History — {scene}.txt</h3>
        <p className="history-hint">
          A snapshot is kept each time a save overwrites this scene (last 25). Restoring is itself
          undoable (Ctrl+Z).
        </p>
        {entries === null ? (
          <p>Loading…</p>
        ) : entries.length === 0 ? (
          <p>No snapshots yet — they appear after your next save changes the file.</p>
        ) : (
          <div className="history-cols">
            <ul className="history-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button className={sel === e.id ? 'active' : ''} onClick={() => setSel(e.id)}>
                    {ago(e.ts)}
                    <span className="history-size">{(e.size / 1024).toFixed(1)} KB</span>
                  </button>
                </li>
              ))}
            </ul>
            <pre className="history-preview">{sel ? preview : 'Select a snapshot to preview it.'}</pre>
          </div>
        )}
        <div className="history-foot">
          <button className="header-btn" onClick={onClose}>
            Close
          </button>
          <button
            className="header-btn tut-next"
            disabled={!sel}
            onClick={() => {
              if (sel) {
                onRestore(preview)
                onClose()
              }
            }}
          >
            Restore this version
          </button>
        </div>
      </div>
    </div>
  )
}
