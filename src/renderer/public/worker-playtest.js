/*
 * Playtest Lab worker: loads the engine + playtest-core and runs seeded
 * automated playthroughs off the UI thread, streaming progress.
 */

let loaded = false

function setupStubs() {
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
  self.printx = function () {}
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
  self.printInput = function () {}
  Scene.prototype.verifySceneFile = function () {}
  Scene.prototype.verifyImage = function () {}
  Scene.prototype.feedback = function () {}
  Scene.prototype.subscribe = function () {}
  Scene.prototype.save = function () {}
  Scene.prototype.stat_chart = function () { this.parseStatChart() }
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
      base + '/seedrandom.js',
      'playtest-core.js'
    )
    setupStubs()
    loaded = true
  }
  try {
    const result = PlaytestCore.run(msg.files, msg.mygameJs, msg.runs, {
      seedBase: msg.seedBase || 0,
      strategy: msg.strategy,
      maxSteps: msg.maxSteps || 5000,
      onProgress: (done, total) => postMessage({ type: 'PROGRESS', done, total })
    })
    postMessage({ type: 'RESULT', result })
  } catch (err) {
    postMessage({ type: 'RESULT', result: null, error: String((err && err.message) || err) })
  }
}
