/* Node harness: verify the engine's autotester catches execution-time errors. */
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const eng = path.join(__dirname, '..', 'resources', 'engine')
function load(f) {
  vm.runInThisContext(fs.readFileSync(path.join(eng, f), 'utf8'), f)
}

// Order mirrors autotest.js.
load('scene.js')
load('navigator.js')
load('util.js')
load('headless.js') // provides print/platform stubs + slurp helpers
load('embeddable-autotester.js')

globalThis.nav = new SceneNavigator(['startup'])
nav.setStartingStatsClone({})
globalThis.stats = {}

function tryScene(label, text) {
  try {
    const result = autotester(text, nav, 'startup')
    console.log(`${label}: OK (no error), uncovered=${JSON.stringify(result[1] || [])}`)
    return null
  } catch (e) {
    console.log(`${label}: THREW -> ${e.message}`)
    return e.message
  }
}

// 1) Option falls out of *choice with no *goto/*finish -> should throw.
const fallOut = ['*choice', '  #Option A', '    You picked A.', '  #Option B', '    *finish'].join('\n')
const err = tryScene('fall-out-of-choice', fallOut)

// 2) A valid scene -> should NOT throw.
const valid = ['*choice', '  #Option A', '    You picked A.', '    *finish', '  #Option B', '    *finish'].join('\n')
tryScene('valid-choice', valid)

// 3) Bad label -> should throw.
tryScene('bad-goto', ['*goto nowhere'].join('\n'))

const pass = err && /illegal to fall out of a \*choice/i.test(err)
console.log(pass ? 'PASS: autotester catches fall-out-of-choice' : 'FAIL')
