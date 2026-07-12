import type { ChoiceNode, ChoiceOption, Terminator } from '../choicescript/choiceTree'

const TERM: Record<Terminator, { label: string; cls: string }> = {
  goto: { label: '→ goto', cls: 'ok' },
  gosub: { label: '→ gosub', cls: 'ok' },
  goto_scene: { label: '→ scene', cls: 'ok' },
  gosub_scene: { label: '→ gosub scene', cls: 'ok' },
  redirect_scene: { label: '→ redirect', cls: 'ok' },
  goto_random_scene: { label: '→ random scene', cls: 'ok' },
  finish: { label: '✓ finish', cls: 'ok' },
  ending: { label: '✓ ending', cls: 'ok' },
  return: { label: '↩ return', cls: 'ok' },
  restart: { label: '⟲ restart', cls: 'ok' },
  abort: { label: '⛔ abort', cls: 'ok' },
  nested: { label: '⋯ nested choice', cls: 'nested' },
  conditional: { label: '? conditional', cls: 'warn' },
  fallthrough: { label: '⚠ falls through', cls: 'error' }
}

interface ChoiceTreePanelProps {
  scene: string
  tree: ChoiceNode[]
  onJump: (line: number) => void
}

function OptionRow({
  opt,
  depth,
  onJump
}: {
  opt: ChoiceOption
  depth: number
  onJump: (line: number) => void
}) {
  const term = TERM[opt.terminator]
  const target = opt.target ? ` ${opt.target}` : ''
  return (
    <>
      <button
        className="ct-option"
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => onJump(opt.line)}
        title={`Line ${opt.line + 1}`}
      >
        <span className="ct-hash">#</span>
        <span className="ct-label">{opt.label}</span>
        <span className={`ct-term ${term.cls}`}>
          {term.label}
          {target}
        </span>
      </button>
      {opt.children.map((child, i) => (
        <ChoiceNodeRows key={i} node={child} depth={depth + 1} onJump={onJump} />
      ))}
    </>
  )
}

function ChoiceNodeRows({
  node,
  depth,
  onJump
}: {
  node: ChoiceNode
  depth: number
  onJump: (line: number) => void
}) {
  return (
    <>
      <button
        className="ct-choice"
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => onJump(node.line)}
      >
        *{node.type}
      </button>
      {node.options.map((opt, i) => (
        <OptionRow key={i} opt={opt} depth={depth + 1} onJump={onJump} />
      ))}
    </>
  )
}

export function ChoiceTreePanel({ scene, tree, onJump }: ChoiceTreePanelProps) {
  return (
    <div className="choice-tree">
      <div className="ct-header">Choice tree — {scene}</div>
      <div className="ct-body">
        {tree.length === 0 && <div className="ct-empty">No choices in this scene.</div>}
        {tree.map((node, i) => (
          <ChoiceNodeRows key={i} node={node} depth={0} onJump={onJump} />
        ))}
      </div>
    </div>
  )
}
