// Full editor entry (not the slim editor.api) so the editor contributions —
// snippets, suggest widget, folding controls, in-file find — are registered.
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { CS_COMMANDS } from '../choicescript/commands'
import { nearest } from '../choicescript/nearest'
import { COMMAND_SNIPPETS } from './snippets'

export const CS_LANGUAGE_ID = 'choicescript'
export { CS_COMMANDS }

/** Live index of author-defined symbols, updated as the project changes. */
export interface ChoiceScriptIndex {
  variables: string[]
  scenes: string[]
  /** label names by scene name. */
  labelsByScene: Record<string, string[]>
}

let csIndex: ChoiceScriptIndex = { variables: [], scenes: [], labelsByScene: {} }
export function setChoiceScriptIndex(index: ChoiceScriptIndex): void {
  csIndex = index
}

let initialized = false

export function ensureMonacoSetup(): void {
  if (initialized) return
  initialized = true

  // Monaco web workers (custom language only needs the base editor worker).
  ;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
    {
      getWorker: () => new EditorWorker()
    }

  monaco.languages.register({ id: CS_LANGUAGE_ID })

  monaco.languages.setLanguageConfiguration(CS_LANGUAGE_ID, {
    comments: { lineComment: '*comment' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ],
    // Indentation-significant language: fold blocks by indentation (default),
    // which naturally folds *choice / #option bodies.
    onEnterRules: [],
    // Auto-indent the next line after block openers (*if/*choice/#option…).
    indentationRules: {
      increaseIndentPattern:
        /^\s*(\*(if|elseif|elsif|else|choice|fake_choice)\b.*|#.*)$/,
      // ChoiceScript dedents implicitly; never auto-decrease.
      decreaseIndentPattern: /[^\s\S]/
    }
  })

  monaco.languages.setMonarchTokensProvider(CS_LANGUAGE_ID, {
    defaultToken: '',
    commands: CS_COMMANDS.map((c) => `*${c}`),
    tokenizer: {
      root: [
        [/^(\s*)(\*comment)(.*)$/, ['white', 'comment', 'comment']],
        [
          /^(\s*)(\*[a-zA-Z_]+)/,
          [
            'white',
            {
              cases: {
                '\\*choice|\\*fake_choice': 'keyword.choice',
                '\\*if|\\*elseif|\\*elsif|\\*else': 'keyword.flow',
                '\\*selectable_if|\\*hide_reuse|\\*disable_reuse|\\*allow_reuse': 'keyword.option',
                '@commands': 'keyword',
                '@default': 'keyword.invalid'
              }
            }
          ]
        ],
        [/^(\s*)(#)/, ['white', { token: 'type.choice', next: '@choiceLine' }]],
        // The '#label' part of a modifier option (*selectable_if (x) #Buy).
        [/#[^{[\]]*$/, 'type.choice'],
        { include: '@inline' }
      ],
      choiceLine: [
        { include: '@inline' },
        [/[^$@[\]]+/, 'type.choice'],
        [/$/, { token: '', next: '@pop' }]
      ],
      inline: [
        [/[$@]!?\{/, { token: 'delimiter.curly', next: '@interp' }],
        [/\[\/?[a-zA-Z]+\/?\]/, 'tag']
      ],
      interp: [
        [/\}/, { token: 'delimiter.curly', next: '@pop' }],
        [/"[^"]*"/, 'string'],
        [/\d+/, 'number'],
        [/[a-zA-Z_]\w*/, 'variable'],
        [/[+\-*/%^<>=!&#|@]+/, 'operator'],
        [/[^}]/, '']
      ]
    }
  })

  monaco.editor.defineTheme('cs-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.invalid', foreground: 'f48771', fontStyle: 'italic' },
      { token: 'type.choice', foreground: 'dcdcaa' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'tag', foreground: 'c586c0' },
      { token: 'delimiter.curly', foreground: 'd7ba7d' }
    ],
    colors: {}
  })

  // Same language, but commands coloured to match the node canvas palette.
  applyNodeThemeColors({})

  registerCompletion()
  registerCodeActions()
  registerSpellCommand()
}

/** (Re)define the node-palette theme with custom type colours — called at
 *  setup and whenever the user changes colours in the canvas 🎨 popover. */
export function applyNodeThemeColors(colors: {
  command?: string
  choice?: string
  option?: string
  if?: string
}): void {
  const hex = (c: string | undefined, fallback: string): string => (c ?? fallback).replace('#', '')
  monaco.editor.defineTheme('cs-dark-nodes', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: hex(colors.command, '#c586c0') },
      { token: 'keyword.choice', foreground: hex(colors.choice, '#dcdcaa'), fontStyle: 'bold' },
      { token: 'keyword.flow', foreground: hex(colors.if, '#569cd6') },
      { token: 'keyword.option', foreground: hex(colors.option, '#4ec9b0') },
      { token: 'keyword.invalid', foreground: 'f48771', fontStyle: 'italic' },
      { token: 'type.choice', foreground: hex(colors.option, '#4ec9b0') },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'tag', foreground: hex(colors.command, '#c586c0') },
      { token: 'delimiter.curly', foreground: 'd7ba7d' }
    ],
    colors: {}
  })
}

function markerCode(marker: monaco.editor.IMarkerData): string {
  const c = marker.code
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && 'value' in c) return String(c.value)
  return ''
}

