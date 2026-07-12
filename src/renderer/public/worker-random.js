/*
 * ChoiceScript IDE — RandomTest worker.
 * Drives the engine's randomtest.js over in-memory scenes: N randomized
 * playthroughs with seeded RNG. Contract validated in scripts/testRandomtest.cjs.
 */

// Preload the engine so randomtest.js sees Scene defined and skips its own,
// path-relative importScripts.
importScripts(
  'app://engine/scene.js',
  'app://engine/navigator.js',
  'app://engine/util.js',
  'app://engine/seedrandom.js'
)

self.onmessage = function (e) {
  var d = e.data
  if (!d || d.type !== 'RUN') return

  try {
    // Generated mygame.js sets globals nav + stats.
    ;(0, eval)(d.mygameJs)
    if (typeof nav !== 'undefined' && nav.setStartingStatsClone) {
      nav.setStartingStatsClone(stats)
    }

    // Loading randomtest.js installs its worker console (-> postMessage) and its
    // own onmessage handler (Scene is already defined so it skips importScripts).
    importScripts('app://engine/randomtest.js')

    // Resolve scene file reads from the in-memory map (used by the coverage pass).
    self.slurpFile = function (url) {
      if (self.slurps && Object.prototype.hasOwnProperty.call(self.slurps, url)) {
        return self.slurps[url]
      }
      throw new Error('Missing scene: ' + url)
    }

    // Invoke randomtest's handler with the run parameters.
    onmessage({
      data: {
        iterations: d.iterations,
        randomSeed: d.seed || 0,
        showCoverage: true,
        showText: false,
        showChoices: false,
        highlightGenderPronouns: false,
        avoidUsedOptions: true,
        recordBalance: true,
        sceneContent: d.scenes
      }
    })
  } catch (err) {
    postMessage({ msg: 'RANDOMTEST FAILED: ' + ((err && err.message) || err) })
  }

  // randomtest() runs synchronously; signal completion.
  postMessage({ type: 'DONE' })
}
