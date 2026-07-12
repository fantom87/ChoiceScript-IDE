import type { Diagnostic } from '../choicescript/lint'

interface ProblemsPanelProps {
  problems: Diagnostic[]
  onSelect: (scene: string, line: number, column: number) => void
}

const ICON: Record<string, string> = { error: '⨯', warning: '⚠', info: 'ℹ' }

export function ProblemsPanel({ problems, onSelect }: ProblemsPanelProps) {
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length
  const infos = problems.filter((p) => p.severity === 'info').length

  return (
    <div className="problems-panel">
      <div className="problems-header">
        <span>Problems</span>
        <span className="problems-counts">
          <span className="count-error">⨯ {errors}</span>
          <span className="count-warning">⚠ {warnings}</span>
          {infos > 0 && <span className="count-info">ℹ {infos}</span>}
        </span>
      </div>
      <div className="problems-list">
        {problems.length === 0 && <div className="problems-empty">No problems detected</div>}
        {problems.map((p, i) => (
          <button
            key={`${p.scene}:${p.line}:${p.code}:${i}`}
            className={`problem-row ${p.severity}`}
            onClick={() => onSelect(p.scene, p.line, p.startCol)}
          >
            <span className={`problem-icon ${p.severity}`}>{ICON[p.severity]}</span>
            <span className="problem-msg">{p.message}</span>
            {p.deferred && <span className="problem-tag">deep</span>}
            <span className="problem-loc">
              {p.scene}:{p.line + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
