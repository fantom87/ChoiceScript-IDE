/*
 * Headless validator for any ChoiceScript game folder:
 *   npm run check:game -- "C:\path\to\game"
 * Runs, per scene: AST round-trip, the IDE lint (errors fail, warnings
 * listed), the REAL engine's autotester (branch-walking execution errors),
 * plus prose word counts. Exits non-zero on any failure.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as vm from 'node:vm'

import { lintScene, buildLintContext } from '../src/renderer/src/choicescript/lint'
import { generateMygameJs, getSceneList } from '../src/renderer/src/choicescript/mygameGen'
import { parseScene, generateScene } from '../src/renderer/src/choicescript/ast'
import { countWords } from '../src/renderer/src/choicescript/wordCount'

const ROOT = process.cwd()
const ENGINE = join(ROOT, 'resources', 'engine')

const target = process.argv[2]
if (!target) {
  console.error('usage: npm run check:game -- <game folder (containing scenes/ or startup.txt)>')
  process.exit(2)
}
const scenesDir = existsSync(join(target, 'scenes', 'startup.txt'))
  ? join(target, 'scenes')
  : target
if (!existsSync(join(scenesDir, 'startup.txt'))) {
  console.error(`no startup.txt under ${target}`)
  process.exit(2)
}

const files: Record<string, string> = {}
for (const n of readdirSync(scenesDir)) {
  if (n.endsWith('.txt')) files[n.replace(/\.txt$/, '')] = readFileSync(join(scenesDir, n), 'utf8')
}
const sceneList = getSceneList(files['startup'] ?? '')
let failures = 0

// --- 1. AST round-trip ------------------------------------------------------
for (const s in files) {
  const norm = files[s].split(/\r?\n/).join('\n')
  if (generateScene(parseScene(files[s])) !== norm) {
    console.error(`ROUND-TRIP: ${s} does not survive parse->generate`)
    failures++
  }
}
console.log(`round-trip: ${Object.keys(files).length} scenes checked`)

// --- 2. Lint ------------------------------------------------------------------
const lintCtx = buildLintContext(files, sceneList)
let lintErrors = 0
let lintWarnings = 0
for (const s in files) {
  for (const d of lintScene(s, files[s], lintCtx)) {
    const line = `${s}.txt:${d.line + 1} [${d.code}] ${d.message}`
    if (d.severity === 'error') {
      console.error(`LINT ERROR: ${line}`)
      lintErrors++
      failures++
    } else {
      console.warn(`lint warn: ${line}`)
      lintWarnings++
    }
  }
}
console.log(`lint: ${lintErrors} errors, ${lintWarnings} warnings`)

// --- 3. Engine autotester ----------------------------------------------------
const ctx = vm.createContext({ console, setTimeout, clearTimeout })
const loadInto = (f: string): void => {
  vm.runInContext(readFileSync(join(ENGINE, f), 'utf8'), ctx, { filename: f })
}
loadInto('scene.js')
loadInto('navigator.js')
loadInto('util.js')
loadInto('headless.js')
vm.runInContext(
  `
    var __noop = function(){};
    main = {};
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
  { filename: 'check-stubs' }
)
loadInto('embeddable-autotester.js')
;(ctx as Record<string, unknown>).__files = files
;(ctx as Record<string, unknown>).__sceneList = sceneList
;(ctx as Record<string, unknown>).__mygameJs = generateMygameJs(files['startup'] ?? '', files)
;(ctx as Record<string, unknown>).__autotestErr = ''
vm.runInContext(
  `
    (0, eval)(__mygameJs);
    __autotestErr = '';
    for (var i = 0; i < __sceneList.length; i++) {
      var s = __sceneList[i];
      try { autotester(__files[s], nav, s); }
      catch (e) { __autotestErr += s + ': ' + e.message + '\\n'; }
    }
  `,
  ctx,
  { filename: 'check-autotest' }
)
const autoErr = (ctx as Record<string, unknown>).__autotestErr as string
if (autoErr) {
  for (const line of autoErr.trim().split('\n')) console.error(`AUTOTESTER: ${line}`)
  failures += autoErr.trim().split('\n').length
} else {
  console.log(`autotester: ${sceneList.length} scenes pass`)
}

// --- 4. Word counts ----------------------------------------------------------
let total = 0
const rows: [string, number][] = []
for (const s of sceneList) {
  if (s === 'choicescript_stats' || !files[s]) continue
  const w = countWords(files[s])
  rows.push([s, w])
  total += w
}
rows.forEach(([s, w]) => console.log(`  ${s.padEnd(20)} ${String(w).padStart(6)} words`))
console.log(`TOTAL: ${total} prose words across ${rows.length} scenes`)

if (failures) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nall checks pass')
