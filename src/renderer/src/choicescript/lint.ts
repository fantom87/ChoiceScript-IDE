import { CS_COMMANDS } from './commands'

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  scene: string
  /** 0-based line number. */
  line: number
  /** 1-based start column. */
  startCol: number
  /** 1-based end column (exclusive). */
  endCol: number
  severity: Severity
  message: string
  code: string
  /** True for whole-project (execution-time) findings from the deep pass. */
  deferred?: boolean
}

export interface LintContext {
  scenes: Set<string>
  /** Permanent variables declared with *create / *create_array (expanded). */
  globalVars: Set<string>
  /** Lowercased *label names per scene. */
  labelsByScene: Record<string, Set<string>>
}

const COMMAND_SET = new Set(CS_COMMANDS)
const INITIAL_ONLY = new Set([
  'create',
  'create_array',
  'scene_list',
  'title',
  'author',
  'achievement',
  'product',
  'ifid'
])
const TERMINATORS = new Set([
  'goto',
  'gosub', // gosub returns, but still a valid non-fallthrough for this purpose
  'goto_scene',
  'gosub_scene',
  'goto_random_scene',
  'redirect_scene',
  'finish',
  'ending',
  'return',
  'restart',
  'abort'
])

function isBuiltinVar(name: string): boolean {
  return name.startsWith('choice_') || name === 'implicit_control_flow'
}

/** An option line, with or without inline modifiers (*if (x) #opt). */
const OPTION_LINE = /^\s*(?:\*(?:selectable_if|if|disable_reuse|hide_reuse|allow_reuse)\b[^#]*)?#/

/** Max number of binary operators appearing at any single paren level.
 *  ChoiceScript requires explicit grouping, so >=2 at one level is an error
 *  waiting to happen (e.g. `a + b + c` must be `((a + b) + c)`). */
function maxOpsPerLevel(expr: string): number {
  // Strings may contain anything — replace them first.
  let s = expr.replace(/"(?:[^"\\]|\\.)*"/g, 'S')
  const OPS = /%[+-]|<=|>=|!=|\band\b|\bor\b|\bmodulo\b|&|[+*/<>=]| - /g
  let max = 0
  const countOps = (frag: string): number => (frag.match(OPS) ?? []).length
  // Peel innermost groups, counting each level as we go.
  for (let guard = 0; guard < 50; guard++) {
    const m = /\(([^()]*)\)/.exec(s)
    if (!m) break
    max = Math.max(max, countOps(m[1]))
    s = s.slice(0, m.index) + 'X' + s.slice(m.index + m[0].length)
  }
  return Math.max(max, countOps(s))
}

/** Expand *create_array / *temp_array declarations into element + _count names. */
function addArrayVars(set: Set<string>, data: string): void {
  const m = /^(\w+)\s+(\d+)/.exec(data)
  if (!m) return
  const name = m[1].toLowerCase()
  const len = parseInt(m[2], 10)
  set.add(name)
  set.add(`${name}_count`)
  for (let i = 1; i <= len && i <= 1000; i++) set.add(`${name}_${i}`)
}

/** Build project-wide lint context from all files + scene order. */
export function buildLintContext(
  files: Record<string, string>,
  sceneList: string[]
): LintContext {
  const scenes = new Set<string>([...sceneList, ...Object.keys(files)])
  const globalVars = new Set<string>()
  const labelsByScene: Record<string, Set<string>> = {}

  for (const scene in files) {
    const labels = new Set<string>()
    for (const raw of files[scene].split(/\r?\n/)) {
      const line = raw.trim()
      let m = /^\*create\s+(\w+)/.exec(line)
      if (m) globalVars.add(m[1].toLowerCase())
      m = /^\*create_array\s+(.*)/.exec(line)
      if (m) addArrayVars(globalVars, m[1])
      m = /^\*label\s+(\w+)/.exec(line)
      if (m) labels.add(m[1].toLowerCase())
    }
    labelsByScene[scene] = labels
  }
  return { scenes, globalVars, labelsByScene }
}

/** Collect variables local to a scene (temps, params, array temps, its creates). */
function collectLocalVars(text: string): Set<string> {
  const local = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    let m = /^\*(?:temp|create)\s+(\w+)/.exec(line)
    if (m) local.add(m[1].toLowerCase())
    m = /^\*(?:temp_array|create_array)\s+(.*)/.exec(line)
    if (m) addArrayVars(local, m[1])
    m = /^\*params\s+(.*)/.exec(line)
    if (m) {
      for (const p of m[1].trim().split(/\s+/)) if (p) local.add(p.toLowerCase())
    }
  }
  return local
}

