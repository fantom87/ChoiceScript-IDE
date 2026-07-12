/**
 * Interactive guided tour: a spotlight overlay anchored to real UI elements,
 * with steps that auto-advance when the user actually performs the action
 * (switch view, open the whole-game map, …). Pure DOM measurement — no
 * portal targets required; a missing anchor just centres the card.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Live app state the tour watches to auto-advance "do it" steps. */
export interface TutorialSignals {
  activeScene: string | null
  viewMode: 'live' | 'typed' | 'choices'
  gameMode: boolean
  settingsOpen: boolean
}

export interface TutorialStep {
  id: string
  /** CSS selector of the element to spotlight (omit = centred card). */
  target?: string
  title: string
  body: string
  /** Auto-advance when this becomes true. `at` = signals when step opened. */
  advance?: (now: TutorialSignals, at: TutorialSignals) => boolean
  /** Short "do this" hint rendered when the step can auto-advance. */
  action?: string
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ChoiceScript IDE',
    body: 'A two-minute tour of the whole workshop: the editor, the live game, the node canvas, and the map of your entire story. You can leave at any time with ✕, and re-run this from the 🎓 button up top.'
  },
  {
    id: 'scenes',
    target: '.pane-sidebar',
    title: 'Your scenes',
    body: 'Every ChoiceScript game is a set of scene files, listed here in *scene_list order. The dot marks unsaved changes. Save points live below — snapshot a playthrough and jump back to it any time, even after edits.',
    action: 'Click a different scene to continue (or press Next).',
    advance: (now, at) => now.activeScene !== at.activeScene
  },
  {
    id: 'editor',
    target: '.pane-editor',
    title: 'The editor',
    body: 'Full ChoiceScript language support: colours that match the node canvas, autocomplete for commands, variables and labels, error squiggles with quick fixes (F8 to jump), F12 for go-to-definition, F2 to rename a variable everywhere. The Insert menu above holds snippets and Alt-key shortcuts.'
  },
  {
    id: 'live',
    target: '.pane-preview',
    title: 'The live game',
    body: 'This is the real ChoiceScript engine running your actual game — not a preview. Play it with the mouse; when you edit the code, it hot-reloads and keeps your place in the story. ⧉ Isolate (editor header) runs just the current scene with stats you choose.'
  },
  {
    id: 'nodes-switch',
    target: '.view-toggle',
    title: 'The node canvas',
    body: 'The same scene, as a visual graph: every statement is a node, choices fan out to their options, and paths show where the story flows.',
    action: 'Click "Nodes" to switch views.',
    advance: (now) => now.viewMode === 'typed'
  },
  {
    id: 'nodes-edit',
    target: '.pane-preview',
    title: 'Build without code',
    body: 'Everything here is editable: type in any node, use the +/− stepper on a choice to add options, right-click empty canvas to add new pieces, and drag from the bottom of one node to the top of another to write the *goto for you. Select a node to trace every path in and out of it. ▶ plays the story from that point.'
  },
  {
    id: 'wholegame',
    target: '[data-tut="wholegame"]',
    title: 'The whole game at once',
    body: 'This is the big one — every scene laid out as connected plates, every *goto_scene drawn as a routed path.',
    action: 'Tick "Whole game" to see the map.',
    advance: (now) => now.gameMode
  },
  {
    id: 'wholegame-tour',
    target: '.pane-preview',
    title: 'Reading the map',
    body: 'Zoom out for the overview; zoom in and everything becomes editable, right down to dragging connections between scenes. Drag a scene by its title bar to rearrange. The ⬇ PNG / ⬇ JPG buttons export the whole map as one image — the "look how big my game is" shot.'
  },
  {
    id: 'settings',
    target: '[data-tut="settings"]',
    title: 'Game settings as a form',
    body: 'Title, author, scene order, stats and achievements — edited as a form instead of raw startup.txt. It rewrites only what you change; the rest of the file stays byte-for-byte intact.'
  },
  {
    id: 'tests',
    target: '[data-tut="tests"]',
    title: 'Testing your story',
    body: 'QuickTest walks every branch of every scene and catches errors plain reading misses (dead ends, bad references, illegal fall-throughs). RandomTest plays thousands of random runs. Problems appear in the panel at the bottom — click one to jump to the line.'
  },
  {
    id: 'done',
    title: "That's the tour",
    body: 'Export… builds a single playable HTML file of your game when you\'re ready to share. Everything else you can discover by right-clicking. Happy writing — and remember: 🎓 replays this tour any time.'
  }
]

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function Tutorial({
  signals,
  onClose
}: {
  signals: TutorialSignals
  onClose: () => void
}): React.JSX.Element {
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const step = TUTORIAL_STEPS[idx]
  const entryRef = useRef<TutorialSignals>(signals)
  const signalsRef = useRef(signals)
  signalsRef.current = signals

  const go = useCallback(
    (next: number) => {
      if (next >= TUTORIAL_STEPS.length) {
        onClose()
        return
      }
      entryRef.current = signalsRef.current
      setIdx(Math.max(0, next))
    },
    [onClose]
  )

  // Auto-advance "do it" steps when the watched state changes.
  useEffect(() => {
    if (!step?.advance) return
    if (step.advance(signals, entryRef.current)) {
      const t = setTimeout(() => go(idx + 1), 450)
      return () => clearTimeout(t)
    }
    return undefined
  }, [signals, step, idx, go])

  // Measure the target element (re-measured on an interval — panes move).
  useEffect(() => {
    const measure = (): void => {
      if (!step?.target) {
        setRect(null)
        return
      }
      const el = document.querySelector(step.target)
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    measure()
    const iv = setInterval(measure, 350)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(iv)
      window.removeEventListener('resize', measure)
    }
  }, [step])

  if (!step) return <></>

  // Card placement: under the spotlight when there is room, else above,
  // clamped to the viewport; centred when there is no target.
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const CARD_W = 380
  let cardStyle: React.CSSProperties
  if (rect) {
    const below = rect.y + rect.h + 240 < vh
    const left = Math.max(12, Math.min(rect.x + rect.w / 2 - CARD_W / 2, vw - CARD_W - 12))
    cardStyle = below
      ? { left, top: rect.y + rect.h + 14 }
      : { left, bottom: vh - rect.y + 14 }
  } else {
    cardStyle = { left: vw / 2 - CARD_W / 2, top: vh * 0.3 }
  }

  return (
    <div className="tut-layer">
      {rect ? (
        <div
          className="tut-spot"
          style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }}
        />
      ) : (
        <div className="tut-dim" />
      )}
      <div className="tut-card" style={{ ...cardStyle, width: CARD_W }}>
        <div className="tut-head">
          <span className="tut-title">{step.title}</span>
          <button className="tut-x" title="End tour" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tut-body">{step.body}</div>
        {step.action && <div className="tut-action">→ {step.action}</div>}
        <div className="tut-foot">
          <span className="tut-count">
            {idx + 1} / {TUTORIAL_STEPS.length}
          </span>
          <span className="tut-btns">
            {idx > 0 && (
              <button className="header-btn" onClick={() => go(idx - 1)}>
                Back
              </button>
            )}
            <button className="header-btn tut-next" onClick={() => go(idx + 1)}>
              {idx === TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
