import { useMemo, useState } from 'react'
import {
  parseScene,
  generateScene,
  applyValue,
  editableValue,
  type CommandNode,
  type TextNode
} from '../choicescript/ast'

interface Props {
  startupText: string
  onSave: (newStartupText: string) => void
  onClose: () => void
}

/** Form-style editing for startup.txt's "ceremony": title, author, scene
 *  order, stats, achievements — no nodes or code required. */
export function GameSettingsPanel({ startupText, onSave, onClose }: Props) {
  const ast = useMemo(() => parseScene(startupText), [startupText])
  const model = useMemo(() => {
    const cmds = (name: string): CommandNode[] =>
      ast.filter((n): n is CommandNode => n.type === 'command' && n.name === name)
    const title = cmds('title')[0]
    const author = cmds('author')[0]
    const sceneList = cmds('scene_list')[0]
    const li = sceneList ? ast.indexOf(sceneList) : -1
    const listText = li >= 0 && ast[li + 1]?.type === 'text' ? (ast[li + 1] as TextNode) : null
    const creates = cmds('create')
    const achievements = cmds('achievement')
    return { title, author, listText, creates, achievements }
  }, [ast])

  const [title, setTitle] = useState(model.title ? editableValue(model.title) : '')
  const [author, setAuthor] = useState(model.author ? editableValue(model.author) : '')
  const [scenes, setScenes] = useState(
    model.listText ? model.listText.raw.map((l) => l.trim()).filter(Boolean).join('\n') : ''
  )
  const [stats, setStats] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const c of model.creates) {
      const m = /^(\w+)\s*(.*)$/.exec(editableValue(c))
      if (m) out[m[1]] = m[2]
    }
    return out
  })

  const save = (): void => {
    if (model.title) applyValue(model.title, title)
    if (model.author) applyValue(model.author, author)
    if (model.listText) {
      const indent = /^[ \t]*/.exec(model.listText.raw.find((l) => l.trim()) ?? '  ')![0] || '  '
      model.listText.raw = scenes
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `${indent}${l}`)
    }
    for (const c of model.creates) {
      const m = /^(\w+)/.exec(editableValue(c))
      if (m && stats[m[1]] !== undefined) applyValue(c, `${m[1]} ${stats[m[1]]}`)
    }
    onSave(generateScene(ast))
    onClose()
  }

  return (
    <div className="rename-overlay" onClick={onClose}>
      <div className="rename-box settings-box" onClick={(e) => e.stopPropagation()}>
        <h3>Game Settings</h3>
        <label className="settings-row">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
        </label>
        <label className="settings-row">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} spellCheck={false} />
        </label>
        <label className="settings-row settings-col">
          <span>Scene order (one per line — the game plays top to bottom)</span>
          <textarea
            value={scenes}
            onChange={(e) => setScenes(e.target.value)}
            spellCheck={false}
            rows={Math.min(12, Math.max(4, scenes.split('\n').length + 1))}
          />
        </label>
        {Object.keys(stats).length > 0 && (
          <div className="settings-col">
            <span className="settings-label">Starting stats (*create)</span>
            <div className="settings-stats">
              {Object.entries(stats).map(([name, value]) => (
                <label key={name} className="settings-stat">
                  <span>{name}</span>
                  <input
                    value={value}
                    spellCheck={false}
                    onChange={(e) => setStats((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {model.achievements.length > 0 && (
          <div className="settings-col">
            <span className="settings-label">Achievements (edit in code / node view)</span>
            <div className="settings-ach">
              {model.achievements.map((a, i) => (
                <span key={i}>{editableValue(a).split(/\s+/)[0]}</span>
              ))}
            </div>
          </div>
        )}
        <div className="settings-actions">
          <button className="tb-button" onClick={save}>
            Save
          </button>
          <button className="tb-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
