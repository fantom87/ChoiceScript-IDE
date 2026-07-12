import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import type {
  EngineToIdeMsg,
  IdeToEngineMsg,
  SceneMap
} from './enginePmProtocol'
import { parseEngineError } from './enginePmProtocol'

const ENGINE_URL = 'app://engine/engine.html'

export interface EngineError {
  message: string
  scene?: string
  line?: number
}

export interface EngineHandle {
  /** Boot a game from a generated mygame.js + scene buffers. */
  loadGame: (opts: {
    mygameJs: string
    scenes: SceneMap
    startScene?: string
    debug?: boolean
  }) => void
  /** Merge updated scene buffers into the engine cache. */
  setBuffers: (scenes: SceneMap) => void
  /** Ask the engine for its current save state (computeCookie JSON). */
  getSnapshot: () => Promise<string | null>
  /** Restore/jump to a state (hot reload or isolated preview). */
  runFrom: (opts: {
    state: string | null
    forcedScene?: string
    forcedStats?: Record<string, unknown>
    forcedTemps?: Record<string, unknown>
    debug?: boolean
  }) => void
  /** Apply new buffers and restart the current chapter from its entry. */
  hotReload: (changed: SceneMap) => void
  /** The latest resumable state pushed by the engine (for manual saves). */
  getLastState: () => { json: string; scene?: string; lineNum?: number } | null
}

interface EngineFrameProps {
  onReady?: () => void
  onRendered?: (scene?: string) => void
  onError?: (err: EngineError) => void
  /** Fired at each pause point with a resumable state (for autosave/tracking). */
  onStateSnapshot?: (state: { json: string; scene?: string; lineNum?: number }) => void
  /** Fired when the player hovers a rendered element mapped to a source line. */
  onHover?: (scene: string | undefined, line: number) => void
  /** Fired when the player moves off a hovered element. */
  onHoverClear?: () => void
}

export const EngineFrame = forwardRef<EngineHandle, EngineFrameProps>(
  function EngineFrame({ onReady, onRendered, onError, onStateSnapshot, onHover, onHoverClear }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const readyRef = useRef(false)
    const snapshotWaiters = useRef(new Map<number, (json: string | null) => void>())
    const snapshotId = useRef(0)
    // Latest resumable state pushed by the engine at a pause point.
    const lastPushed = useRef<{ json: string; scene?: string; lineNum?: number } | null>(null)

    const postToEngine = useCallback((msg: IdeToEngineMsg) => {
      const win = iframeRef.current?.contentWindow
      if (win) win.postMessage(msg, '*')
    }, [])

    // Keep the latest callbacks in refs so the message listener is stable.
    const cbs = useRef({ onReady, onRendered, onError, onStateSnapshot, onHover, onHoverClear })
    cbs.current = { onReady, onRendered, onError, onStateSnapshot, onHover, onHoverClear }

    useEffect(() => {
      function handleMessage(ev: MessageEvent) {
        if (ev.source !== iframeRef.current?.contentWindow) return
        const msg = ev.data as EngineToIdeMsg
        if (!msg || typeof msg.type !== 'string') return
        switch (msg.type) {
          case 'ENGINE_READY':
            readyRef.current = true
            cbs.current.onReady?.()
            break
          case 'RENDERED':
            cbs.current.onRendered?.(msg.scene)
            break
          case 'SNAPSHOT': {
            const waiter = snapshotWaiters.current.get(msg.id)
            if (waiter) {
              snapshotWaiters.current.delete(msg.id)
              waiter(msg.json)
            }
            break
          }
          case 'STATE_SNAPSHOT':
            if (msg.json) {
              const state = { json: msg.json, scene: msg.scene, lineNum: msg.lineNum }
              lastPushed.current = state
              cbs.current.onStateSnapshot?.(state)
            }
            break
          case 'ENGINE_ERROR':
            cbs.current.onError?.(parseEngineError(msg.message))
            break
          case 'HOVER':
            cbs.current.onHover?.(msg.scene, msg.line)
            break
          case 'HOVER_CLEAR':
            cbs.current.onHoverClear?.()
            break
        }
      }
      window.addEventListener('message', handleMessage)
      return () => window.removeEventListener('message', handleMessage)
    }, [])

    const getSnapshot = useCallback((): Promise<string | null> => {
      return new Promise((resolve) => {
        const id = ++snapshotId.current
        snapshotWaiters.current.set(id, resolve)
        postToEngine({ type: 'GET_SNAPSHOT', id })
        // Safety timeout so a lost reply never wedges a caller.
        setTimeout(() => {
          if (snapshotWaiters.current.has(id)) {
            snapshotWaiters.current.delete(id)
            resolve(null)
          }
        }, 2000)
      })
    }, [postToEngine])

    useImperativeHandle(
      ref,
      (): EngineHandle => ({
        loadGame: (opts) => postToEngine({ type: 'LOAD_GAME', ...opts }),
        setBuffers: (scenes) => postToEngine({ type: 'SET_BUFFERS', scenes }),
        getSnapshot,
        runFrom: (opts) => postToEngine({ type: 'RUN_FROM', ...opts }),
        hotReload: (changed) => {
          // Update buffers, then restart the current chapter from its entry.
          // This re-parses the edited text cleanly (the engine's own mechanism
          // for a changed scene) instead of replaying into a shifted position.
          postToEngine({ type: 'SET_BUFFERS', scenes: changed })
          postToEngine({ type: 'RELOAD' })
        },
        getLastState: () => lastPushed.current
      }),
      [postToEngine, getSnapshot]
    )

    return (
      <iframe
        ref={iframeRef}
        className="engine-frame"
        src={ENGINE_URL}
        title="ChoiceScript live preview"
      />
    )
  }
)
