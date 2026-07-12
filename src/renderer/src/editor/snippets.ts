/**
 * ChoiceScript snippet definitions, shared by the editor keybindings and the
 * "Insert" command menu. Snippet syntax is Monaco's (${1:placeholder}, tabs
 * normalise to the editor's indent settings).
 */

export interface SnippetDef {
  id: string
  label: string
  /** Human-readable shortcut shown in menus. */
  keyLabel: string
  snippet: string
}

/** A *choice / *fake_choice with `n` options. */
export function choiceSnippet(n: number, fake = false): string {
  const lines: string[] = [fake ? '*fake_choice' : '*choice']
  let tab = 1
  for (let i = 1; i <= n; i++) {
    lines.push(`\t#\${${tab++}:Option ${i}}`)
    lines.push(`\t\t\${${tab++}:Result of option ${i}.}`)
    if (!fake) lines.push(`\t\t*goto \${${tab++}:label}`)
  }
  return lines.join('\n')
}

/** Fixed (parameterless) snippet inserts. */
export const SNIPPETS: SnippetDef[] = [
  { id: 'if', label: 'If / else block', keyLabel: 'Alt+I', snippet: '*if (${1:condition})\n\t${2:text}\n*else\n\t${3:text}' },
  { id: 'page_break', label: 'Page break', keyLabel: 'Alt+P', snippet: '*page_break ${1:Next}' },
  { id: 'set', label: 'Set a variable', keyLabel: 'Alt+S', snippet: '*set ${1:variable} ${2:value}' },
  { id: 'goto', label: 'Goto (label)', keyLabel: 'Alt+G', snippet: '*goto ${1:label}' },
  { id: 'goto_scene', label: 'Goto scene', keyLabel: '', snippet: '*goto_scene ${1:scene}' },
  { id: 'label', label: 'Label', keyLabel: 'Alt+L', snippet: '*label ${1:name}' },
  { id: 'temp', label: 'Temp variable', keyLabel: 'Alt+D', snippet: '*temp ${1:variable} ${2:value}' },
  { id: 'stat_chart', label: 'Stat chart', keyLabel: '', snippet: '*stat_chart\n\tpercent ${1:variable} ${2:Label}' }
]

/** Completion snippets shown in the suggest widget when typing a command. */
export const COMMAND_SNIPPETS: Record<string, string> = {
  goto: 'goto ${1:label}',
  gosub: 'gosub ${1:label}',
  goto_scene: 'goto_scene ${1:scene}',
  gosub_scene: 'gosub_scene ${1:scene}',
  set: 'set ${1:variable} ${2:value}',
  temp: 'temp ${1:variable} ${2:value}',
  create: 'create ${1:variable} ${2:value}',
  if: 'if (${1:condition})',
  elseif: 'elseif (${1:condition})',
  label: 'label ${1:name}',
  page_break: 'page_break ${1:Next}',
  choice: choiceSnippet(2).replace(/^\*/, ''),
  fake_choice: choiceSnippet(2, true).replace(/^\*/, '')
}
