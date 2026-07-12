/* Spike: drive the engine's randomtest.js exactly as a Web Worker would, but in
 * Node, to validate the integration contract before wiring the UI. */
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const ENGINE = path.join(__dirname, '..', 'resources', 'engine')
const SAMPLE = path.join(__dirname, '..', 'resources', 'sample-game', 'scenes')
// randomtest.js replaces global console in worker mode; keep a real one.
const realLog = console.log.bind(console)

function loadEngine(f) {
  vm.runInThisContext(fs.readFileSync(path.join(ENGINE, f), 'utf8'), f)
}

// Fake worker environment.
global.importScripts = function () {
  for (const u of arguments) {
    const f = String(u).replace(/^.*\//, '')
    loadEngine(f)
  }
}
const messages = []
global.postMessage = function (m) {
  messages.push(m)
}
global.XMLHttpRequest = function () {
  this.open = function () {}
  this.send = function () {
    throw new Error('XHR should not be called (scenes are in-memory)')
  }
}

// Pre-load engine so randomtest.js sees Scene defined and skips its own imports.
loadEngine('scene.js')
loadEngine('navigator.js')
loadEngine('util.js')
loadEngine('seedrandom.js')

// Sample game nav/stats (what a generated mygame.js would set).
const sceneList = ['startup', 'animal', 'variables', 'gosub', 'ending', 'death']
global.nav = new SceneNavigator(sceneList)
global.stats = { leadership: 50, strength: 50 }
nav.setStartingStatsClone(stats)

// Load randomtest.js — defines the worker onmessage handler.
loadEngine('randomtest.js')

// Make file reads resolve from the in-memory scene map (used by the coverage
// report), instead of XHR.
global.slurpFile = function (url) {
  if (global.slurps && Object.prototype.hasOwnProperty.call(global.slurps, url)) {
    return global.slurps[url]
  }
  throw new Error('Missing scene: ' + url)
}

// Build sceneContent map (name.txt -> text).
const sceneContent = {}
for (const n of fs.readdirSync(SAMPLE)) {
  if (n.endsWith('.txt')) sceneContent[n] = fs.readFileSync(path.join(SAMPLE, n), 'utf8')
}

// Invoke the handler as the worker would.
const savedExit = process.exit
process.exit = function (code) {
  messages.push({ msg: '__PROCESS_EXIT__ ' + code })
}
try {
  onmessage({
    data: {
      iterations: 40,
      randomSeed: 0,
      showCoverage: true,
      showText: false,
      showChoices: false,
      highlightGenderPronouns: false,
      avoidUsedOptions: true,
      recordBalance: true,
      sceneContent
    }
  })
} catch (e) {
  console.log('THREW: ' + e.message)
} finally {
  process.exit = savedExit
}

const text = messages.map((m) => (m && m.msg != null ? m.msg : JSON.stringify(m))).join('\n')
const failed = /RANDOMTEST FAILED|__PROCESS_EXIT__ 1|THREW/.test(text)
const passed = /RANDOMTEST PASSED/.test(text)
realLog(`messages: ${messages.length}, passed=${passed}, failed=${failed}`)
if (failed || !passed) {
  realLog('--- last 25 messages ---')
  realLog(messages.slice(-25).map((m) => (m && m.msg != null ? m.msg : JSON.stringify(m))).join('\n'))
}
realLog(passed && !failed ? 'SPIKE PASS' : 'SPIKE FAIL')
