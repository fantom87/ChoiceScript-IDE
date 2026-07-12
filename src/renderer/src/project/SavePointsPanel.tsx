import { useState } from 'react'
import type { SavePoint } from '../../../shared/types'

interface SavePointsPanelProps {
  saves: SavePoint[]
  autosave: boolean
  onToggleAutosave: (value: boolean) => void
  onSaveCurrent: () => void
  onJump: (save: SavePoint) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function relTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

export function SavePointsPanel({
  saves,
  autosave,
  onToggleAutosave,
  onSaveCurrent,
  onJump,
  onRename,
  onDelete
}: SavePointsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const commit = () => {
    if (editingId && editValue.trim()) onRename(editingId, editValue.trim())
    setEditingId(null)
  }

  const manual = saves.filter((s) => !s.auto)
  const auto = saves.filter((s) => s.auto)

  const renderRow = (s: SavePoint) => (
    <div key={s.id} className="save-row">
      {editingId === s.id ? (
        <input
          className="save-rename"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditingId(null)
          }}
        />
      ) : (
        <button className="save-jump" title="Jump to this point" onClick={() => onJump(s)}>
          <span className="save-name">{s.name}</span>
          <span className="save-meta">
            {s.scene}:{s.lineNum + 1} · {relTime(s.createdAt)}
          </span>
        </button>
      )}
      <div className="save-actions">
        {!s.auto && (
          <button
            className="save-btn"
            title="Rename"
            onClick={() => {
              setEditingId(s.id)
              setEditValue(s.name)
            }}
          >
            ✎
          </button>
        )}
        <button className="save-btn" title="Delete" onClick={() => onDelete(s.id)}>
          ✕
        </button>
      </div>
    </div>
  )

  return (
    <div className="saves-panel">
      <div className="saves-header">
        <span>Save Points</span>
        <button className="saves-add" title="Save current position" onClick={onSaveCurrent}>
          ＋ Save
        </button>
      </div>
      <label className="saves-autosave">
        <input
          type="checkbox"
          checked={autosave}
          onChange={(e) => onToggleAutosave(e.target.checked)}
        />
        Autosave at each choice
      </label>
      <div className="saves-list">
        {saves.length === 0 && <div className="saves-empty">No save points yet</div>}
        {manual.map(renderRow)}
        {auto.length > 0 && <div className="saves-group-label">Autosaves</div>}
        {auto.map(renderRow)}
      </div>
    </div>
  )
}
