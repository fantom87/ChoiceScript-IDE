import { useMemo, useState } from 'react'
import { searchProject } from '../choicescript/navigation'

interface FindPanelProps {
  files: Record<string, string>
  onNavigate: (scene: string, line: number, column: number) => void
  onReplaceAll: (query: string, replacement: string, opts: { regex: boolean; caseSensitive: boolean }) => void
  onClose: () => void
}

export function FindPanel({ files, onNavigate, onReplaceAll, onClose }: FindPanelProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)

  const results = useMemo(
    () => searchProject(files, query, { regex, caseSensitive }),
    [files, query, regex, caseSensitive]
  )

  return (
    <div className="find-panel">
      <div className="find-header">
        <span>Find in Project</span>
        <button className="find-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="find-row">
        <input
          className="find-input"
          autoFocus
          placeholder="Search all scenes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label title="Regular expression">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
          .*
        </label>
        <label title="Case sensitive">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Aa
        </label>
      </div>
      <div className="find-row">
        <input
          className="find-input"
          placeholder="Replace with…"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <button
          className="find-replace"
          disabled={!query}
          onClick={() => onReplaceAll(query, replacement, { regex, caseSensitive })}
        >
          Replace All
        </button>
      </div>
      <div className="find-count">
        {query ? `${results.length} match${results.length === 1 ? '' : 'es'}` : 'Type to search'}
      </div>
      <div className="find-results">
        {results.slice(0, 500).map((r, i) => (
          <button key={i} className="find-result" onClick={() => onNavigate(r.scene, r.line, r.column)}>
            <span className="find-loc">
              {r.scene}:{r.line + 1}
            </span>
            <span className="find-preview">{r.preview}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
