import type { StatDef } from '../choicescript/stats'

interface StatSeedFormProps {
  scene: string
  stats: StatDef[]
  onEdit: (name: string, value: string) => void
  onRandomize: () => void
  onRun: () => void
  onClose: () => void
}

export function StatSeedForm({
  scene,
  stats,
  onEdit,
  onRandomize,
  onRun,
  onClose
}: StatSeedFormProps) {
  return (
    <div className="seed-form">
      <div className="seed-header">
        <span>
          Preview <strong>{scene}</strong> in isolation
        </span>
        <button className="seed-close" title="Cancel" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="seed-hint">
        Seed the stats this scene needs, then run it from the top. Array stats fill
        from their defaults automatically.
      </div>

      <div className="seed-list">
        {stats.length === 0 && (
          <div className="seed-empty">No *create stats declared in startup.txt.</div>
        )}
        {stats.map((s) => (
          <label key={s.name} className="seed-row">
            <span className="seed-name">{s.name}</span>
            {s.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={/^true$/i.test(s.value)}
                onChange={(e) => onEdit(s.name, e.target.checked ? 'true' : 'false')}
              />
            ) : s.type === 'number' ? (
              <input
                type="number"
                className="seed-input"
                value={s.value}
                onChange={(e) => onEdit(s.name, e.target.value)}
              />
            ) : (
              <input
                type="text"
                className="seed-input"
                value={s.value}
                onChange={(e) => onEdit(s.name, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>

      <div className="seed-actions">
        <button className="seed-btn" onClick={onRandomize}>
          🎲 Randomize
        </button>
        <button className="seed-btn seed-run" onClick={onRun}>
          ▶ Run scene
        </button>
      </div>
    </div>
  )
}
