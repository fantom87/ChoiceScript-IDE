// The slim Monaco editor API (core only, no bundled languages) ships no type
// declarations at this subpath; reuse the full monaco-editor type surface.
// This file must remain a global script (no top-level import/export) so the
// ambient module declaration applies.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

// cytoscape-dagre ships no type declarations.
declare module 'cytoscape-dagre'
// dagre (used directly for node-canvas layout).
declare module 'dagre'
