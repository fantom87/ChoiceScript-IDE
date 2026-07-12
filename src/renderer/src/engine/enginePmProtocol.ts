/**
 * Message protocol between the IDE renderer and the ChoiceScript engine
 * running inside the sandboxed `app://engine/engine.html` iframe.
 *
 * The engine (plain ES5 in engine.html) mirrors these string literals, so keep
 * the `type` values in sync with resources/engine/engine.html.
 */

/** A map of scene name (no `.txt`) to its full source text. */
export type SceneMap = Record<string, string>

// ---------------------------------------------------------------------------
// IDE -> engine
// ---------------------------------------------------------------------------

/** Boot a game: install the scene buffers + generated mygame.js, run startup. */
export interface LoadGameMsg {
  type: 'LOAD_GAME'
  /** Body of a generated mygame.js (assigns globals `nav` and `stats`). */
  mygameJs: string
  scenes: SceneMap
  /** Optional scene to start at instead of the startup scene. */
  startScene?: string
  debug?: boolean
}

/** Merge updated scene buffers into the engine's in-memory cache. */
export interface SetBuffersMsg {
  type: 'SET_BUFFERS'
  scenes: SceneMap
}

/** Ask the engine to compute and return the current save state. */
export interface GetSnapshotMsg {
  type: 'GET_SNAPSHOT'
  /** Correlation id echoed back on the SNAPSHOT reply. */
  id: number
}

/** Restore/jump to a state. Used for hot reload and isolated preview. */
export interface RunFromMsg {
  type: 'RUN_FROM'
  /** A computeCookie() JSON string, or null to start fresh. */
  state: string | null
  /** Jump to this scene (optionally `scene|label`); starts it at line 0. */
  forcedScene?: string
  /** Stat overrides merged into the restored state. */
  forcedStats?: Record<string, unknown>
  /** Temp overrides merged into the restored state. */
  forcedTemps?: Record<string, unknown>
  debug?: boolean
}

/** Select a mediated choice option (Phase 3+). */
export interface ChooseMsg {
  type: 'CHOOSE'
  index: number
}

/**
 * Hot reload: restart the current chapter from its scene-entry "backup" state
 * against the current (edited) buffers. Robust re-parse; no position drift errors.
 */
export interface ReloadMsg {
  type: 'RELOAD'
}

export type IdeToEngineMsg =
  | LoadGameMsg
  | SetBuffersMsg
  | GetSnapshotMsg
  | RunFromMsg
  | ChooseMsg
  | ReloadMsg

// ---------------------------------------------------------------------------
// engine -> IDE
// ---------------------------------------------------------------------------

/** The engine finished loading its scripts and is ready for LOAD_GAME. */
export interface EngineReadyMsg {
  type: 'ENGINE_READY'
}

/** A screen was rendered (text/choice/input) — the iframe DOM is current. */
export interface RenderedMsg {
  type: 'RENDERED'
  /** Current scene name, if known. */
  scene?: string
}

/** Reply to GET_SNAPSHOT: the current save state as a computeCookie JSON string. */
export interface SnapshotMsg {
  type: 'SNAPSHOT'
  id: number
  json: string | null
  scene?: string
  lineNum?: number
}

/**
 * Pushed by the engine at each pause point (choice / page break) with a
 * *resumable* state — the correct re-entry point for hot reload.
 */
export interface StateSnapshotMsg {
  type: 'STATE_SNAPSHOT'
  json: string | null
  scene?: string
  lineNum?: number
}

/** An engine error (thrown Error), with the location parsed out when possible. */
export interface EngineErrorMsg {
  type: 'ENGINE_ERROR'
  message: string
  scene?: string
  /** 1-based line number as reported by the engine. */
  line?: number
}

/** The player is hovering a rendered element mapped to a source line. */
export interface HoverMsg {
  type: 'HOVER'
  scene?: string
  line: number
}

/** The player moved off a hovered element. */
export interface HoverClearMsg {
  type: 'HOVER_CLEAR'
}

export type EngineToIdeMsg =
  | EngineReadyMsg
  | RenderedMsg
  | SnapshotMsg
  | StateSnapshotMsg
  | EngineErrorMsg
  | HoverMsg
  | HoverClearMsg

/** Parse an engine error message of the form `"<scene> line <N>: <msg>"`. */
export function parseEngineError(message: string): {
  scene?: string
  line?: number
  message: string
} {
  const m = /^(\w+) line (\d+): ([\s\S]*)$/.exec(message)
  if (m) {
    return { scene: m[1], line: parseInt(m[2], 10), message: m[3] }
  }
  return { message }
}