function registerCodeActions(): void {
  monaco.languages.registerCodeActionProvider(CS_LANGUAGE_ID, {
    provideCodeActions: (model, _range, context) => {
      const scene = sceneOf(model)
      const actions: monaco.languages.CodeAction[] = []

      const replaceAction = (
        marker: monaco.editor.IMarkerData,
        title: string,
        range: monaco.IRange,
        text: string
      ): void => {
        actions.push({
          title,
          kind: 'quickfix',
          diagnostics: [marker],
          isPreferred: true,
          edit: {
            edits: [
              { resource: model.uri, versionId: model.getVersionId(), textEdit: { range, text } }
            ]
          }
        })
      }

      for (const marker of context.markers) {
        const code = markerCode(marker)
        const mRange: monaco.IRange = {
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn
        }
        const token = model.getValueInRange(mRange)

        if (code === 'unknown-command') {
          const n = nearest(CS_COMMANDS, token.replace(/^\*/, ''))
          if (n) replaceAction(marker, `Change to *${n}`, mRange, `*${n}`)
        } else if (code === 'missing-label') {
          const n = nearest(csIndex.labelsByScene[scene] ?? [], token)
          if (n) replaceAction(marker, `Change to ${n}`, mRange, n)
        } else if (code === 'missing-scene') {
          const n = nearest(csIndex.scenes, token)
          if (n) replaceAction(marker, `Change to ${n}`, mRange, n)
        } else if (code === 'undeclared-var') {
          const n = nearest(csIndex.variables, token)
          if (n) replaceAction(marker, `Change to ${n}`, mRange, n)
          if (scene !== 'startup') {
            actions.push({
              title: `Declare *temp ${token}`,
              kind: 'quickfix',
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                      text: `*temp ${token} ""\n`
                    }
                  }
                ]
              }
            })
          }
        } else if (code === 'mixed-indent') {
          replaceAction(marker, 'Convert indentation to spaces', mRange, token.replace(/\t/g, '  '))
        } else if (code === 'spelling') {
          // Suggestions + project dictionary, provided by the App via hooks.
          for (const s of spellHooks.suggest(token).slice(0, 4)) {
            replaceAction(marker, `Change to "${s}"`, mRange, s)
          }
          actions.push({
            title: `Add "${token}" to the project dictionary`,
            kind: 'quickfix',
            diagnostics: [marker],
            command: { id: ADD_TO_DICTIONARY, title: 'Add to dictionary', arguments: [token] }
          })
        }
      }

      return { actions, dispose: () => {} }
    }
  })
}

/** Spell hooks: wired by the App once the dictionary + config exist. */
export const spellHooks: {
  suggest: (word: string) => string[]
  addWord: (word: string) => void
} = {
  suggest: () => [],
  addWord: () => {}
}
const ADD_TO_DICTIONARY = 'cside.addToDictionary'
function registerSpellCommand(): void {
  monaco.editor.registerCommand(ADD_TO_DICTIONARY, (_accessor, word: string) => {
    spellHooks.addWord(word)
  })
}

function sceneOf(model: monaco.editor.ITextModel): string {
  const m = /scene\/([^./]+)/.exec(model.uri.path)
  return m ? m[1] : ''
}

function registerCompletion(): void {
  monaco.languages.registerCompletionItemProvider(CS_LANGUAGE_ID, {
    triggerCharacters: ['*', ' ', '{', '$', '@'],
    provideCompletionItems: (model, position) => {
      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      )
      const suggestions: monaco.languages.CompletionItem[] = []

      // *command completions
      const cmdMatch = /^\s*\*([a-zA-Z_]*)$/.exec(line)
      if (cmdMatch) {
        for (const c of CS_COMMANDS) {
          const snip = COMMAND_SNIPPETS[c]
          suggestions.push({
            label: c,
            kind: snip
              ? monaco.languages.CompletionItemKind.Snippet
              : monaco.languages.CompletionItemKind.Keyword,
            insertText: snip ?? c,
            insertTextRules: snip
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range
          })
        }
        return { suggestions }
      }

      // scene name completions after *goto_scene / *gosub_scene / *redirect_scene
      if (/\*(goto_scene|gosub_scene|redirect_scene)\s+\S*$/.test(line)) {
        for (const s of csIndex.scenes) {
          suggestions.push({
            label: s,
            kind: monaco.languages.CompletionItemKind.File,
            insertText: s,
            range
          })
        }
        return { suggestions }
      }

      // label completions after *goto / *gosub (within current scene)
      if (/\*(goto|gosub)\s+\S*$/.test(line)) {
        const labels = csIndex.labelsByScene[sceneOf(model)] ?? []
        for (const l of labels) {
          suggestions.push({
            label: l,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: l,
            range
          })
        }
        return { suggestions }
      }

      // variables everywhere else
      for (const v of csIndex.variables) {
        suggestions.push({
          label: v,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: v,
          range
        })
      }
      return { suggestions }
    }
  })
}

/** Get (or lazily create) a per-scene Monaco model, tagged in its URI. */
export function getSceneModel(scene: string, value: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(`inmemory://scene/${scene}`)
  let model = monaco.editor.getModel(uri)
  if (!model) {
    model = monaco.editor.createModel(value, CS_LANGUAGE_ID, uri)
  }
  return model
}

export { monaco }
