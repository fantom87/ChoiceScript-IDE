import { useState } from 'react'
import { SNIPPETS, choiceSnippet } from './snippets'

interface Item {
  label: string
  keyLabel: string
  snippet: string
}

const ITEMS: Item[] = [
  { label: '*choice (3 options)', keyLabel: 'Alt+T then 2–9', snippet: choiceSnippet(3) },
  { label: '*fake_choice (3 options)', keyLabel: 'Alt+F then 2–9', snippet: choiceSnippet(3, true) },
  ...SNIPPETS.map((s) => ({ label: s.label, keyLabel: s.keyLabel, snippet: s.snippet })),
  { label: 'Bold [b]…[/b]', keyLabel: 'Alt+B', snippet: '[b]${1:text}[/b]' },
  { label: 'Italic [i]…[/i]', keyLabel: 'Alt+M', snippet: '[i]${1:text}[/i]' },
  { label: 'Interpolate ${…}', keyLabel: 'Alt+V', snippet: '\\${${1:variable}}' }
]

export function InsertMenu({ onInsert }: { onInsert: (snippet: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="insert-menu">
      <button className="tb-button" onClick={() => setOpen((o) => !o)}>
        Insert ▾
      </button>
      {open && (
        <div className="insert-dropdown" onMouseLeave={() => setOpen(false)}>
          {ITEMS.map((it, i) => (
            <button
              key={i}
              className="insert-item"
              onClick={() => {
                onInsert(it.snippet)
                setOpen(false)
              }}
            >
              <span className="insert-label">{it.label}</span>
              {it.keyLabel && <span className="insert-key">{it.keyLabel}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
