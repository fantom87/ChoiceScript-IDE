import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { ensureMonacoSetup, getSceneModel, applyNodeThemeColors, monaco } from './setupMonaco'
import type { Diagnostic } from '../choicescript/lint'
import { SNIPPETS, choiceSnippet } from './snippets'

export interface MonacoEditorHandle {
  /** Reveal and select a line (1-based) in the current editor. */
  revealLine: (line: number, column?: number) => void
  /** Replace the whole document as a single undoable edit (fires onChange). */
  applyFullText: (text: string) => void
  /** Highlight the line the playthrough is currently on (null clears). */
  setPlayLine: (line: number | null) => void
  /** Highlight the line hovered in the preview (null clears). */
  setHoverLine: (line: number | null) => void
  /** Highlight a range of lines (1-based inclusive) — for node-canvas sync.
   *  With focusStart/focusEnd, `start..end` is the whole node (subtle wash)
   *  and the focus range is the specific statement (strong highlight). */
  setHoverRange: (start: number | null, end?: number, focusStart?: number, focusEnd?: number) => void
  /** Insert a Monaco snippet at the cursor. */
  insertSnippet: (snippet: string) => void
  /** Undo the last edit on the active scene (editor or canvas edits alike). */
  undo: () => void
  /** Redo the last undone edit on the active scene. */
  redo: () => void
}

interface MonacoEditorProps {
  scene: string | null
  value: string
  diagnostics: Diagnostic[]
  indentStyle: 'tab' | 'space'
  indentWidth: number
  /** Colour commands to match the node canvas palette. */
  nodeColors?: boolean
  /** Per-line background tints matching the node canvas (1-based ranges). */
  lineTints?: { start: number; end: number; type: string }[]
  /** Custom node-type colours — synced into the editor theme. */
  typeColors?: { command?: string; choice?: string; option?: string; if?: string }
  onChange: (value: string) => void
  /** Go-to-definition request (F12 / Ctrl+click): the line + word at the cursor. */
  onGotoDefinition?: (lineText: string, word: string) => void
  /** Rename request (F2): the word at the cursor + its line. */
  onRename?: (word: string, lineText: string) => void
  /** The 1-based line under the mouse (null on leave) — for node-canvas sync. */
  onHoverLine?: (line: number | null) => void
  /** Prose misspellings (1-based positions) — rendered as info squiggles. */
  spelling?: { word: string; line: number; startCol: number; endCol: number }[]
}

const MARKER_OWNER = 'choicescript-lint'
export const SPELL_OWNER = 'cside-spell'

function severityOf(s: Diagnostic['severity']): monaco.MarkerSeverity {
  if (s === 'error') return monaco.MarkerSeverity.Error
  if (s === 'warning') return monaco.MarkerSeverity.Warning
  return monaco.MarkerSeverity.Info
}

