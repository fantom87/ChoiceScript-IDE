/*
 * ChoiceScript IDE — headless diagnostic harness.
 * Exercises all pure logic AND the real ChoiceScript engine in-process (Node,
 * no GPU/display needed), then writes diag-report.md. Run with `npm run diag`.
 */
import { promises as fsp, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as vm from 'node:vm'

import { lintScene, buildLintContext } from '../src/renderer/src/choicescript/lint'
import { nearest } from '../src/renderer/src/choicescript/nearest'
import { generateMygameJs, getSceneList } from '../src/renderer/src/choicescript/mygameGen'
import { listSaves, writeSave, deleteSave } from '../src/main/saveStore'
import { snapshot, listSnapshots, readSnapshot } from '../src/main/historyStore'
import { renameSceneRefs } from '../src/renderer/src/choicescript/sceneRename'
import { extractProseWords, checkProse, maskLine } from '../src/renderer/src/choicescript/spell'
import nspell from 'nspell'
import { enumerateStats, buildIsolatedRun } from '../src/renderer/src/choicescript/stats'
import { normalizeIndentation, detectIndentUnit } from '../src/renderer/src/choicescript/indent'
import { insertIntoSceneList } from '../src/renderer/src/choicescript/sceneList'
import { buildStandaloneHtml } from '../src/main/exportHtml'
import { parseChoiceTree } from '../src/renderer/src/choicescript/choiceTree'
import { STARTUP_TEMPLATE } from '../src/main/scaffold'
import { parseRandomResults } from '../src/renderer/src/choicescript/randomTest'
import {
  resolveDefinition,
  searchProject,
  renameVariable,
  detectSymbol
} from '../src/renderer/src/choicescript/navigation'
import { countWords } from '../src/renderer/src/choicescript/wordCount'
import {
  parseScene,
  generateScene,
  optionCount,
  setChoiceCount,
  applyValue,
  nodeTypeLabel,
  insertAfter,
  removeNode,
  makeNode,
  makeNodes,
  moveNode,
  wrapInIf,
  setOptionModifier,
  nodeIndent,
  lineTints,
  type AstNode,
  type ChoiceNode,
  type OptionNode,
  type CommandNode,
  type IfNode
} from '../src/renderer/src/choicescript/ast'
import { buildChoiceGraph, connectNodes, buildGameGraph } from '../src/renderer/src/graph/astGraph'
import { routeCross, routeInterior, routeTrunk, pointsToPath, pathHitsRect } from '../src/renderer/src/graph/edgeRouting'
import { layoutWith, layoutWithElk, GRID_COLS } from '../src/renderer/src/graph/canvasLayout'
import { isNewerVersion, pickUpdate } from '../src/shared/update'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { AstCanvas } from '../src/renderer/src/graph/AstCanvas'
import { Tutorial, TUTORIAL_STEPS } from '../src/renderer/src/tutorial/Tutorial'
import { LESSONS, BASIC_FINAL, checkLesson, type Lesson } from '../src/renderer/src/tutorial/lessons'
import { ADVANCED_LESSONS, checkAdvanced } from '../src/renderer/src/tutorial/advancedLessons'
import type { SavePoint } from '../src/shared/types'

interface Result {
  section: string
  name: string
  pass: boolean
  detail: string
}
const results: Result[] = []
async function check(section: string, name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    const detail = await fn()
    results.push({ section, name, pass: true, detail: detail == null ? 'ok' : String(detail) })
  } catch (e) {
    results.push({ section, name, pass: false, detail: (e as Error).message || String(e) })
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const ROOT = process.cwd()
const ENGINE = join(ROOT, 'resources', 'engine')
const SAMPLE = join(ROOT, 'resources', 'sample-game', 'scenes')

function loadSampleFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const n of readdirSync(SAMPLE)) {
    if (n.endsWith('.txt')) files[n.replace(/\.txt$/, '')] = readFileSync(join(SAMPLE, n), 'utf8')
  }
  return files
}

