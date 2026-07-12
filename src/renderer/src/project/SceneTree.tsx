import type { SceneNode } from './projectModel'

interface SceneTreeProps {
  scenes: SceneNode[]
  activeScene: string | null
  dirty: Set<string>
  onSelect: (name: string) => void
}

export function SceneTree({ scenes, activeScene, dirty, onSelect }: SceneTreeProps) {
  const listed = scenes.filter((s) => s.listed)
  const unlisted = scenes.filter((s) => !s.listed)

  const renderRow = (s: SceneNode) => (
    <button
      key={s.name}
      className={`scene-row ${s.name === activeScene ? 'active' : ''} ${s.missing ? 'missing' : ''}`}
      onClick={() => !s.missing && onSelect(s.name)}
      title={s.missing ? `${s.name} is in *scene_list but has no file` : `${s.name}.txt`}
    >
      <span className="scene-name">{s.name}</span>
      {dirty.has(s.name) && <span className="scene-dirty" title="Unsaved changes">●</span>}
      {s.missing && <span className="scene-badge">missing</span>}
    </button>
  )

  return (
    <div className="scene-tree">
      <div className="scene-group-label">Scenes</div>
      {listed.map(renderRow)}
      {unlisted.length > 0 && (
        <>
          <div className="scene-group-label">Other files</div>
          {unlisted.map(renderRow)}
        </>
      )}
    </div>
  )
}
