// The slim Monaco editor API (core only, no bundled languages) ships no type
// declarations at this subpath; reuse the full monaco-editor type surface.
// This file must remain a global script (no top-level import/export) so the
// ambient module declaration applies.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

// nspell ships no type declarations.
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): NSpell
  }
  function nspell(aff: string, dic: string): NSpell
  export default nspell
}

// cytoscape-dagre ships no type declarations.
declare module 'cytoscape-dagre'
// dagre (used directly for node-canvas layout).
declare module 'dagre'
