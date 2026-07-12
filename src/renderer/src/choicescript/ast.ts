/**
 * Statement-level ChoiceScript AST for the typed node editor. Every source line
 * is attributed to exactly one node (verbatim), so generateScene(parseScene(t))
 * reproduces t exactly — the guaranteed round-trip the typed canvas is built on.
 * Pure — round-trip tested in diagnose.ts.
 */

export type AstNode = TextNode | CommandNode | ChoiceNode | OptionNode | IfNode

export interface TextNode {
  type: 'text'
  /** Verbatim prose / blank lines. */
  raw: string[]
}
export interface CommandNode {
  type: 'command'
  /** Command name, lowercased (goto, set, page_break, label, …). */
  name: string
  /** The verbatim source line. */
  raw: string
}
export interface ChoiceNode {
  type: 'choice'
  fake: boolean
  /** The verbatim *choice / *fake_choice line. */
  header: string
  /** Options (and any guarding *if / blank lines) under the choice. */
  children: AstNode[]
}
export interface OptionNode {
  type: 'option'
  /** The verbatim #option line (including any modifier prefix). */
  header: string
  /** Option label text (without the leading #). */
  label: string
  /** Verbatim modifier prefix before the '#', e.g. '*selectable_if (x > 1) '
   *  or '*hide_reuse *if (y) ' — null for plain options. */
  modifier: string | null
  children: AstNode[]
}
export interface IfNode {
  type: 'if'
  kind: 'if' | 'elseif' | 'elsif' | 'else'
  /** The verbatim *if / *elseif / *else line. */
  header: string
  children: AstNode[]
}

function indentOf(line: string): number {
  return /^[ \t]*/.exec(line)![0].length
}

/** First index >= i whose non-blank line dedents to <= baseIndent (else end). */
function blockEnd(lines: string[], i: number, end: number, baseIndent: number): number {
  for (let k = i; k < end; k++) {
    if (!lines[k].trim()) continue
    if (indentOf(lines[k]) <= baseIndent) return k
  }
  return end
}