async function main(): Promise<void> {
  const files = loadSampleFiles()
  const sceneList = getSceneList(files['startup'] ?? '')

  // --- Logic ---------------------------------------------------------------
  await check('Logic', 'linter flags a broken scene', () => {
    const broken = ['*gotoo x', '*goto nope', '*goto_scene ghost', '*set undecl 1'].join('\n')
    const ctx = buildLintContext({ startup: broken }, ['startup'])
    const d = lintScene('startup', broken, ctx)
    const codes = new Set(d.map((x) => x.code))
    assert(codes.has('unknown-command'), 'missing unknown-command')
    assert(codes.has('missing-label'), 'missing missing-label')
    assert(codes.has('missing-scene'), 'missing missing-scene')
    assert(codes.has('undeclared-var'), 'missing undeclared-var')
    return `${d.length} diagnostics`
  })
  await check('Logic', 'linter is clean on the sample project', () => {
    const ctx = buildLintContext(files, sceneList)
    let total = 0
    const errs: string[] = []
    for (const s in files) {
      const d = lintScene(s, files[s], ctx).filter((x) => x.severity === 'error')
      total += d.length
      d.forEach((x) => errs.push(`${x.scene}:${x.line + 1} ${x.message}`))
    }
    assert(total === 0, `sample has lint errors: ${errs.join('; ')}`)
    return 'no errors'
  })
  await check('Logic', 'nearest-match suggestions', () => {
    assert(nearest(['goto', 'gosub', 'finish'], 'gotoo') === 'goto', 'gotoo should map to goto')
    assert(nearest(['goto'], 'zxqwv') === null, 'gibberish should map to null')
    return 'ok'
  })
  await check('Logic', 'mygame.js generation from sample startup', () => {
    const js = generateMygameJs(files['startup'] ?? '', files)
    assert(/new SceneNavigator\(\[/.test(js), 'no nav')
    assert(js.includes('leadership') && js.includes('strength'), 'sample stats missing')
    assert(sceneList.length >= 6, `expected >=6 scenes, got ${sceneList.length}`)
    return `${sceneList.length} scenes: ${sceneList.join(', ')}`
  })
  await check('Logic', 'indentation normalization', () => {
    const twoSpace = '*choice\n  #A\n    You picked A.\n    *finish\n  #B\n    *finish'
    assert(detectIndentUnit(twoSpace).width === 2, 'should detect 2-space unit')
    const toFour = normalizeIndentation(twoSpace, { style: 'space', width: 4 })
    assert(toFour.text.includes('\n    #A\n'), '#A should be 4 spaces')
    assert(toFour.text.includes('\n        You picked A.\n'), 'body should be 8 spaces')
    const toTab = normalizeIndentation(twoSpace, { style: 'tab', width: 1 })
    assert(toTab.text.includes('\n\t#A\n'), '#A should be 1 tab')
    assert(toTab.text.includes('\n\t\tYou picked A.\n'), 'body should be 2 tabs')
    const idempotent = normalizeIndentation(toFour.text, { style: 'space', width: 4 })
    assert(idempotent.changed === 0, 'normalizing already-normal text changes nothing')
    return 'space<->tab + depth preserved + idempotent'
  })
  await check('Logic', 'typed AST round-trip (sample + stress game)', () => {
    const check1 = (label: string, src: Record<string, string>): void => {
      for (const s in src) {
        const norm = src[s].split(/\r?\n/).join('\n')
        const out = generateScene(parseScene(src[s]))
        assert(out === norm, `AST round-trip broke for ${label}/${s}`)
      }
    }
    check1('sample', files)

    // The stress gauntlet (deep nesting, wide choices, every feature), if present.
    const stress = join('C:\\', 'Users', 'bradl', 'Dropbox', 'Choicescript Projects', 'the-stress-gauntlet', 'scenes')
    let stressScenes = 0
    try {
      for (const n of readdirSync(stress)) {
        if (!n.endsWith('.txt')) continue
        const t = readFileSync(join(stress, n), 'utf8')
        assert(generateScene(parseScene(t)) === t.split(/\r?\n/).join('\n'), `AST round-trip broke for stress/${n}`)
        stressScenes++
      }
    } catch {
      /* stress game not present; skip */
    }

    // A hand-built deeply-nested case (choice → option → *if → nested choice,
    // with *else and a blank line) must round-trip exactly.
    const deep = [
      '*choice',
      '  #A',
      '    *if (x > 1)',
      '      *choice',
      '        #A1',
      '          You chose A1.',
      '          *goto done',
      '        #A2',
      '          *finish',
      '    *else',
      '      *goto done',
      '  #B',
      '    *finish',
      '',
      '*label done',
      '*finish'
    ].join('\n')
    assert(generateScene(parseScene(deep)) === deep, 'deep-nested round-trip broke')

    // Structure: variables has a choice with option children and an *if node.
    const nodes = parseScene(files['variables'] ?? '')
    const findChoice = (ns: AstNode[]): boolean =>
      ns.some((n) => (n.type === 'choice' && optionCount(n) >= 2) || ('children' in n && findChoice(n.children as AstNode[])))
    const findIf = (ns: AstNode[]): boolean =>
      ns.some((n) => n.type === 'if' || ('children' in n && findIf(n.children as AstNode[])))
    assert(findChoice(nodes), 'no choice node with options parsed in variables')
    assert(findIf(nodes), 'no *if node parsed in variables')
    return `${Object.keys(files).length} sample + ${stressScenes} stress scenes round-trip; structure typed`
  })
  await check('Logic', 'typed AST deep nesting + convergence', () => {
    // Programmatic tower of nested *fake_choice that converges to one line — the
    // "several layers deep before coming back" case the docked view must handle.
    const buildDeep = (levels: number): string => {
      const lines: string[] = []
      const ind = (d: number): string => '  '.repeat(d)
      const emit = (d: number, remaining: number): void => {
        lines.push(`${ind(d)}*fake_choice`)
        lines.push(`${ind(d + 1)}#Go deeper`)
        if (remaining > 1) emit(d + 2, remaining - 1)
        else lines.push(`${ind(d + 2)}You reached the bottom.`)
        lines.push(`${ind(d + 1)}#Stay here`)
        lines.push(`${ind(d + 2)}You stayed at level ${remaining}.`)
      }
      emit(0, levels)
      lines.push('Everyone reconvenes here.') // convergence back to depth 0
      return lines.join('\n')
    }

    const maxDepth = (ns: AstNode[], d = 0): number => {
      let m = d
      for (const n of ns) if ('children' in n) m = Math.max(m, maxDepth(n.children, d + 1))
      return m
    }

    const src = buildDeep(5) // choices at depths 0,2,4,6,8
    const ast = parseScene(src)
    assert(generateScene(ast) === src, 'deep tower round-trip broke')
    assert(maxDepth(ast) >= 9, `expected deep nesting, got depth ${maxDepth(ast)}`)
    // Convergence line is a top-level (depth 0) sibling after the whole tower.
    const last = ast[ast.length - 1]
    assert(last.type === 'text' && last.raw.join('').includes('reconvenes'), 'convergence line not top-level')
    return `10-level tower round-trips; maxDepth=${maxDepth(ast)}; converges to depth 0`
  })
  await check('Logic', 'choice-flow graph (breakout + coverage)', () => {
    // Every AST statement must appear exactly once in the graph — as a choice
    // node, an option, or a docked row — so nothing is lost or duplicated.
    const countAst = (ns: AstNode[]): number =>
      ns.reduce((a, n) => a + 1 + ('children' in n ? countAst((n as { children: AstNode[] }).children) : 0), 0)
    const rowsIn = (g: ReturnType<typeof buildChoiceGraph>): number =>
      g.nodes.reduce(
        (a, n) =>
          a +
          (n.kind === 'content' || n.kind === 'option'
            ? n.rows.length
            : n.kind === 'choice'
              ? n.preRows.length
              : 0), // stubs mirror commands already counted as rows
        0
      )
    const kindCount = (g: ReturnType<typeof buildChoiceGraph>, k: string): number =>
      g.nodes.filter((n) => n.kind === k).length

    for (const s in files) {
      const ast = parseScene(files[s])
      const g = buildChoiceGraph(ast)
      // Every statement appears once: choice node, option node, or docked row.
      assert(
        rowsIn(g) + kindCount(g, 'choice') + kindCount(g, 'option') === countAst(ast),
        `graph coverage mismatch for ${s}`
      )
    }

    // Every #option is its OWN node, wired from its choice; a nested choice
    // breaks out and is wired from the option it lives under.
    const nested = [
      '*choice',
      '  #A',
      '    *set x 1',
      '    *choice',
      '      #A1',
      '        *goto done',
      '      #A2',
      '        *goto done',
      '  #B',
      '    *goto done',
      '*label done'
    ].join('\n')
    const g = buildChoiceGraph(parseScene(nested))
    assert(kindCount(g, 'choice') === 2, `expected 2 choice nodes, got ${kindCount(g, 'choice')}`)
    assert(kindCount(g, 'option') === 4, `expected 4 option nodes (A,B,A1,A2), got ${kindCount(g, 'option')}`)
    // 4 choice→option edges.
    assert(g.edges.filter((e) => e.kind === 'option').length === 4, 'each option should be wired from its choice')
    const aOpt = g.nodes.find((n) => n.kind === 'option' && n.label === 'A')
    assert(!!aOpt && aOpt.kind === 'option', 'option A node missing')
    assert(aOpt.kind === 'option' && aOpt.rows.some((r) => r.nodeType === 'command'), 'option A did not dock its *set')
    // Option A must lead onward (seq edge) to the inner choice node.
    const innerChoice = g.nodes.find((n) => n.kind === 'choice' && n.startLine > 0)
    assert(
      !!innerChoice && g.edges.some((e) => e.kind === 'seq' && e.source === aOpt.id && e.target === innerChoice.id),
      'option A should lead to the nested choice'
    )
    return `${Object.keys(files).length} scenes cover fully; every #option is its own node, nested choice breaks out`
  })
  await check('Logic', 'choice grid wraps wide fans into rows', () => {
    // A 12-option choice, built through the REAL graph pipeline.
    const lines = ['*choice']
    for (let i = 1; i <= 12; i++) {
      lines.push(`  #Option number ${i}`, '    *goto done')
    }
    lines.push('*label done', 'End.')
    const g = buildChoiceGraph(parseScene(lines.join('\n')))
    const nodes = g.nodes.map((gn) => ({
      id: gn.id,
      type: gn.kind,
      position: { x: 0, y: 0 },
      data: { g: gn },
      width: 260,
      initialHeight: 90
    }))
    const edges = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
    const laid = layoutWith(nodes as never, edges as never)
    const opts = laid.filter((n) => (n.data as { g: { kind: string } }).g.kind === 'option')
    assert(opts.length === 12, `expected 12 options, got ${opts.length}`)
    const rows = new Set(opts.map((n) => Math.round(n.position.y / 10)))
    assert(rows.size >= Math.ceil(12 / GRID_COLS), `options in ${rows.size} row(s) — grid did not wrap`)
    for (const row of rows) {
      const inRow = opts.filter((n) => Math.round(n.position.y / 10) === row)
      assert(inRow.length <= GRID_COLS, `row has ${inRow.length} options (max ${GRID_COLS})`)
    }
    // Columns must ALIGN across rows (a true grid, not a staircase).
    const cols = new Set(opts.map((n) => Math.round(n.position.x)))
    assert(cols.size <= GRID_COLS, `options spread over ${cols.size} x-positions (max ${GRID_COLS} columns)`)
    const gridW = Math.max(...opts.map((n) => n.position.x)) - Math.min(...opts.map((n) => n.position.x))
    assert(gridW <= GRID_COLS * 320, `grid too wide: ${Math.round(gridW)}px`)
    return `12 options in a ${cols.size}-column grid, ${rows.size} rows`
  })
  await check('Logic', 'ELK trial layout positions nodes and routes edges', async () => {
    // The same 12-option fan through the ELK engine — every node must get a
    // position and every edge an orthogonal route (elk.bundled.js runs in Node).
    const lines = ['*choice']
    for (let i = 1; i <= 12; i++) {
      lines.push(`  #Option number ${i}`, '    *goto done')
    }
    lines.push('*label done', 'End.')
    const g = buildChoiceGraph(parseScene(lines.join('\n')))
    const nodes = g.nodes.map((gn) => ({
      id: gn.id,
      type: gn.kind,
      position: { x: 0, y: 0 },
      data: { g: gn },
      width: 260,
      initialHeight: 90
    }))
    const edges = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
    const { nodes: laid, routes } = await layoutWithElk(nodes as never, edges as never)
    assert(laid.length === nodes.length, 'ELK dropped nodes')
    const ys = new Set(laid.map((n) => Math.round(n.position.y)))
    assert(ys.size > 1, 'ELK produced a single rank — layout did not run')
    assert(routes.size === edges.length, `ELK routed ${routes.size}/${edges.length} edges`)
    for (const [id, pts] of routes) {
      assert(pts.length >= 2, `route ${id} has ${pts.length} points`)
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x)
        const dy = Math.abs(pts[i].y - pts[i - 1].y)
        assert(dx < 0.01 || dy < 0.01, `route ${id} has a diagonal segment`)
      }
    }
    return `${laid.length} nodes placed, ${routes.size} orthogonal routes`
  })
  await check('Logic', 'tutorial steps are well-formed + render headlessly', () => {
    const ids = new Set<string>()
    for (const s of TUTORIAL_STEPS) {
      assert(!!s.id && !ids.has(s.id), `duplicate/empty step id: ${s.id}`)
      ids.add(s.id)
      assert(s.title.length > 0 && s.body.length > 20, `step ${s.id} lacks title/body`)
      assert(!s.advance || !!s.action, `step ${s.id} auto-advances but gives no action hint`)
    }
    assert(TUTORIAL_STEPS.length >= 8, 'tour suspiciously short')
    assert(!TUTORIAL_STEPS[0].target, 'first step should be a centred welcome card')
    // Every step (spotlit and centred) must render server-side without crashing.
    const signals = { activeScene: 'startup', viewMode: 'live' as const, gameMode: false, settingsOpen: false }
    const html = renderToString(createElement(Tutorial, { signals, onClose: () => {} }))
    assert(html.includes('tut-card') && html.includes('Welcome'), 'tutorial card did not render')
    // Auto-advance predicates fire on the states they watch.
    const s2 = TUTORIAL_STEPS.find((s) => s.id === 'scenes')!
    assert(s2.advance!({ ...signals, activeScene: 'crew' }, signals), 'scene-change advance broken')
    const s5 = TUTORIAL_STEPS.find((s) => s.id === 'nodes-switch')!
    assert(s5.advance!({ ...signals, viewMode: 'typed' }, signals), 'view-switch advance broken')
    const s7 = TUTORIAL_STEPS.find((s) => s.id === 'wholegame')!
    assert(s7.advance!({ ...signals, gameMode: true }, signals), 'game-mode advance broken')
    return `${TUTORIAL_STEPS.length} steps valid; SSR renders; advance predicates fire`
  })
  await check('Logic', 'build-a-game lessons: demos pass, progression is real', () => {
    const verifyCourse = (
      name: string,
      lessons: Lesson[],
      checkAt: (i: number, files: Record<string, string>) => { pass: boolean; notes: string[] },
      skipLastProgression: boolean,
      predecessor?: Record<string, string>
    ): void => {
      for (let i = 0; i < lessons.length; i++) {
        const l = lessons[i]
        assert(l.body.length >= 1 && l.task.length > 10, `${name}/${l.id} lacks body/task`)
        // The exemplar for each lesson must satisfy its own check…
        const own = checkAt(i, l.demo)
        assert(own.pass, `${name}/${l.id}: its own demo fails its check — ${own.notes.join('; ')}`)
        // …and every demo must be a REAL ChoiceScript stage: round-trip + lint clean.
        const ctx2 = buildLintContext(l.demo, getSceneList(l.demo['startup'] ?? ''))
        for (const s in l.demo) {
          assert(
            generateScene(parseScene(l.demo[s])) === l.demo[s].split(/\r?\n/).join('\n'),
            `${name}/${l.id}: demo scene ${s} breaks round-trip`
          )
          const errs = lintScene(s, l.demo[s], ctx2).filter((d) => d.severity === 'error')
          assert(errs.length === 0, `${name}/${l.id}: demo ${s} has lint errors: ${errs[0]?.message}`)
        }
        // Each lesson must demand something the PREVIOUS stage doesn't
        // already satisfy — otherwise it teaches nothing new.
        const prevDemo = i > 0 ? lessons[i - 1].demo : predecessor
        if (prevDemo && !(skipLastProgression && i === lessons.length - 1)) {
          assert(!checkAt(i, prevDemo).pass, `${name}/${l.id} is already satisfied by the previous stage`)
        }
      }
    }
    assert(LESSONS.length === 12, `expected 12 basic lessons, got ${LESSONS.length}`)
    assert(ADVANCED_LESSONS.length === 10, `expected 10 advanced lessons, got ${ADVANCED_LESSONS.length}`)
    // Basic: lesson 12 (ship) is legitimately satisfied by stage 11's game.
    verifyCourse('basic', LESSONS, checkLesson, true)
    // Advanced: continues from the finished basic game, every lesson new.
    verifyCourse('advanced', ADVANCED_LESSONS, checkAdvanced, false, BASIC_FINAL)
    // The fresh tutorial scaffold must fail lesson 1 (placeholders present).
    const fresh = {
      startup: '*title My First Game\n*author Your Name Here\n*scene_list\n  startup\n\nSome text.\n\n*finish\n'
    }
    assert(!checkLesson(0, fresh).pass, 'the untouched scaffold should not pass lesson 1')
    return `${LESSONS.length} basic + ${ADVANCED_LESSONS.length} advanced: demos valid + lint-clean, progression enforced`
  })
  await check('Logic', 'file history: snapshot / dedupe / cap / restore', async () => {
    const root = join(tmpdir(), `cside-hist-${Date.now()}`)
    await snapshot(root, 'alpha', 'version one')
    await snapshot(root, 'alpha', 'version one') // identical → deduped
    await snapshot(root, 'alpha', 'version two')
    const list = await listSnapshots(root, 'alpha')
    assert(list.length === 2, `expected 2 snapshots after dedupe, got ${list.length}`)
    const newest = await readSnapshot(root, 'alpha', list[0].id)
    assert(newest === 'version two', `newest snapshot wrong: ${newest}`)
    // Cap: many snapshots never exceed the limit.
    for (let i = 0; i < 30; i++) await snapshot(root, 'beta', `v${i}`)
    const beta = await listSnapshots(root, 'beta')
    assert(beta.length <= 25, `cap failed: ${beta.length} snapshots`)
    let threw = false
    try {
      await readSnapshot(root, 'alpha', '..\\..\\evil.txt')
    } catch {
      threw = true
    }
    assert(threw, 'path traversal in snapshot id must throw')
    await fsp.rm(root, { recursive: true, force: true })
    return 'snapshot/dedupe/cap/read + id guard ok'
  })
  await check('Logic', 'scene rename rewrites scene_list + goto_scene refs', () => {
    const files = {
      startup: [
        '*title T',
        '*scene_list',
        '  startup',
        '  old_name',
        '  ending',
        '',
        'Some prose mentioning old_name casually.',
        '*goto_scene old_name',
        '*goto_scene old_name some_label',
        '*goto_scene older_name',
        '*finish'
      ].join('\n'),
      old_name: ['*comment c', '*gosub_scene old_name helper', '*finish', '*label helper', '*return'].join('\n'),
      ending: ['*redirect_scene old_name', '*ending'].join('\n')
    }
    const changed = renameSceneRefs(files, 'old_name', 'fresh')
    assert(!!changed.startup && !!changed.old_name && !!changed.ending, 'all three scenes should change')
    assert(changed.startup.includes('  fresh\n'), 'scene_list entry not renamed')
    assert(changed.startup.includes('*goto_scene fresh\n'), 'bare goto_scene not renamed')
    assert(changed.startup.includes('*goto_scene fresh some_label'), 'goto_scene with label arg broken')
    assert(changed.startup.includes('*goto_scene older_name'), 'prefix-named scene must NOT be renamed')
    assert(changed.startup.includes('prose mentioning old_name casually'), 'prose must not be touched')
    assert(changed.old_name.includes('*gosub_scene fresh helper'), 'gosub_scene not renamed')
    assert(changed.ending.includes('*redirect_scene fresh'), 'redirect_scene not renamed')
    return 'scene_list + goto/gosub/redirect refs rewritten; prose + prefixes untouched'
  })
  await check('Logic', 'spellcheck: prose-only extraction + real dictionary', () => {
    // Masking: commands vanish, option prose survives, ${}/@{}/[] stripped.
    assert(maskLine('*set courage %+ 10') === null, 'command lines must be skipped')
    assert(maskLine('  #Signal back.')!.includes('Signal back.'), 'option prose must survive')
    const masked = maskLine('Hello ${name}, you look @{(x) grand|terrible} in [b]red[/b].')!
    assert(!masked.includes('name') && !masked.includes('grand'), 'interpolations must be masked')
    assert(masked.includes('Hello') && masked.includes('red'), 'surrounding prose must survive')
    const words = extractProseWords('The lamp glows.\n*comment not prose\n  #An option here.')
    assert(
      words.some((w) => w.word === 'lamp') && words.some((w) => w.word === 'option'),
      'extraction missed prose words'
    )
    assert(!words.some((w) => w.word === 'prose'), 'comment content must not be spellchecked')
    // Real dictionary: a genuine typo is caught, real words are not, and the
    // ignore list works.
    const dict = nspell(
      readFileSync(join(ROOT, 'node_modules', 'dictionary-en', 'index.aff'), 'utf8'),
      readFileSync(join(ROOT, 'node_modules', 'dictionary-en', 'index.dic'), 'utf8')
    )
    const text = 'The lighthouse keeper reads the barometer.\n\nThe wether is foul tonight, Vexilla.'
    const bad = checkProse(dict, text, new Set())
    assert(!bad.some((m) => m.word === 'lighthouse'), 'real words must pass')
    assert(bad.some((m) => m.word === 'Vexilla'), 'invented names should be flagged (until added)')
    const withIgnore = checkProse(dict, text, new Set(['vexilla']))
    assert(!withIgnore.some((m) => m.word === 'Vexilla'), 'project dictionary must suppress flags')
    const sugg = dict.suggest('lighthose')
    assert(sugg.length > 0, 'suggestions should exist for a near-miss')
    return `masking + extraction + dictionary behave (e.g. lighthose → ${sugg[0]})`
  })
  await check('Logic', 'update check picks newer releases correctly', () => {
    assert(isNewerVersion('0.0.41', 'v0.0.42'), '0.0.42 should be newer than 0.0.41')
    assert(isNewerVersion('0.0.9', '0.0.10'), 'numeric compare, not string compare')
    assert(isNewerVersion('0.0.41', 'v0.1.0'), 'minor bump is newer')
    assert(!isNewerVersion('0.0.41', 'v0.0.41'), 'same version is not an update')
    assert(!isNewerVersion('0.1.0', 'v0.0.99'), 'older is not an update')
    const release = {
      tag_name: 'v0.0.42',
      body: 'notes here',
      assets: [
        { name: 'ChoiceScript IDE-0.0.42-x64.zip', browser_download_url: 'https://x/z.zip', size: 2 },
        { name: 'ChoiceScript IDE-0.0.42-portable.exe', browser_download_url: 'https://x/p.exe', size: 1 }
      ]
    }
    const info = pickUpdate('0.0.41', release)
    assert(!!info && info.version === '0.0.42', 'should pick the update')
    assert(info!.name.endsWith('portable.exe') && info!.url === 'https://x/p.exe', 'must pick the portable exe asset')
    assert(pickUpdate('0.0.42', release) === null, 'same version → no update')
    assert(pickUpdate('0.0.41', { tag_name: 'v0.0.42', assets: [] }) === null, 'no exe asset → no update')
    return 'version compare + portable-exe asset selection behave'
  })
  await check('Logic', 'convergent fan-in merges into a shared trunk', () => {
    // Three sources converge on one target: every clear route must share the
    // bus above the target and the single final drop (the visual merge).
    const tgt = { x: 300, y: 400 }
    const srcs = [
      { x: 100, y: 200 },
      { x: 300, y: 250 },
      { x: 520, y: 200 }
    ]
    const routes = routeTrunk(srcs, tgt, [[], [], []])
    assert(routes.every(Boolean), 'all clear sources should merge')
    for (const r of routes) {
      const pen = r![r!.length - 2]
      const last = r![r!.length - 1]
      assert(pen.x === tgt.x && last.x === tgt.x && last.y === tgt.y, 'routes must share the final drop at target x')
      assert(r![1].y === tgt.y - 18, 'bus must sit 18px above the target')
    }
    // A source whose descent is blocked stays unmerged; the rest still merge.
    const block = { x: 80, y: 250, w: 60, h: 100 }
    const partial = routeTrunk(srcs, tgt, [[block], [], []])
    assert(partial[0] === null && !!partial[1] && !!partial[2], 'blocked source must stay unmerged, others merge')
    // Fewer than two clear sources → nothing merges (no one-edge "trunk").
    const solo = routeTrunk([srcs[0], srcs[1]], tgt, [[block], []])
    assert(solo.every((r) => r === null), 'fewer than 2 clear sources must yield no merge')
    return 'fan-in shares trunk; blocked source falls back; <2 clear → no merge'
  })
  await check('Logic', 'cross-scene edge routing avoids plates', () => {
    // Packed layout: two shelves, an obstacle plate beside the target.
    const gap = 48
    const srcPlate = { x: 0, y: 0, w: 400, h: 300 }
    const obstacle = { x: 0, y: 348, w: 500, h: 300 } // next shelf, left
    const tgt = { x: 548, y: 348, w: 300, h: 200 } // next shelf, right
    const bounds = { x: 0, y: 0, w: 900, h: 700 }
    // Direct case: target on the very next shelf → single corridor crossing.
    const direct = routeCross({ x: 100, y: 250 }, srcPlate, tgt, 120, 698, { out: 0, in: 0 }, bounds, gap)
    assert(!pathHitsRect(direct, obstacle), 'direct route cuts through a plate')
    assert(direct[direct.length - 1].x === 698, 'route must end at the gateway x')
    // Highway case: target far below (two shelves down) with obstacles between.
    const midShelf = { x: 0, y: 348, w: 860, h: 300 } // full-width obstacle row
    const farTgt = { x: 300, y: 700, w: 300, h: 200 }
    const far = routeCross(
      { x: 100, y: 250 },
      srcPlate,
      farTgt,
      120,
      450,
      { out: 14, in: 8 },
      { x: 0, y: 0, w: 900, h: 950 },
      gap
    )
    assert(!pathHitsRect(far, midShelf), 'highway route cuts through the middle shelf')
    // The exterior portion (after leaving via the bottom strip) stays outside.
    assert(!pathHitsRect(far.slice(3), srcPlate), 'route re-enters its source plate')
    // Paths start AT the source node (pure right angles, no diagonal jogs).
    assert(far[0].x === 100 && far[0].y === 250, 'route must start at the source point')
    // Rounded path generation stays well-formed.
    const d = pointsToPath(far)
    assert(d.startsWith('M ') && d.includes('Q '), 'path missing rounded corners')
    // Adjacent-target interiors take the direct step (no channel pigtail).
    const near = routeInterior({ x: 0, y: 0 }, { x: 20, y: 26 }, -60, 0)
    assert(near.length === 4, `adjacent goto should route direct, got ${near.length} points`)
    const farInterior = routeInterior({ x: 0, y: 0 }, { x: 20, y: 300 }, -60, 0)
    assert(farInterior.length === 6, 'distant goto should route via the channel')
    return 'direct + highway + interior routes clear plates; pigtail-free'
  })
  await check('Logic', 'whole-game graph (stitching + cross-scene edges)', () => {
    // Real sample game: every scene present, namespaced, cross-scene wired.
    const gg = buildGameGraph(files, sceneList)
    assert(gg.scenes.length >= 6, `expected all sample scenes, got ${gg.scenes.length}`)
    for (const s of gg.scenes) {
      assert(gg.nodes.some((n) => n.kind === 'scenehead' && n.ownScene === s), `missing scenehead for ${s}`)
      assert(s in gg.asts, `missing ast for ${s}`)
    }
    // Namespacing: every non-head node id carries its scene prefix.
    assert(
      gg.nodes.every((n) => n.kind === 'scenehead' || n.id.startsWith(`${n.ownScene}::`)),
      'node ids not namespaced by scene'
    )
    // variables *goto_scene death → direct edge into death's entry, no stub.
    assert(
      !gg.nodes.some((n) => n.kind === 'stub' && n.scene === 'death'),
      'death stub should be replaced by a real edge'
    )
    const deathEntry = gg.nodes.find((n) => n.ownScene === 'death' && n.kind !== 'scenehead' && n.kind !== 'stub')
    assert(!!deathEntry, 'death scene has no entry node')
    assert(
      gg.edges.some((e) => e.kind === 'scene' && e.source.startsWith('variables::') && e.target === deathEntry!.id),
      'missing cross-scene edge variables -> death'
    )
    // Unknown-scene stubs (none here) + ending stubs survive.
    assert(gg.nodes.some((n) => n.kind === 'stub' && n.scene === null), 'ending stubs should remain')
    // Round-trip safety: the asts it returns regenerate the exact sources.
    for (const s of gg.scenes) {
      assert(generateScene(gg.asts[s]) === files[s].split(/\r?\n/).join('\n'), `game ast round-trip broke for ${s}`)
    }
    return `${gg.scenes.length} scenes, ${gg.nodes.length} nodes, ${gg.edges.length} edges stitched`
  })
  await check('Logic', 'AST ops: move / wrap-in-if / if-else / modifier', () => {
    // moveNode: reorder options within a choice + statements at top level.
    const src = ['*choice', '  #A', '    *goto done', '  #B', '    *goto done', '*label done', 'End.'].join('\n')
    const ast = parseScene(src)
    const choice = ast[0] as ChoiceNode
    const optB = choice.children.filter((c): c is OptionNode => c.type === 'option')[1]
    assert(moveNode(ast, optB, -1), 'moveNode option up failed')
    let out = generateScene(ast)
    assert(out.indexOf('#B') < out.indexOf('#A'), 'option order not swapped')
    assert(generateScene(parseScene(out)) === out, 'move not round-trip stable')
    assert(!moveNode(ast, optB, -1), 'move past top should fail')

    // wrapInIf: statement becomes the body of a fresh *if, re-indented.
    const ast2 = parseScene('Some prose here.\n*set gold 5')
    const setNode = ast2[1]
    assert(wrapInIf(ast2, setNode, '  '), 'wrapInIf failed')
    out = generateScene(ast2)
    assert(out === 'Some prose here.\n*if (condition)\n  *set gold 5', `wrap output wrong:\n${out}`)
    assert(generateScene(parseScene(out)) === out, 'wrap not round-trip stable')

    // makeNodes if_else pair at depth.
    const pair = makeNodes('if_else', '  ', '  ')
    assert(pair.length === 2 && pair[0].type === 'if' && pair[1].type === 'if', 'if_else pair malformed')
    out = generateScene(pair)
    assert(out.startsWith('  *if (condition)\n    Then this.\n  *else'), `if_else emit wrong:\n${out}`)

    // setOptionModifier: add, edit, clear — header stays consistent.
    const ast3 = parseScene('*choice\n  #Plain option\n    *goto x\n*label x')
    const opt = (ast3[0] as ChoiceNode).children[0] as OptionNode
    setOptionModifier(opt, '*selectable_if (gold > 3)')
    assert(opt.header === '  *selectable_if (gold > 3) #Plain option', `modifier add wrong: ${opt.header}`)
    out = generateScene(ast3)
    assert(generateScene(parseScene(out)) === out, 'modifier add not round-trip stable')
    setOptionModifier(opt, null)
    assert(opt.header === '  #Plain option' && opt.modifier === null, 'modifier clear wrong')
    return 'move, wrap, if/else pair, modifier add/clear all round-trip stable'
  })
  await check('Logic', 'goto edges + islands + drag-connect', () => {
    const src = [
      'Start here.',
      '*goto done',
      '*label island1',
      'A floating island, not yet connected.',
      '*label done',
      'The end.',
      '*finish'
    ].join('\n')
    const ast = parseScene(src)
    const g = buildChoiceGraph(ast)
    const content = g.nodes.filter((n) => n.kind === 'content')
    assert(content.length === 3, `labels should split content into 3 nodes, got ${content.length}`)
    const [a, island, done] = content
    // *goto draws a flow edge; the terminated/island boundaries draw no seq.
    assert(
      g.edges.some((e) => e.kind === 'goto' && e.source === a.id && e.target === done.id),
      'missing goto edge start->done'
    )
    assert(!g.edges.some((e) => e.kind === 'seq' && e.target === island.id), 'island must have no incoming seq edge')
    assert(
      g.edges.some((e) => e.kind === 'seq' && e.source === island.id && e.target === done.id),
      'island falls through to done (honest seq edge)'
    )

    // Drag-connect island -> done: appends *goto done (label reused), round-trip safe.
    assert(connectNodes(ast, island, done, '  '), 'connectNodes failed')
    const out = generateScene(ast)
    assert(generateScene(parseScene(out)) === out, 'connect not round-trip stable')
    const g2 = buildChoiceGraph(parseScene(out))
    const island2 = g2.nodes.filter((n) => n.kind === 'content')[1]
    const done2 = g2.nodes.filter((n) => n.kind === 'content')[2]
    assert(
      g2.edges.some((e) => e.kind === 'goto' && e.source === island2.id && e.target === done2.id),
      'no goto edge after connect'
    )
    assert(!g2.edges.some((e) => e.kind === 'seq' && e.source === island2.id), 'connected island should terminate (no seq)')

    // Connecting to an UNLABELLED node auto-creates a link label.
    const src2 = ['First bit.', '*goto part2', '*label part2', 'Second bit.', '*label island1', 'Island.'].join('\n')
    const ast2 = parseScene(src2)
    const g3 = buildChoiceGraph(ast2)
    const c3 = g3.nodes.filter((n) => n.kind === 'content')
    assert(connectNodes(ast2, c3[2], c3[0], '  '), 'connect to unlabelled failed')
    const out2 = generateScene(ast2)
    assert(out2.startsWith('*label link1\nFirst bit.'), `auto label misplaced:\n${out2.slice(0, 60)}`)
    assert(out2.includes('*goto link1'), 'goto to auto label missing')
    assert(generateScene(parseScene(out2)) === out2, 'auto-label connect not round-trip stable')
    return 'label-split, goto edges, island isolation, connect (reuse + auto-label) all good'
  })
  await check('Logic', 'editor line tints match node types', () => {
    const src = [
      'Some intro prose.', // 1: text — untinted
      '*set gold 5', // 2: command
      '*choice', // 3: choice
      '  *selectable_if (gold > 1) #Buy.', // 4: option (modifier)
      '    *if (gold > 3)', // 5: if
      '      Nice.', // 6: text
      '  #Leave.', // 7: option
      '    *goto done', // 8: command
      '*label done' // 9: command
    ].join('\n')
    const tints = lineTints(src)
    const at = (line: number): string | undefined => tints.find((t) => t.start <= line && line <= t.end)?.type
    assert(at(1) === undefined, 'prose should be untinted')
    assert(at(2) === 'command', `line 2: ${at(2)}`)
    assert(at(3) === 'choice', `line 3: ${at(3)}`)
    assert(at(4) === 'option', `line 4 (modifier option): ${at(4)}`)
    assert(at(5) === 'if', `line 5: ${at(5)}`)
    assert(at(6) === undefined, 'nested prose should be untinted')
    assert(at(7) === 'option', `line 7: ${at(7)}`)
    assert(at(8) === 'command' && at(9) === 'command', 'goto/label should tint as commands')
    return `${tints.length} tinted lines typed correctly (incl. modifier option)`
  })
  await check('Logic', 'node canvas SSR smoke (renders without crashing)', () => {
    // Server-render the real canvas component over every sample scene. This
    // catches render-time crashes (missing providers, bad hook usage, data
    // shape errors) that pure-logic checks cannot see.
    const noop = (): void => {}
    let total = 0
    for (const s in files) {
      const html = renderToString(
        createElement(AstCanvas, {
          scene: s,
          text: files[s],
          highlightLine: null,
          indentStyle: 'space' as const,
          indentWidth: 2,
          onEditScene: noop,
          onJump: noop,
          onHoverRange: noop,
          onIndentChange: noop,
          onNormalize: noop,
          onSwitchScene: noop,
          onPlayFrom: noop
        })
      )
      assert(html.includes('react-flow'), `canvas markup missing for ${s}`)
      total += html.length
    }
    // Whole-game mode renders the entire stitched graph in one canvas.
    const game = renderToString(
      createElement(AstCanvas, {
        scene: 'startup',
        text: files['startup'],
        files,
        sceneList,
        initialGameMode: true,
        highlightLine: null,
        indentStyle: 'space' as const,
        indentWidth: 2,
        onEditScene: noop,
        onJump: noop,
        onHoverRange: noop,
        onIndentChange: noop,
        onNormalize: noop,
        onSwitchScene: noop,
        onPlayFrom: noop
      })
    )
    // (React Flow doesn't emit node internals server-side; the value here is
    // that buildGameGraph + tile stitching EXECUTE during render — a crash in
    // either would throw out of renderToString.)
    assert(game.includes('react-flow'), 'game-mode canvas markup missing')
    return `${Object.keys(files).length} scenes + whole-game mode render (${Math.round(total / 1024)}KB markup)`
  })
  await check('Logic', 'lint: gauntlet rules (else / functions / parens / rand)', () => {
    const mk = (startup: string, scene: string) =>
      lintScene('s', scene, buildLintContext({ startup, s: scene }, ['startup', 's']))
    const codes = (ds: ReturnType<typeof lintScene>): Set<string> => new Set(ds.map((d) => d.code))
    const START = '*create x 1\n*create gold 5'

    // Falling into *else without a control transfer.
    const fall = mk(START, '*if (x > 1)\n  Some text.\n*else\n  Other text.')
    assert(codes(fall).has('fall-into-else'), 'fall-into-else not flagged')
    // Properly terminated branch: clean.
    const term = mk(START, '*if (x > 1)\n  *goto fine\n*else\n  Other text.\n*label fine')
    assert(!codes(term).has('fall-into-else'), 'terminated branch falsely flagged')
    // if/else guarding #options inside a *choice: clean.
    const guard = mk(START, '*choice\n  *if (x > 1)\n    #A\n      *finish\n  *else\n    #B\n      *finish')
    assert(!codes(guard).has('fall-into-else'), 'option-guarding else falsely flagged')
    // implicit_control_flow suppresses the rule.
    const icf = mk(START + '\n*create implicit_control_flow true', '*if (x > 1)\n  Some text.\n*else\n  Other.')
    assert(!codes(icf).has('fall-into-else'), 'implicit_control_flow not honored')

    // not/round/length used without parens.
    assert(codes(mk(START, '*if (not x)\n  hi')).has('fn-parens'), 'not-without-parens not flagged')
    assert(!codes(mk(START, '*if not(x)\n  hi')).has('fn-parens'), 'not(x) falsely flagged')

    // Multiple operators at one level need parentheses.
    assert(codes(mk(START, '*set gold x + gold + 2')).has('needs-parens'), 'multi-op not flagged')
    assert(!codes(mk(START, '*set gold ((x + gold) + 2)')).has('needs-parens'), 'grouped ops falsely flagged')
    assert(!codes(mk(START, '*if ((x > 1) and (gold > 2))\n  hi')).has('needs-parens'), 'valid grouped and falsely flagged')

    // *rand / *input_* target must be declared.
    assert(codes(mk(START, '*rand luck 1 100')).has('undeclared-var'), 'undeclared *rand target not flagged')
    assert(!codes(mk(START + '\n*create luck 0', '*rand luck 1 100')).has('undeclared-var'), 'declared *rand target falsely flagged')
    return 'fall-into-else, fn-parens, needs-parens, rand target all behave'
  })
  await check('Logic', 'option modifiers parse as options', () => {
    const src = [
      '*choice',
      '  *selectable_if (gold > 10) #Buy the lamp.',
      '    *set gold -10',
      '    *goto done',
      '  *hide_reuse *if (sneaky) #Steal it.',
      '    *goto done',
      '  #Walk away.',
      '    *goto done',
      '*label done'
    ].join('\n')
    const ast = parseScene(src)
    assert(generateScene(ast) === src, 'modifier-option round-trip broke')
    const choice = ast[0] as ChoiceNode
    assert(optionCount(choice) === 3, `expected 3 options, got ${optionCount(choice)}`)
    const opts = choice.children.filter((c): c is OptionNode => c.type === 'option')
    assert(opts[0].label === 'Buy the lamp.', `label wrong: ${opts[0].label}`)
    assert(opts[0].modifier === '*selectable_if (gold > 10) ', `modifier wrong: ${JSON.stringify(opts[0].modifier)}`)
    assert(opts[1].modifier === '*hide_reuse *if (sneaky) ', 'chained modifier wrong')
    assert(opts[2].modifier === null, 'plain option should have no modifier')
    // Label edit must preserve the modifier prefix + indentation.
    applyValue(opts[0], 'Purchase the lamp.')
    const out = generateScene(ast)
    assert(out.includes('  *selectable_if (gold > 10) #Purchase the lamp.'), 'label edit lost modifier')
    assert(generateScene(parseScene(out)) === out, 'edited modifier-option not round-trip stable')
    // A block *if (no # on the line) must still parse as an if node.
    const blockIf = parseScene('*if (x > 1)\n  Some text.')[0]
    assert(blockIf.type === 'if', 'block *if mistyped')
    return '3 options (2 modified, 1 plain) typed + label edit preserves modifier'
  })
  await check('Logic', 'AST structural ops (insert/remove/make)', () => {
    const src = ['First paragraph.', '*set gold 10', '*choice', '  #A', '    *goto done', '  #B', '    *goto done', '*label done'].join('\n')
    const ast = parseScene(src)
    // Insert a page_break after the *set, matching its indentation.
    const setNode = ast.find((n) => n.type === 'command' && n.name === 'set')!
    assert(insertAfter(ast, setNode, makeNode('page_break', nodeIndent(setNode), '  ')), 'insertAfter failed')
    let out = generateScene(ast)
    assert(out.includes('*set gold 10\n*page_break\n*choice'), `insert misplaced:\n${out}`)
    assert(generateScene(parseScene(out)) === out, 'insert not round-trip stable')
    // Remove an option nested inside the choice.
    const choice = ast.find((n) => n.type === 'choice') as ChoiceNode
    const optB = choice.children.filter((c): c is OptionNode => c.type === 'option')[1]
    assert(removeNode(ast, optB), 'removeNode failed to find nested option')
    out = generateScene(ast)
    assert(!out.includes('#B') && out.includes('#A'), 'remove took the wrong node')
    assert(optionCount(choice) === 1, 'option count after removal wrong')
    // makeNode choice spawns a valid 2-option block at the right indent.
    const nc = makeNode('fake_choice', '  ', '  ')
    assert(nc.type === 'choice' && nc.fake && optionCount(nc) === 2, 'makeNode choice malformed')
    const ncText = generateScene([nc])
    assert(ncText.startsWith('  *fake_choice\n    #Option 1'), `makeNode indent wrong:\n${ncText}`)
    return 'insertAfter/removeNode/makeNode all round-trip stable'
  })
  await check('Logic', 'choice-flow stubs + option word counts', () => {
    const src = [
      'Intro text here.',
      '*choice',
      '  #Go to the market.',
      '    A bustling market with many words of prose to count here.',
      '    *goto_scene market',
      '  #End it all.',
      '    *finish',
      ''
    ].join('\n')
    const g = buildChoiceGraph(parseScene(src))
    const stubs = g.nodes.filter((n) => n.kind === 'stub')
    assert(stubs.length === 2, `expected scene + ending stubs, got ${stubs.length}`)
    assert(stubs.some((s) => s.kind === 'stub' && s.scene === 'market'), 'market stub missing')
    assert(stubs.some((s) => s.kind === 'stub' && s.scene === null), 'ending stub missing')
    assert(g.edges.filter((e) => e.kind === 'scene').length === 2, 'stub edges missing')
    const optA = g.nodes.find((n) => n.kind === 'option' && n.label === 'Go to the market.')
    assert(!!optA && optA.kind === 'option' && optA.words >= 8, `option word count wrong: ${optA?.kind === 'option' ? optA.words : '?'}`)
    return 'scene + ending stubs wired; option subtree words counted'
  })
  await check('Logic', 'typed AST edit ops (count / field edits)', () => {
    // Choice count field: spawn + prune options, staying round-trip stable.
    const src = ['*fake_choice', '  #A', '    You picked A.', '  #B', '    You picked B.'].join('\n')
    const ast = parseScene(src)
    const choice = ast[0] as ChoiceNode
    assert(choice.type === 'choice' && choice.fake, 'expected fake choice')
    assert(optionCount(choice) === 2, 'start with 2 options')

    setChoiceCount(choice, 4)
    assert(optionCount(choice) === 4, 'grew to 4 options')
    const t4 = generateScene(ast)
    assert(generateScene(parseScene(t4)) === t4, 'count-up not round-trip stable')
    assert(t4.includes('#A') && t4.includes('You picked A.'), 'existing options preserved on grow')
    assert(optionCount(parseScene(t4)[0] as ChoiceNode) === 4, 'reparse sees 4 options')

    setChoiceCount(choice, 1)
    assert(optionCount(choice) === 1, 'pruned to 1 option')
    assert((choice.children[0] as OptionNode).label === 'A', 'kept the first option when pruning')

    // Inline field edit: option label.
    const opt = choice.children.find((c) => c.type === 'option') as OptionNode
    applyValue(opt, 'Renamed Option')
    assert(opt.label === 'Renamed Option', 'option label set')
    const t5 = generateScene(ast)
    assert(t5.includes('#Renamed Option'), 'renamed option in output')
    assert(generateScene(parseScene(t5)) === t5, 'label edit not round-trip stable')

    // Inline field edit: command arg, indent preserved.
    const cmd = parseScene('  *label intro')[0] as CommandNode
    applyValue(cmd, 'outro')
    assert(cmd.raw === '  *label outro', `label indent/arg edit wrong: ${JSON.stringify(cmd.raw)}`)

    // Inline field edit: *if condition.
    const iff = parseScene('*if (x > 1)\n  hi')[0] as IfNode
    applyValue(iff, '(y = 2)')
    assert(iff.header === '*if (y = 2)', `if condition edit wrong: ${JSON.stringify(iff.header)}`)

    // Type labels for the canvas headers.
    assert(nodeTypeLabel(choice) === 'Fake Choice', 'fake choice label')
    assert(nodeTypeLabel(cmd) === 'Label', 'command label cap')
    return 'count spawn/prune, label/arg/condition edits all round-trip stable'
  })
  await check('Logic', 'go-to-definition resolution', () => {
    const label = resolveDefinition(files, 'animal', '    *goto claws', 'claws')
    assert(label?.scene === 'animal' && files['animal'].split('\n')[label.line].includes('*label claws'), `label resolve wrong: ${JSON.stringify(label)}`)
    const scene = resolveDefinition(files, 'variables', '    *goto_scene death', 'death')
    assert(scene?.scene === 'death' && scene.line === 0, `scene resolve wrong: ${JSON.stringify(scene)}`)
    const v = resolveDefinition(files, 'variables', '*set leadership 10', 'leadership')
    assert(v?.scene === 'startup', `var resolve wrong: ${JSON.stringify(v)}`)
    return 'label + scene + variable resolved'
  })
  await check('Logic', 'project search + rename + symbol kind', () => {
    const hits = searchProject(files, 'leadership')
    assert(hits.length >= 2, `expected leadership in multiple scenes, got ${hits.length}`)
    const changed = renameVariable({ startup: '*create leadership 50', variables: '*set leadership 10\nleadershipful' }, 'leadership', 'charisma')
    assert(changed['startup'] === '*create charisma 50', 'startup not renamed')
    assert(changed['variables'].includes('*set charisma 10') && changed['variables'].includes('leadershipful'), 'whole-word rename failed')
    assert(detectSymbol('*goto claws', 'claws') === 'label', 'label kind')
    assert(detectSymbol('*set gold 5', 'gold') === 'variable', 'var kind')
    assert(detectSymbol('*goto_scene death', 'death') === 'scene', 'scene kind')
    return 'search + whole-word rename + kinds'
  })
  await check('Logic', 'word count', () => {
    const n = countWords('*comment ignore me\nHello there brave world\n*set a 1\n#Pick this one')
    assert(n === 7, `expected 7 words (4 prose + 3 option), got ${n}`)
    return `${n} words counted`
  })
  await check('Logic', 'RandomTest result parsing', () => {
    const pass = parseRandomResults(['*****Seed 0', 'startup 0: *comment x', 'RANDOMTEST PASSED'], 100)
    assert(pass.passed && pass.uncovered === 1, `pass case wrong: ${JSON.stringify(pass)}`)
    const fail = parseRandomResults(
      ['*****Seed 3', 'RANDOMTEST FAILED: animal line 12: bad label nowhere'],
      100
    )
    assert(!fail.passed, 'fail case should not pass')
    assert(
      fail.errors.length === 1 && fail.errors[0].scene === 'animal' && fail.errors[0].line === 11,
      `fail parse wrong: ${JSON.stringify(fail.errors)}`
    )
    return 'pass + fail cases parsed'
  })
  await check('Logic', 'new-project template is valid', () => {
    const list = getSceneList(STARTUP_TEMPLATE)
    assert(list.includes('startup'), 'template scene_list missing startup')
    const seeds = enumerateStats(STARTUP_TEMPLATE)
    assert(
      seeds.some((s) => s.name === 'strength') && seeds.some((s) => s.name === 'leadership'),
      'template stats missing'
    )
    const ctx2 = buildLintContext({ startup: STARTUP_TEMPLATE }, list)
    const errs = lintScene('startup', STARTUP_TEMPLATE, ctx2).filter((d) => d.severity === 'error')
    assert(errs.length === 0, `template has lint errors: ${errs.map((e) => e.message).join('; ')}`)
    return 'valid template, no lint errors'
  })
  await check('Logic', 'nested choice-tree parsing', () => {
    // animal: one *choice, 3 options with distinct terminators.
    const t = parseChoiceTree(files['animal'] ?? '')
    assert(t.length === 1 && t[0].options.length === 3, `expected 1 choice / 3 options, got ${t.length}/${t[0]?.options.length}`)
    const byLabel = Object.fromEntries(t[0].options.map((o) => [o.label, o.terminator]))
    assert(byLabel['Lion'] === 'goto', `Lion should be goto, got ${byLabel['Lion']}`)
    assert(byLabel['Tiger'] === 'finish', `Tiger should be finish, got ${byLabel['Tiger']}`)
    assert(byLabel['Elephant'] === 'finish', `Elephant should be finish, got ${byLabel['Elephant']}`)
    // A hand-built nested + fall-through case.
    const nested = ['*choice', '  #Outer', '    *choice', '      #Inner', '        text-no-terminator', '  #Done', '    *finish'].join('\n')
    const nt = parseChoiceTree(nested)
    const outer = nt[0].options.find((o) => o.label === 'Outer')!
    assert(outer.terminator === 'nested', `Outer should be nested, got ${outer.terminator}`)
    assert(outer.children.length === 1, 'Outer should contain a nested choice')
    assert(outer.children[0].options[0].terminator === 'fallthrough', 'Inner option should fall through')
    return 'terminators + nesting detected'
  })
  await check('Logic', 'insert scene into *scene_list', () => {
    const out = insertIntoSceneList(files['startup'] ?? '', 'newchapter')
    const list = getSceneList(out)
    assert(list.includes('newchapter'), 'newchapter not added to scene_list')
    assert(list.indexOf('newchapter') > list.indexOf('death'), 'should be appended after existing entries')
    // idempotent
    const again = insertIntoSceneList(out, 'newchapter')
    assert(again === out, 'inserting an existing scene should be a no-op')
    return `scene_list now ${list.length} scenes`
  })
  await check('Logic', 'export to self-contained HTML', async () => {
    const html = await buildStandaloneHtml(ENGINE, {
      mygameJs: generateMygameJs(files['startup'] ?? '', files),
      scenes: files,
      title: 'Test Game',
      author: 'Tester'
    })
    assert(html.includes('<title>Test Game</title>'), 'title not inlined')
    assert(html.includes('window.__scenes'), 'scenes not inlined')
    assert(html.includes('Welcome to your very first ChoiceScript game'), 'startup text not inlined')
    assert(html.includes('SceneNavigator'), 'engine not inlined')
    assert(html.length > 200000, `expected a large self-contained file, got ${html.length} bytes`)
    return `${Math.round(html.length / 1024)} KB self-contained HTML`
  })
  await check('Logic', 'save store round-trip', async () => {
    const root = join(tmpdir(), `cside-diag-${Date.now()}`)
    const mk = (id: string, t: string): SavePoint => ({
      id, name: id, scene: 'startup', lineNum: 1, createdAt: t, auto: false, state: '{}'
    })
    await writeSave(root, mk('s1', '2026-01-01T00:00:00Z'))
    await writeSave(root, mk('s2', '2026-01-02T00:00:00Z'))
    let l = await listSaves(root)
    assert(l.length === 2 && l[0].id === 's2', 'list/sort failed')
    await deleteSave(root, 's2')
    l = await listSaves(root)
    assert(l.length === 1, 'delete failed')
    await fsp.rm(root, { recursive: true, force: true })
    return 'write/list/sort/delete ok'
  })

  // --- Engine (in Node, clean prototype) -----------------------------------
  const ctx = vm.createContext({ console, setTimeout, clearTimeout })
  function loadInto(f: string): void {
    vm.runInContext(readFileSync(join(ENGINE, f), 'utf8'), ctx, { filename: f })
  }
  loadInto('scene.js')
  loadInto('navigator.js')
  loadInto('util.js')
  loadInto('headless.js')

  // Rendering/platform stubs the sample engine paths need (page_break ->
  // printButton, choice -> printOptions, goto_scene -> verifySceneFile).
  vm.runInContext(
    `
      var __noop = function(){};
      main = {}; // engine passes the global #main element to printButton
      printButton = __noop; printOptions = __noop; printInput = __noop;
      printImage = __noop; printLink = __noop; printFooter = __noop;
      printShareLinks = __noop; showPassword = __noop; achieve = __noop;
      printDiscount = __noop; changeTitle = __noop; startLoading = __noop;
      if (typeof doneLoading === 'undefined') doneLoading = __noop;
      if (typeof clearScreen === 'undefined') clearScreen = function(cb){ if(cb) cb.call(); };
      Scene.prototype.verifySceneFile = __noop;
      Scene.prototype.verifyImage = __noop;
      Scene.prototype.feedback = __noop;
    `,
    ctx,
    { filename: 'diag-stubs' }
  )

  ctx.__files = files
  ctx.__sceneList = sceneList
  ctx.__mygameJs = generateMygameJs(files['startup'] ?? '', files)

  await check('Engine', 'boot sample startup + save/restore round-trip', () => {
    const setup = `
      (0, eval)(__mygameJs); // sets nav, stats (with starting stats) like the real app
      Scene.prototype.loadScene = function () {
        this.loadLines(__files[this.name] || '');
        this.loaded = true;
        if (this.executing) this.execute();
      };
      __err = '';
      var scene = new Scene('startup', stats, nav, {});
      try { scene.execute(); } catch (e) { __err = 'boot: ' + e.message; }
      var snap = computeCookie(scene.stats, scene.temps, scene.lineNum, scene.indent);
      var parsed = jsonParse(snap);
      __snapScene = parsed.stats.sceneName;
      __snapLine = parsed.lineNum;
      try { restoreGame(jsonParse(snap)); } catch (e) { __err = (__err||'') + ' restore: ' + e.message; }
      __restoredScene = (typeof stats !== 'undefined' && stats.sceneName);
    `
    ctx.__err = ''
    vm.runInContext(setup, ctx, { filename: 'diag-saverestore' })
    assert(!ctx.__err, `engine error: ${ctx.__err}`)
    assert(ctx.__snapScene === 'startup', `snapshot scene = ${ctx.__snapScene}`)
    assert(typeof ctx.__snapLine === 'number', 'snapshot lineNum not numeric')
    assert(ctx.__restoredScene === 'startup', `restored scene = ${ctx.__restoredScene}`)
    return `snapshot at startup:${ctx.__snapLine}, restored cleanly`
  })

  await check('Engine', 'isolated scene preview with seeded stats', () => {
    const seeds = enumerateStats(files['startup'] ?? '')
    const lead = seeds.find((s) => s.name === 'leadership')
    assert(!!lead, 'sample should declare leadership via *create')
    lead!.value = '99'
    // 'animal' shows a choice but never *sets leadership, so the seed survives.
    const run = buildIsolatedRun('animal', seeds)
    ctx.__isoState = run.state
    ctx.__isoScene = run.forcedScene
    ctx.__isoStats = run.forcedStats
    ctx.__isoErr = ''
    vm.runInContext(
      `
        try { restoreGame(jsonParse(__isoState), __isoScene, false, __isoStats); }
        catch (e) { __isoErr = e.message; }
        __isoCurScene = (typeof stats !== 'undefined') && stats.sceneName;
        __isoLeadership = (typeof stats !== 'undefined') && stats.leadership;
      `,
      ctx,
      { filename: 'diag-isolate' }
    )
    assert(!ctx.__isoErr, `isolate error: ${ctx.__isoErr}`)
    assert(ctx.__isoCurScene === 'animal', `launched scene = ${ctx.__isoCurScene}`)
    assert(ctx.__isoLeadership === 99, `seeded leadership = ${ctx.__isoLeadership}`)
    return `launched 'animal' at line 0 with seeded leadership=99 preserved`
  })

  // --- Engine (with autotester) --------------------------------------------
  loadInto('embeddable-autotester.js')
  await check('Engine', 'autotester passes on the sample project', () => {
    ctx.__autotestErr = ''
    const code = `
      (0, eval)(__mygameJs); // rebuild nav + starting stats
      __autotestErr = '';
      for (var i = 0; i < __sceneList.length; i++) {
        var s = __sceneList[i];
        try { autotester(__files[s], nav, s); }
        catch (e) { __autotestErr += s + ': ' + e.message + '\\n'; }
      }
    `
    vm.runInContext(code, ctx, { filename: 'diag-autotest' })
    assert(!ctx.__autotestErr, `autotester errors:\n${ctx.__autotestErr}`)
    return 'all sample scenes pass'
  })
  await check('Engine', 'autotester reports unreached lines (coverage)', () => {
    // A label no *goto ever targets → its lines must land in `uncovered`.
    const dead = ['Reachable text.', '*finish', '*label orphan', 'Nobody comes here.', '*finish'].join('\n')
    ctx.__dead = dead
    ctx.__cov = null
    vm.runInContext(
      `var r = autotester(__dead, new SceneNavigator(['startup']), 'startup'); __cov = r && r[1];`,
      ctx,
      { filename: 'diag-coverage' }
    )
    const uncovered = ctx.__cov as unknown[]
    assert(Array.isArray(uncovered) && uncovered.length > 0, 'no uncovered ranges reported')
    const flat = uncovered.map(String).join(',')
    assert(/3|4/.test(flat), `orphan label lines not in uncovered ranges: ${flat}`)
    return `uncovered ranges: ${flat}`
  })
  await check('Engine', 'autotester catches fall-out-of-choice', () => {
    const bad = ['*choice', '  #A', '    text', '  #B', '    *finish'].join('\n')
    ctx.__bad = bad
    ctx.__thrown = ''
    vm.runInContext(
      `try { autotester(__bad, new SceneNavigator(['startup']), 'startup'); } catch(e){ __thrown = e.message; }`,
      ctx,
      { filename: 'diag-fallout' }
    )
    assert(/illegal to fall out of a \*choice/i.test(ctx.__thrown), `did not catch; got: ${ctx.__thrown}`)
    return ctx.__thrown
  })

  // --- Report --------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  const lines: string[] = []
  lines.push('# ChoiceScript IDE — Diagnostic Report')
  lines.push('')
  lines.push(`Generated by \`npm run diag\` (headless Node harness).`)
  lines.push('')
  lines.push(`**${passed}/${results.length} checks passed.** ${failed ? `❌ ${failed} failed.` : '✅ All green.'}`)
  lines.push('')
  let section = ''
  for (const r of results) {
    if (r.section !== section) {
      section = r.section
      lines.push(`## ${section}`)
      lines.push('')
    }
    lines.push(`- ${r.pass ? '✅' : '❌'} **${r.name}** — ${r.detail}`)
  }
  lines.push('')
  const report = lines.join('\n')
  await fsp.writeFile(join(ROOT, 'diag-report.md'), report, 'utf8')

  console.log(report)
  console.log(`\nWrote diag-report.md`)
  process.exitCode = failed ? 1 : 0
}

main()
