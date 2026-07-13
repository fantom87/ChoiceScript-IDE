/*
 * ChoiceScript IDE — deep analysis worker.
 * Runs the engine's `autotester` over every scene (in-memory) to catch
 * execution-time errors the fast linter can't (e.g. falling out of a *choice),
 * plus coverage. Served from app://app so it can importScripts the engine at
 * app://engine cross-origin (CORS allowed by the app:// protocol handler).
 */

let loaded = false

function parseMsg(str) {
  const m = /^(\w+) line (\d+): ([\s\S]*)$/.exec(String(str))
  if (m) return { scene: m[1], line: parseInt(m[2], 10) - 1, message: m[3] }
  return { scene: null, line: 0, message: String(str) }
}

function setupStubs() {
  // Rendering / platform stubs (adapted from quicktest.html for a worker).
  self.doneLoading = function () {}
  self.changeTitle = function () {}
  self.printFooter = function () {}
  self.printShareLinks = function () {}
  self.printLink = function () {}
  self.printButton = function () {}
  self.printImage = function () {}
  self.printParagraph = function () {}
  self.println = function () {}
  self.print = function () {}
  self.showPassword = function () {}
  self.achieve = function () {}
  self.loginForm = function () {}
  self.isRegistered = function () { return false }
  self.isRegisterAllowed = function () { return false }
  self.isRestorePurchasesSupported = function () { return false }
  self.isFullScreenAdvertisingSupported = function () { return false }
  self.isAdvertisingSupported = function () { return false }
  self.isPrerelease = function () { return false }
  self.areSaveSlotsSupported = function () { return false }
  self.printDiscount = function () {}
  self.showFullScreenAdvertisementButton = function (m, cb) { cb() }
  self.safeCall = function (obj, fn) { return obj ? fn.call(obj) : fn.call() }
  self.initStore = function () { return false }
  self.clearScreen = function (code) { code.call() }
  self.saveCookie = function (cb) { if (cb) cb.call() }

  Scene.prototype.verifySceneFile = function () {}
  Scene.prototype.verifyImage = function () {}
  Scene.prototype.feedback = function () {}
  Scene.prototype.warning = function (message) {
    self.__warnings.push(this.lineMsg() + message)
  }
  Scene.prototype.testFinish = function () {
    let next
    for (let i = 0; i < self.sceneList.length; i++) {
      if (self.sceneList[i] === this.name) { next = self.sceneList[i + 1]; break }
    }
    if (!next && !/^choicescript_/.test(this.name)) {
      self.__warnings.push(this.lineMsg() + 'there is no next scene; *finish will end the game. Use *ending instead.')
    }
  }
}

function orderScenes(files, sceneList) {
  const seen = new Set()
  const order = []
  const push = (n) => { if (files[n] !== undefined && !seen.has(n)) { seen.add(n); order.push(n) } }
  push('startup')
  for (const s of sceneList) push(s)
  for (const n of Object.keys(files)) push(n)
  return order
}

function collectGotoSceneLabels(files) {
  const map = {}
  for (const scene of Object.keys(files)) {
    const lines = files[scene].split(/\r?\n/)
    for (let j = 0; j < lines.length; j++) {
      const r = /^\s*\*(?:goto_scene|gosub_scene)\s+(\S+)\s+(\S+)/.exec(lines[j])
      if (r && !/[[{]/.test(r[1]) && !/[[{]/.test(r[2])) {
        if (!map[r[1]]) map[r[1]] = []
        map[r[1]].push({ origin: scene, originLine: j, label: r[2] })
      }
    }
  }
  return map
}

function run(files, sceneList) {
  self.nav = new SceneNavigator(['startup'])
  self.nav.setStartingStatsClone({})
  self.stats = {}
  self.sceneList = sceneList || []
  const gotoSceneLabels = collectGotoSceneLabels(files)
  const diagnostics = []
  const order = orderScenes(files, self.sceneList)

  for (const scene of order) {
    self.__warnings = []
    try {
      const result = autotester(files[scene], self.nav, scene, gotoSceneLabels[scene])
      const uncovered = result && result[1]
      if (uncovered && uncovered.length) {
        for (const range of uncovered) {
          const parts = String(range).split(/[-,\s]+/)
          const line = parseInt(parts[0], 10) || 1
          const endLine = parseInt(parts[1], 10) || line
          diagnostics.push({
            scene,
            line: line - 1,
            endLine: endLine - 1,
            startCol: 1,
            endCol: 1,
            severity: 'info',
            message: `Never reached during testing (lines ${range})`,
            code: 'untested',
            deferred: true
          })
        }
      }
    } catch (e) {
      const p = parseMsg((e && e.message) || e)
      diagnostics.push({
        scene: p.scene || scene,
        line: p.line,
        startCol: 1,
        endCol: 1,
        severity: 'error',
        message: p.message,
        code: 'engine',
        deferred: true
      })
    }
    for (const w of self.__warnings) {
      const p = parseMsg(w)
      diagnostics.push({
        scene: p.scene || scene,
        line: p.line,
        startCol: 1,
        endCol: 1,
        severity: 'warning',
        message: p.message,
        code: 'engine-warning',
        deferred: true
      })
    }
  }

  postMessage({ type: 'RESULT', diagnostics })
}

self.onmessage = function (e) {
  const msg = e.data
  if (!msg || msg.type !== 'RUN') return
  if (!loaded) {
    const base = msg.engineBase
    importScripts(
      base + '/util.js',
      base + '/scene.js',
      base + '/navigator.js',
      base + '/embeddable-autotester.js'
    )
    setupStubs()
    loaded = true
  }
  try {
    run(msg.files, msg.sceneList)
  } catch (e) {
    postMessage({ type: 'RESULT', diagnostics: [], error: String((e && e.message) || e) })
  }
}