function toMarkers(
  diags: Diagnostic[],
  model: monaco.editor.ITextModel
): monaco.editor.IMarkerData[] {
  const lineCount = model.getLineCount()
  return diags.map((d) => {
    const line = Math.min(Math.max(d.line + 1, 1), lineCount)
    const maxCol = model.getLineMaxColumn(line)
    // A collapsed range (deep-pass findings only know the line) highlights the
    // whole line.
    const endColumn = d.endCol > d.startCol ? d.endCol : maxCol
    return {
      severity: severityOf(d.severity),
      startLineNumber: line,
      startColumn: Math.min(d.startCol, maxCol),
      endLineNumber: line,
      endColumn,
      message: d.message,
      code: d.code
    }
  })
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  function MonacoEditor(
    {
      scene,
      value,
      diagnostics,
      indentStyle,
      indentWidth,
      nodeColors,
      lineTints,
      typeColors,
      onChange,
      onGotoDefinition,
      onRename,
      onHoverLine,
      spelling
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const playDeco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
    const hoverDeco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
    const tintDeco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
    const suppress = useRef(false)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const navCbs = useRef({ onGotoDefinition, onRename, onHoverLine })
    navCbs.current = { onGotoDefinition, onRename, onHoverLine }

    const insertSnippetInto = (editor: monaco.editor.ICodeEditor, text: string): void => {
      editor.focus()
      const controller = editor.getContribution('snippetController2') as unknown as {
        insert: (t: string) => void
      } | null
      controller?.insert(text)
    }

    useImperativeHandle(ref, () => ({
      revealLine: (line: number, column = 1) => {
        const editor = editorRef.current
        if (!editor) return
        editor.revealLineInCenter(line)
        editor.setPosition({ lineNumber: line, column })
        editor.focus()
      },
      applyFullText: (text: string) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return
        editor.executeEdits('normalize', [{ range: model.getFullModelRange(), text }])
        editor.pushUndoStop()
      },
      setPlayLine: (line: number | null) => {
        const deco = playDeco.current
        if (!deco) return
        deco.set(
          line == null
            ? []
            : [
                {
                  range: new monaco.Range(line, 1, line, 1),
                  options: { isWholeLine: true, className: 'play-line-deco' }
                }
              ]
        )
      },
      setHoverLine: (line: number | null) => {
        const deco = hoverDeco.current
        if (!deco) return
        deco.set(
          line == null
            ? []
            : [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'hover-line-deco' } }]
        )
      },
      setHoverRange: (start: number | null, end?: number, focusStart?: number, focusEnd?: number) => {
        const deco = hoverDeco.current
        if (!deco) return
        if (start == null) {
          deco.set([])
          return
        }
        const decos: monaco.editor.IModelDeltaDecoration[] = [
          {
            range: new monaco.Range(start, 1, end ?? start, 1),
            options: {
              isWholeLine: true,
              className: focusStart != null ? 'hover-node-deco' : 'hover-line-deco'
            }
          }
        ]
        if (focusStart != null) {
          decos.push({
            range: new monaco.Range(focusStart, 1, focusEnd ?? focusStart, 1),
            options: { isWholeLine: true, className: 'hover-line-deco' }
          })
        }
        deco.set(decos)
      },
      insertSnippet: (snippet: string) => {
        const editor = editorRef.current
        if (editor) insertSnippetInto(editor, snippet)
      },
      undo: () => editorRef.current?.trigger('app', 'undo', null),
      redo: () => editorRef.current?.trigger('app', 'redo', null)
    }))

    useEffect(() => {
      ensureMonacoSetup()
      const editor = monaco.editor.create(containerRef.current!, {
        theme: 'cs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        stickyScroll: { enabled: true, defaultModel: 'indentationModel' },
        folding: true,
        showFoldingControls: 'always',
        foldingStrategy: 'indentation',
        guides: { indentation: true, highlightActiveIndentation: true },
        renderWhitespace: 'boundary',
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        fontSize: 13,
        tabSize: indentWidth,
        insertSpaces: indentStyle === 'space',
        detectIndentation: false,
        autoIndent: 'full',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        // Aggressive, tab-completable suggestions.
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        tabCompletion: 'on',
        acceptSuggestionOnEnter: 'smart',
        snippetSuggestions: 'inline'
      })
      editorRef.current = editor
      playDeco.current = editor.createDecorationsCollection([])
      hoverDeco.current = editor.createDecorationsCollection([])
      tintDeco.current = editor.createDecorationsCollection([])

      registerEditorActions(editor, insertSnippetInto, navCbs)

      const sub = editor.onDidChangeModelContent(() => {
        if (suppress.current) return
        onChangeRef.current(editor.getValue())
      })

      // Hover-line events for node-canvas sync.
      let lastHoverLine = -1
      const moveSub = editor.onMouseMove((e) => {
        const ln = e.target.position?.lineNumber ?? null
        if (ln !== (lastHoverLine === -1 ? null : lastHoverLine)) {
          lastHoverLine = ln ?? -1
          navCbs.current.onHoverLine?.(ln)
        }
      })
      const leaveSub = editor.onMouseLeave(() => {
        lastHoverLine = -1
        navCbs.current.onHoverLine?.(null)
      })

      return () => {
        sub.dispose()
        moveSub.dispose()
        leaveSub.dispose()
        editor.dispose()
        editorRef.current = null
      }
    }, [])

    // Swap model / sync value when the active scene or its text changes.
    useEffect(() => {
      const editor = editorRef.current
      if (!editor || !scene) return
      const model = getSceneModel(scene, value)
      suppress.current = true
      if (editor.getModel() !== model) editor.setModel(model)
      if (model.getValue() !== value) model.setValue(value)
      suppress.current = false
    }, [scene, value])

    // Apply indent config changes to the editor + model.
    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.updateOptions({ tabSize: indentWidth, insertSpaces: indentStyle === 'space' })
      editor.getModel()?.updateOptions({ tabSize: indentWidth, insertSpaces: indentStyle === 'space' })
    }, [indentStyle, indentWidth])

    // Swap between the classic theme and the node-palette theme; rebuild the
    // palette theme whenever the custom colours change so the code editor
    // always matches the node canvas.
    useEffect(() => {
      applyNodeThemeColors(typeColors ?? {})
      monaco.editor.setTheme(nodeColors === false ? 'cs-dark' : 'cs-dark-nodes')
    }, [nodeColors, typeColors])

    // Per-line TEXT colouring keyed to node types (node-canvas colour sync).
    // inlineClassName colours the glyphs themselves; the wide end column is
    // clamped by Monaco to the actual line length.
    useEffect(() => {
      tintDeco.current?.set(
        (lineTints ?? []).map((t) => ({
          range: new monaco.Range(t.start, 1, t.end, 100000),
          options: { inlineClassName: `tint-${t.type}` }
        }))
      )
    }, [lineTints, scene, value])

    // Apply diagnostics as markers on the current model.
    useEffect(() => {
      const model = editorRef.current?.getModel()
      if (!model) return
      monaco.editor.setModelMarkers(model, MARKER_OWNER, toMarkers(diagnostics, model))
    }, [diagnostics, scene, value])

    // Prose spelling as a separate marker family (blue info squiggles).
    useEffect(() => {
      const model = editorRef.current?.getModel()
      if (!model) return
      const lineCount = model.getLineCount()
      monaco.editor.setModelMarkers(
        model,
        SPELL_OWNER,
        (spelling ?? [])
          .filter((s) => s.line >= 1 && s.line <= lineCount)
          .map((s) => ({
            severity: monaco.MarkerSeverity.Info,
            startLineNumber: s.line,
            startColumn: s.startCol,
            endLineNumber: s.line,
            endColumn: s.endCol,
            message: `Unknown word: "${s.word}"`,
            code: 'spelling'
          }))
      )
    }, [spelling, scene, value])

    return <div ref={containerRef} className="monaco-host" />
  }
)