/** Lint one scene's text against project context. Structural, no execution. */
export function lintScene(scene: string, text: string, ctx: LintContext): Diagnostic[] {
  const diags: Diagnostic[] = []
  const lines = text.split(/\r?\n/)
  const localVars = collectLocalVars(text)
  const localLabels = ctx.labelsByScene[scene] ?? new Set<string>()
  const seenLabels = new Set<string>()

  const known = (v: string): boolean =>
    ctx.globalVars.has(v) || localVars.has(v) || isBuiltinVar(v)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Mixed tabs/spaces in leading indentation.
    const indentMatch = /^([ \t]*)/.exec(raw)![1]
    if (indentMatch.includes('\t') && indentMatch.includes(' ')) {
      diags.push({
        scene,
        line: i,
        startCol: 1,
        endCol: indentMatch.length + 1,
        severity: 'warning',
        message: 'Mixed tabs and spaces in indentation',
        code: 'mixed-indent'
      })
    }

    const cmd = /^(\s*)\*(\w+)(.*)$/.exec(raw)
    if (!cmd) continue
    const [, indent, name, restRaw] = cmd
    const command = name.toLowerCase()
    const data = restRaw.trim()
    const cmdStart = indent.length + 2 // 1-based col of command name (after '*')

    // Unknown command.
    if (!COMMAND_SET.has(command)) {
      diags.push({
        scene,
        line: i,
        startCol: indent.length + 1,
        endCol: cmdStart + name.length,
        severity: 'error',
        message: `Unknown command *${name}`,
        code: 'unknown-command'
      })
      continue
    }

    // Initial-only command used outside startup.
    if (INITIAL_ONLY.has(command) && scene !== 'startup') {
      diags.push({
        scene,
        line: i,
        startCol: cmdStart,
        endCol: cmdStart + name.length,
        severity: 'error',
        message: `*${command} is only allowed at the top of startup.txt`,
        code: 'initial-only'
      })
    }

    // Duplicate label.
    if (command === 'label') {
      const label = data.split(/\s+/)[0]?.toLowerCase()
      if (label) {
        if (seenLabels.has(label)) {
          diags.push({
            scene,
            line: i,
            startCol: cmdStart + name.length + 1,
            endCol: cmdStart + name.length + 1 + label.length,
            severity: 'error',
            message: `Duplicate label '${label}'`,
            code: 'dup-label'
          })
        }
        seenLabels.add(label)
      }
    }

    // *goto / *gosub -> label must exist in this scene.
    if (command === 'goto' || command === 'gosub') {
      const target = data.split(/\s+/)[0]
      if (target && !target.startsWith('{') && !localLabels.has(target.toLowerCase())) {
        const col = cmdStart + name.length + 1
        diags.push({
          scene,
          line: i,
          startCol: col,
          endCol: col + target.length,
          severity: 'error',
          message: `No label '${target}' in this scene`,
          code: 'missing-label'
        })
      }
    }

    // *goto_scene / *gosub_scene / *redirect_scene -> scene must exist.
    if (command === 'goto_scene' || command === 'gosub_scene' || command === 'redirect_scene') {
      const target = data.split(/\s+/)[0]
      if (target && !target.startsWith('{') && !ctx.scenes.has(target)) {
        const col = cmdStart + name.length + 1
        diags.push({
          scene,
          line: i,
          startCol: col,
          endCol: col + target.length,
          severity: 'error',
          message: `No scene '${target}' in this project`,
          code: 'missing-scene'
        })
      }
    }

    // *set / *rand / *input_* <var> -> target should be a declared variable.
    if (command === 'set' || command === 'rand' || command === 'input_text' || command === 'input_number') {
      const tm = /^([a-zA-Z_]\w*)/.exec(data)
      if (tm && !known(tm[1].toLowerCase())) {
        const col = cmdStart + name.length + 1
        diags.push({
          scene,
          line: i,
          startCol: col,
          endCol: col + tm[1].length,
          severity: 'warning',
          message: `Variable '${tm[1]}' is not declared (*create or *temp)`,
          code: 'undeclared-var'
        })
      }
    }

    // --- Expression checks (rules the engine only reports at run time) -----
    const isExprCmd = command === 'if' || command === 'elseif' || command === 'elsif' || command === 'selectable_if'
    if (isExprCmd || command === 'set') {
      // For option modifiers the expression stops at the '#'; for *set it
      // starts after the target variable.
      let expr = data
      const hash = expr.indexOf('#')
      if (isExprCmd && hash >= 0) expr = expr.slice(0, hash)
      if (command === 'set') expr = expr.replace(/^[a-zA-Z_]\w*(\[[^\]]*\])?\s*/, '')
      const exprCol = cmdStart + name.length + 1

      // `not`/`round`/`length` are functions — a following space breaks them.
      const stripped = expr.replace(/"(?:[^"\\]|\\.)*"/g, 'S')
      const fnM = /\b(not|round|length)\b(?!\()/.exec(stripped)
      if (fnM && !known(fnM[1])) {
        diags.push({
          scene,
          line: i,
          startCol: exprCol,
          endCol: raw.length + 1,
          severity: 'error',
          message: `${fnM[1]}() is a function — write ${fnM[1]}(...) with no space before the parenthesis`,
          code: 'fn-parens'
        })
      }

      // Multiple operators at one level need explicit parentheses.
      if (maxOpsPerLevel(expr) >= 2) {
        diags.push({
          scene,
          line: i,
          startCol: exprCol,
          endCol: raw.length + 1,
          severity: 'warning',
          message: 'ChoiceScript needs explicit parentheses when combining operators, e.g. ((a + b) + c)',
          code: 'needs-parens'
        })
      }
    }

    // Falling into *else/*elseif: the branch above must end in a control
    // transfer (unless options are being guarded, or implicit_control_flow).
    if ((command === 'else' || command === 'elseif' || command === 'elsif') &&
        !ctx.globalVars.has('implicit_control_flow')) {
      const myIndent = indent.length
      // Next non-blank deeper line an option? Then this if/else guards options.
      let guardsOptions = false
      for (let k = i + 1; k < lines.length; k++) {
        if (!lines[k].trim()) continue
        const kIndent = /^[ \t]*/.exec(lines[k])![0].length
        if (kIndent > myIndent) guardsOptions = OPTION_LINE.test(lines[k])
        break
      }
      if (!guardsOptions) {
        for (let k = i - 1; k >= 0; k--) {
          if (!lines[k].trim()) continue
          const kIndent = /^[ \t]*/.exec(lines[k])![0].length
          if (kIndent <= myIndent) break // empty/foreign branch — engine's problem
          const lastCmd = /^\s*\*(\w+)/.exec(lines[k])
          if (!lastCmd || !TERMINATORS.has(lastCmd[1].toLowerCase())) {
            diags.push({
              scene,
              line: i,
              startCol: cmdStart,
              endCol: cmdStart + name.length,
              severity: 'error',
              message: `The branch above falls into *${command} — end it with *goto/*finish/*return (or *create implicit_control_flow true)`,
              code: 'fall-into-else'
            })
          }
          break
        }
      }
    }
  }

  // Simple ${var} interpolation references to undeclared variables.
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (/^\s*\*comment\b/.test(raw)) continue
    const re = /[$@]!?\{([a-zA-Z_]\w*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const v = m[1].toLowerCase()
      if (!known(v)) {
        const start = m.index + m[0].indexOf(m[1]) + 1
        diags.push({
          scene,
          line: i,
          startCol: start,
          endCol: start + m[1].length,
          severity: 'warning',
          message: `Variable '${m[1]}' is not declared (*create or *temp)`,
          code: 'undeclared-var'
        })
      }
    }
  }

  return diags
}

/** Lint every scene in the project. */
export function lintProject(
  files: Record<string, string>,
  sceneList: string[]
): Record<string, Diagnostic[]> {
  const ctx = buildLintContext(files, sceneList)
  const out: Record<string, Diagnostic[]> = {}
  for (const scene in files) {
    out[scene] = lintScene(scene, files[scene], ctx)
  }
  return out
}

export { TERMINATORS }
