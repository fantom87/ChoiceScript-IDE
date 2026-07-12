import { buildLintContext, lintScene } from '../src/renderer/src/choicescript/lint'
import { nearest } from '../src/renderer/src/choicescript/nearest'

const startup = '*create health 100\n*scene_list\n  startup\n  animal\n'
const broken = [
  '*create health 100',
  '',
  'You see a door.',
  '*choice',
  '  #Open it.',
  '    *set healht 50',
  '    *gotoo done',
  '    *goto missing_label',
  '  #Leave.',
  '    *goto_scene nowhere',
  '    *finish',
  '',
  'A ${undefinedvar} appears.',
  '*label done',
  '*finish'
].join('\n')

const ctx = buildLintContext({ startup, animal: broken }, ['startup', 'animal'])
const diags = lintScene('animal', broken, ctx)

for (const d of diags) {
  console.log(`${d.severity.toUpperCase()} L${d.line + 1}:${d.startCol} [${d.code}] ${d.message}`)
}
console.log('TOTAL', diags.length)

// Assertions
const codes = diags.map((d) => d.code).sort()
const expect = ['initial-only', 'missing-label', 'missing-scene', 'undeclared-var', 'undeclared-var', 'unknown-command'].sort()
const ok = JSON.stringify(codes) === JSON.stringify(expect)
console.log(ok ? 'PASS: expected diagnostics found' : `FAIL: got ${JSON.stringify(codes)}`)

// A clean scene should produce zero diagnostics.
const clean = '*create hp 5\n\nHello ${hp}.\n*goto done\n*label done\n*finish'
const cleanDiags = lintScene('startup', clean, buildLintContext({ startup: clean }, ['startup']))
console.log(cleanDiags.length === 0 ? 'PASS: clean scene has no diagnostics' : `FAIL: clean had ${cleanDiags.length}`)

// nearest-suggestion checks
const near1 = nearest(['goto', 'gosub', 'goto_scene', 'finish'], 'gotoo')
const near2 = nearest(['goto', 'gosub'], 'xyzzyplugh')
console.log(`nearest('gotoo') = ${near1}  nearest('xyzzyplugh') = ${near2}`)
console.log(near1 === 'goto' && near2 === null ? 'PASS: nearest suggestions sane' : 'FAIL: nearest')