type NavCbs = {
  current: {
    onGotoDefinition?: (lineText: string, word: string) => void
    onRename?: (word: string, lineText: string) => void
    onHoverLine?: (line: number | null) => void
  }
}

function wrapSelection(editor: monaco.editor.ICodeEditor, prefix: string, suffix: string): void {
  const sel = editor.getSelection()
  const model = editor.getModel()
  if (!sel || !model) return
  const text = model.getValueInRange(sel)
  editor.executeEdits('cs-wrap', [{ range: sel, text: prefix + text + suffix }])
  editor.focus()
}

function commentLines(editor: monaco.editor.ICodeEditor): void {
  const sel = editor.getSelection()
  const model = editor.getModel()
  if (!sel || !model) return
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = []
  for (let ln = sel.startLineNumber; ln <= sel.endLineNumber; ln++) {
    edits.push({ range: new monaco.Range(ln, 1, ln, 1), text: '*comment ' })
  }
  editor.executeEdits('cs-comment', edits)
  editor.focus()
}

function tokenAtCursor(
  editor: monaco.editor.ICodeEditor
): { word: string; lineText: string } | null {
  const pos = editor.getPosition()
  const model = editor.getModel()
  if (!pos || !model) return null
  const word = model.getWordAtPosition(pos)?.word
  if (!word) return null
  return { word, lineText: model.getLineContent(pos.lineNumber) }
}

function registerEditorActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  insert: (ed: monaco.editor.ICodeEditor, text: string) => void,
  navCbs: NavCbs
): void {
  const { KeyMod, KeyCode } = monaco
  const fixedKeys: Record<string, number> = {
    if: KeyMod.Alt | KeyCode.KeyI,
    page_break: KeyMod.Alt | KeyCode.KeyP,
    set: KeyMod.Alt | KeyCode.KeyS,
    goto: KeyMod.Alt | KeyCode.KeyG,
    label: KeyMod.Alt | KeyCode.KeyL,
    temp: KeyMod.Alt | KeyCode.KeyD
  }
  for (const s of SNIPPETS) {
    editor.addAction({
      id: `cs.insert.${s.id}`,
      label: `ChoiceScript: Insert ${s.label}`,
      keybindings: fixedKeys[s.id] ? [fixedKeys[s.id]] : [],
      run: (ed) => insert(ed, s.snippet)
    })
  }
  // Alt+T / Alt+F, then a digit 2–9 → *choice / *fake_choice with N options.
  // Implemented as trigger + next-keypress (more reliable than Monaco chords,
  // which can be swallowed by the OS/menu on Alt combos).
  let pendingChoice: '' | 'choice' | 'fake' = ''
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  const startChoice = (kind: 'choice' | 'fake'): void => {
    pendingChoice = kind
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingChoice = ''
    }, 2500)
  }
  editor.addAction({
    id: 'cs.choice',
    label: 'ChoiceScript: Insert *choice (Alt+T, then 2–9)',
    keybindings: [KeyMod.Alt | KeyCode.KeyT],
    run: () => startChoice('choice')
  })
  editor.addAction({
    id: 'cs.fakechoice',
    label: 'ChoiceScript: Insert *fake_choice (Alt+F, then 2–9)',
    keybindings: [KeyMod.Alt | KeyCode.KeyF],
    run: () => startChoice('fake')
  })
  editor.onKeyDown((e) => {
    if (!pendingChoice) return
    const key = e.browserEvent.key
    if (/^[2-9]$/.test(key)) {
      e.preventDefault()
      e.stopPropagation()
      insert(editor, choiceSnippet(Number(key), pendingChoice === 'fake'))
    }
    pendingChoice = ''
    if (pendingTimer) clearTimeout(pendingTimer)
  })
  // Wrap / comment.
  editor.addAction({ id: 'cs.bold', label: 'ChoiceScript: Bold selection', keybindings: [KeyMod.Alt | KeyCode.KeyB], run: (ed) => wrapSelection(ed, '[b]', '[/b]') })
  editor.addAction({ id: 'cs.italic', label: 'ChoiceScript: Italic selection', keybindings: [KeyMod.Alt | KeyCode.KeyM], run: (ed) => wrapSelection(ed, '[i]', '[/i]') })
  editor.addAction({ id: 'cs.var', label: 'ChoiceScript: Wrap in ${…}', keybindings: [KeyMod.Alt | KeyCode.KeyV], run: (ed) => wrapSelection(ed, '${', '}') })
  editor.addAction({ id: 'cs.comment', label: 'ChoiceScript: Comment lines', keybindings: [KeyMod.Alt | KeyCode.KeyC], run: (ed) => commentLines(ed) })
  // Navigation.
  editor.addAction({
    id: 'cs.gotoDef',
    label: 'ChoiceScript: Go to Definition',
    keybindings: [KeyCode.F12],
    contextMenuGroupId: 'navigation',
    run: (ed) => {
      const t = tokenAtCursor(ed)
      if (t) navCbs.current.onGotoDefinition?.(t.lineText, t.word)
    }
  })
  editor.addAction({
    id: 'cs.rename',
    label: 'ChoiceScript: Rename Symbol',
    keybindings: [KeyCode.F2],
    contextMenuGroupId: 'navigation',
    run: (ed) => {
      const t = tokenAtCursor(ed)
      if (t) navCbs.current.onRename?.(t.word, t.lineText)
    }
  })
  // Ctrl/Cmd+click → go to definition.
  editor.onMouseDown((e) => {
    if ((e.event.ctrlKey || e.event.metaKey) && e.target.position) {
      const model = editor.getModel()
      if (!model) return
      const word = model.getWordAtPosition(e.target.position)?.word
      if (word) {
        navCbs.current.onGotoDefinition?.(model.getLineContent(e.target.position.lineNumber), word)
      }
    }
  })
}