function parseBlock(lines: string[], start: number, end: number): AstNode[] {
  const nodes: AstNode[] = []
  let text: string[] = []
  const flush = (): void => {
    if (text.length) {
      nodes.push({ type: 'text', raw: text })
      text = []
    }
  }

  let i = start
  while (i < end) {
    const line = lines[i]
    if (!line.trim()) {
      text.push(line)
      i++
      continue
    }
    const ind = indentOf(line)
    const choiceM = /^\s*\*(choice|fake_choice)\b/.exec(line)
    // An option guarded by inline modifiers: *if / *selectable_if / *_reuse
    // (possibly chained) ending in '#label' on the SAME line. Must be checked
    // before the plain *if / command branches or it would be mistyped.
    const modOptM = /^(\s*)(\*(?:selectable_if|if|disable_reuse|hide_reuse|allow_reuse)\b[^#]*)#(.*)$/.exec(line)
    const ifM = /^\s*\*(if|elseif|elsif|else)\b/.exec(line)
    const isOption = /^\s*#/.test(line)
    const cmdM = /^\s*\*(\w+)/.exec(line)

    if (choiceM) {
      flush()
      const be = blockEnd(lines, i + 1, end, ind)
      nodes.push({
        type: 'choice',
        fake: choiceM[1] === 'fake_choice',
        header: line,
        children: parseBlock(lines, i + 1, be)
      })
      i = be
    } else if (isOption || modOptM) {
      flush()
      const be = blockEnd(lines, i + 1, end, ind)
      nodes.push({
        type: 'option',
        header: line,
        label: modOptM ? modOptM[3] : line.trim().replace(/^#/, ''),
        modifier: modOptM ? modOptM[2] : null,
        children: parseBlock(lines, i + 1, be)
      })
      i = be
    } else if (ifM) {
      flush()
      const be = blockEnd(lines, i + 1, end, ind)
      nodes.push({
        type: 'if',
        kind: ifM[1] as IfNode['kind'],
        header: line,
        children: parseBlock(lines, i + 1, be)
      })
      i = be
    } else if (cmdM) {
      flush()
      nodes.push({ type: 'command', name: cmdM[1].toLowerCase(), raw: line })
      i++
    } else {
      text.push(line) // prose
      i++
    }
  }
  flush()
  return nodes
}

export function parseScene(text: string): AstNode[] {
  const lines = text.split(/\r?\n/)
  return parseBlock(lines, 0, lines.length)
}

function genLines(nodes: AstNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out.push(...n.raw)
        break
      case 'command':
        out.push(n.raw)
        break
      case 'choice':
      case 'option':
      case 'if':
        out.push(n.header)
        out.push(...genLines(n.children))
        break
    }
  }
  return out
}

export function generateScene(nodes: AstNode[]): string {
  return genLines(nodes).join('\n')
}

/** Count option nodes directly under a choice (for the canvas count field). */
export function optionCount(choice: ChoiceNode): number {
  return choice.children.filter((c) => c.type === 'option').length
}

function indentPrefix(line: string): string {
  return /^[ \t]*/.exec(line)![0]
}

/** A short type label for a node's header. */
export function nodeTypeLabel(node: AstNode): string {
  switch (node.type) {
    case 'text':
      return 'Text'
    case 'command':
      return node.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    case 'choice':
      return node.fake ? 'Fake Choice' : 'Choice'
    case 'option':
      return 'Option'
    case 'if':
      return node.kind === 'else' ? 'Else' : node.kind === 'if' ? 'If' : 'Else If'
  }
}

/** The editable value shown in a node's inline field (empty when N/A). */
export function editableValue(node: AstNode): string {
  switch (node.type) {
    case 'text':
      return node.raw.join('\n')
    case 'command':
      return node.raw.replace(/^\s*\*\w+\s?/, '')
    case 'option':
      return node.label
    case 'if':
      return node.header.replace(/^\s*\*(?:if|elseif|elsif|else)\s?/, '')
    case 'choice':
      return ''
  }
}

/** Apply an edited inline value back into a node (mutates, preserving indent). */
export function applyValue(node: AstNode, value: string): void {
  switch (node.type) {
    case 'text':
      node.raw = value.split('\n')
      break
    case 'command': {
      const p = indentPrefix(node.raw)
      node.raw = `${p}*${node.name}${value ? ` ${value}` : ''}`
      break
    }
    case 'option': {
      const p = indentPrefix(node.header)
      node.label = value
      node.header = `${p}${node.modifier ?? ''}#${value}`
      break
    }
    case 'if': {
      const p = indentPrefix(node.header)
      const kw = node.kind
      node.header = `${p}*${kw}${value && kw !== 'else' ? ` ${value}` : ''}`
      break
    }
    case 'choice':
      break
  }
}

export interface LineTint {
  /** 1-based inclusive line range. */
  start: number
  end: number
  type: 'command' | 'choice' | 'option' | 'if'
}

/** Per-line node types for editor tinting (prose lines are untinted). */
export function lineTints(text: string): LineTint[] {
  const out: LineTint[] = []
  let line = 0
  const walk = (list: AstNode[]): void => {
    for (const n of list) {
      if (n.type === 'text') {
        line += n.raw.length
        continue
      }
      line++
      out.push({ start: line, end: line, type: n.type === 'command' ? 'command' : n.type })
      if ('children' in n) walk(n.children)
    }
  }
  walk(parseScene(text))
  return out
}

/** The leading indentation of a node's first line. */
export function nodeIndent(node: AstNode): string {
  switch (node.type) {
    case 'text':
      return indentPrefix(node.raw[0] ?? '')
    case 'command':
      return indentPrefix(node.raw)
    default:
      return indentPrefix(node.header)
  }
}

/** Remove `target` from the tree (mutates; true if found). */
export function removeNode(ast: AstNode[], target: AstNode): boolean {
  const idx = ast.indexOf(target)
  if (idx >= 0) {
    ast.splice(idx, 1)
    return true
  }
  for (const n of ast) {
    if ('children' in n && removeNode(n.children, target)) return true
  }
  return false
}

/** Insert `newNode` immediately after `anchor` (mutates; true if found). */
export function insertAfter(ast: AstNode[], anchor: AstNode, newNode: AstNode): boolean {
  const idx = ast.indexOf(anchor)
  if (idx >= 0) {
    ast.splice(idx + 1, 0, newNode)
    return true
  }
  for (const n of ast) {
    if ('children' in n && insertAfter(n.children, anchor, newNode)) return true
  }
  return false
}

/** Insert `newNode` immediately before `anchor` (mutates; true if found). */
export function insertBefore(ast: AstNode[], anchor: AstNode, newNode: AstNode): boolean {
  const idx = ast.indexOf(anchor)
  if (idx >= 0) {
    ast.splice(idx, 0, newNode)
    return true
  }
  for (const n of ast) {
    if ('children' in n && insertBefore(n.children, anchor, newNode)) return true
  }
  return false
}

export type NewNodeKind =
  | 'text'
  | 'set'
  | 'temp'
  | 'create'
  | 'goto'
  | 'page_break'
  | 'if'
  | 'else'
  | 'choice'
  | 'fake_choice'
  | 'option'

/** Build a fresh statement at the given indentation. `unit` = one indent level. */
export function makeNode(kind: NewNodeKind, indent: string, unit: string): AstNode {
  switch (kind) {
    case 'option':
      return {
        type: 'option',
        header: `${indent}#New option`,
        label: 'New option',
        modifier: null,
        children: [{ type: 'text', raw: [`${indent}${unit}Result.`] }]
      }
    case 'text':
      return { type: 'text', raw: [`${indent}New paragraph.`] }
    case 'set':
      return { type: 'command', name: 'set', raw: `${indent}*set var value` }
    case 'temp':
      return { type: 'command', name: 'temp', raw: `${indent}*temp var 0` }
    case 'create':
      return { type: 'command', name: 'create', raw: `${indent}*create var 0` }
    case 'goto':
      return { type: 'command', name: 'goto', raw: `${indent}*goto label` }
    case 'page_break':
      return { type: 'command', name: 'page_break', raw: `${indent}*page_break` }
    case 'if':
      return {
        type: 'if',
        kind: 'if',
        header: `${indent}*if (condition)`,
        children: [{ type: 'text', raw: [`${indent}${unit}Then this.`] }]
      }
    case 'else':
      return {
        type: 'if',
        kind: 'else',
        header: `${indent}*else`,
        children: [{ type: 'text', raw: [`${indent}${unit}Otherwise this.`] }]
      }
    case 'choice':
    case 'fake_choice': {
      const fake = kind === 'fake_choice'
      const choice: ChoiceNode = {
        type: 'choice',
        fake,
        header: `${indent}*${fake ? 'fake_choice' : 'choice'}`,
        children: []
      }
      setChoiceCount(choice, 2, unit)
      return choice
    }
  }
}

/** Build one or more statements — 'if_else' expands to an *if + *else pair. */
export function makeNodes(kind: NewNodeKind | 'if_else', indent: string, unit: string): AstNode[] {
  if (kind === 'if_else') return [makeNode('if', indent, unit), makeNode('else', indent, unit)]
  return [makeNode(kind, indent, unit)]
}

/** Locate a node's containing list + index anywhere in the tree. */
function locate(ast: AstNode[], target: AstNode): { list: AstNode[]; idx: number } | null {
  const idx = ast.indexOf(target)
  if (idx >= 0) return { list: ast, idx }
  for (const n of ast) {
    if ('children' in n) {
      const found = locate(n.children, target)
      if (found) return found
    }
  }
  return null
}

/** Move a statement one slot earlier/later among its siblings (mutates). */
export function moveNode(ast: AstNode[], target: AstNode, dir: -1 | 1): boolean {
  const loc = locate(ast, target)
  if (!loc) return false
  const j = loc.idx + dir
  if (j < 0 || j >= loc.list.length) return false
  loc.list.splice(loc.idx, 1)
  loc.list.splice(j, 0, target)
  return true
}

/** Prepend one indent level to every line of a subtree (mutates). */
export function reindentNode(node: AstNode, unit: string): void {
  switch (node.type) {
    case 'text':
      node.raw = node.raw.map((l) => (l.trim() ? unit + l : l))
      break
    case 'command':
      node.raw = unit + node.raw
      break
    default:
      node.header = unit + node.header
      for (const c of node.children) reindentNode(c, unit)
  }
}

/** Replace `target` with an *if wrapping it (re-indented one level). */
export function wrapInIf(ast: AstNode[], target: AstNode, unit: string): boolean {
  const loc = locate(ast, target)
  if (!loc) return false
  const indent = nodeIndent(target)
  reindentNode(target, unit)
  loc.list[loc.idx] = { type: 'if', kind: 'if', header: `${indent}*if (condition)`, children: [target] }
  return true
}

/** Set/replace/clear an option's inline modifier (null = plain option). */
export function setOptionModifier(opt: OptionNode, modifier: string | null): void {
  const p = indentPrefix(opt.header)
  const m = modifier?.trim() ? `${modifier.trim()} ` : null
  opt.modifier = m
  opt.header = `${p}${m ?? ''}#${opt.label}`
}

/** Add/remove options on a choice to match `n` (mutates). `unit` is one indent
 * level (e.g. '\t' or '  '), used only for freshly spawned options/bodies. */
export function setChoiceCount(choice: ChoiceNode, n: number, unit = '  '): void {
  const options = choice.children.filter((c): c is OptionNode => c.type === 'option')
  const optIndent = options[0] ? indentPrefix(options[0].header) : `${indentPrefix(choice.header)}${unit}`
  const bodyIndent = `${optIndent}${unit}`
  if (n > options.length) {
    for (let k = options.length; k < n; k++) {
      const body: AstNode[] = choice.fake
        ? [{ type: 'text', raw: [`${bodyIndent}Result of option ${k + 1}.`] }]
        : [{ type: 'command', name: 'goto', raw: `${bodyIndent}*goto label` }]
      choice.children.push({
        type: 'option',
        header: `${optIndent}#Option ${k + 1}`,
        label: `Option ${k + 1}`,
        modifier: null,
        children: body
      })
    }
  } else if (n < options.length) {
    let seen = 0
    choice.children = choice.children.filter((c) => c.type !== 'option' || ++seen <= n)
  }
}
