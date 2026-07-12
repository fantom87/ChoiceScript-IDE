/**
 * Parse a scene into its nested *choice / *fake_choice option tree, annotating
 * each option with how it terminates (goto / finish / nested choice / conditional
 * / ⚠ falls-through). Powers the Choice Tree panel. Pure — tested in diagnose.ts.
 */

export type Terminator =
  | 'goto'
  | 'gosub'
  | 'goto_scene'
  | 'gosub_scene'
  | 'redirect_scene'
  | 'goto_random_scene'
  | 'finish'
  | 'ending'
  | 'return'
  | 'restart'
  | 'abort'
  | 'nested'
  | 'conditional'
  | 'fallthrough'

export interface ChoiceOption {
  label: string
  /** 0-based line of the #option. */
  line: number
  terminator: Terminator
  target?: string
  children: ChoiceNode[]
}

export interface ChoiceNode {
  type: 'choice' | 'fake_choice'
  /** 0-based line of the *choice. */
  line: number
  options: ChoiceOption[]
}

interface TreeLine {
  i: number
  indent: number
  text: string
  children: TreeLine[]
}

function indentOf(line: string): number {
  return /^([ \t]*)/.exec(line)![1].length
}

/** Build an indentation tree of non-blank lines. */
function buildTree(text: string): TreeLine[] {
  const roots: TreeLine[] = []
  const stack: TreeLine[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return
    const node: TreeLine = { i, indent: indentOf(raw), text: raw.trim(), children: [] }
    while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  })
  return roots
}

function terminatorOfBody(nodes: TreeLine[]): { type: Terminator; target?: string } {
  for (let k = nodes.length - 1; k >= 0; k--) {
    const t = nodes[k].text
    let m: RegExpExecArray | null
    if ((m = /^\*(goto|gosub)\b\s*(\S*)/.exec(t))) return { type: m[1] as Terminator, target: m[2] || undefined }
    if ((m = /^\*(goto_scene|gosub_scene|redirect_scene|goto_random_scene)\b\s*(\S*)/.exec(t)))
      return { type: m[1] as Terminator, target: m[2] || undefined }
    if (/^\*(finish|ending|return|restart|abort)\b/.test(t))
      return { type: t.slice(1).split(/\s/)[0] as Terminator }
    if (/^\*(choice|fake_choice)\b/.test(t)) return { type: 'nested' }
    if (/^\*(if|elseif|elsif|else)\b/.test(t)) return { type: 'conditional' }
  }
  return { type: 'fallthrough' }
}

function toChoiceNode(node: TreeLine): ChoiceNode | null {
  const m = /^\*(choice|fake_choice)\b/.exec(node.text)
  if (!m) return null
  const options: ChoiceOption[] = node.children
    .filter((c) => c.text.startsWith('#'))
    .map((opt) => {
      const term = terminatorOfBody(opt.children)
      return {
        label: opt.text.replace(/^#/, '').trim(),
        line: opt.i,
        terminator: term.type,
        target: term.target,
        children: collectChoices(opt.children)
      }
    })
  return { type: m[1] as 'choice' | 'fake_choice', line: node.i, options }
}

function collectChoices(nodes: TreeLine[]): ChoiceNode[] {
  const out: ChoiceNode[] = []
  for (const n of nodes) {
    const cn = toChoiceNode(n)
    if (cn) out.push(cn)
    else out.push(...collectChoices(n.children))
  }
  return out
}

/** Parse a scene's top-level choice structure (recursively nested). */
export function parseChoiceTree(text: string): ChoiceNode[] {
  return collectChoices(buildTree(text))
}
