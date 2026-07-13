/*
 * Playtest Lab core: a structured replacement for randomtest. Drives the real
 * engine through seeded automated playthroughs and records DATA instead of a
 * text log — per-choice option pick counts, ending distribution, stat ranges,
 * per-line visit heat, and reproducible failures (seed + location).
 *
 * Plain script on the engine's globals (Scene, nav, stats, Math.seedrandom):
 * loaded by worker-playtest.js via importScripts AND by the diag harness in a
 * Node vm — keep it dependency-free and ES2019-ish.
 *
 * Choice driving mimics randomtest.js's proven contract: override
 * Scene.prototype.choice, park the continuation in the global `timeout`
 * trampoline, resolve with standardResolution(option).
 */
/* eslint-disable no-var */
;(function () {
  var installed = false
  var recording = null // active run's recorder (set per run)
  var picksSoFar = {} // choiceKey -> [counts] (coverage-seeking strategy reads this)
  var strategy = 'uniform'
  var lineCoverage = {} // scene -> [visits per 1-based line]

  function installOverrides(files) {
    if (installed) return
    installed = true

    // If the autotester ran in this realm earlier, it hijacked the core
    // dispatcher (quicktest semantics) — restore the saved originals first.
    var p = Scene.prototype
    if (p.oldRunCommand) p.runCommand = p.oldRunCommand
    if (p.oldGoto) p['goto'] = p.oldGoto
    if (p.oldSceneList) p.scene_list = p.oldSceneList
    if (p.oldInputText) p.input_text = p.oldInputText
    if (p.oldInputNumber) p.input_number = p.oldInputNumber
    p.quicktest = false

    Scene.prototype.loadScene = function () {
      this.loadLines(files[this.name] || '')
      this.loaded = true
      if (this.executing) this.execute()
    }

    // Per-line visit heat (same getter/setter trick randomtest uses).
    try {
      Scene.prototype.__defineGetter__('lineNum', function () {
        return this._lineNum
      })
      Scene.prototype.__defineSetter__('lineNum', function (val) {
        var cov = lineCoverage[this.name]
        if (!cov) cov = lineCoverage[this.name] = []
        cov[val] = (cov[val] || 0) + 1
        this._lineNum = val
      })
      Scene.prototype.rollbackLineCoverage = function (lineNum) {
        if (lineNum === undefined) lineNum = this.lineNum
        var cov = lineCoverage[this.name]
        if (cov && cov[lineNum]) cov[lineNum]--
      }
    } catch (e) {
      /* no coverage on ancient engines */
    }

    Scene.prototype.ending = function () {
      if (recording) {
        recording.ending = { scene: this.name, line: this.lineNum + 1 }
      }
      this.finished = true
    }
    Scene.prototype.restart = Scene.prototype.ending

    // Page breaks just continue (a bot never needs the Next button).
    Scene.prototype.page_break = function (buttonText) {
      this.paragraph()
      this.finished = false
      if (this.resetCheckedPurchases) this.resetCheckedPurchases()
    }

    Scene.prototype.input_text = function (line) {
      var parsed = this.parseInputText(line)
      var names = ['Rook', 'Marlow', 'Vesper', 'Blake', 'Quill']
      var input = names[Math.floor(Math.random() * names.length)]
      this.set(parsed.variable + ' "' + input + '"')
    }
    Scene.prototype.input_number = function (data) {
      this.rand(data)
    }

    Scene.prototype.finish = Scene.prototype.autofinish = function (buttonText) {
      var nextSceneName = this.nav && nav.nextSceneName(this.name)
      this.finished = true
      this.paragraph()
      if (!nextSceneName) return // ran out of scenes — the run just ends
      var scene = new Scene(nextSceneName, this.stats, this.nav, this.debugMode)
      scene.resetPage()
    }

    Scene.prototype.choice = function (data, isFakeChoice) {
      var groups = ['choice']
      if (data) groups = data.split(/ /)
      var choiceLine = this.lineNum
      var allowFallthrough = isFakeChoice === true || this.getVar('implicit_control_flow')
      var options = this.parseOptions(this.indent, groups, allowFallthrough)
      var flattened = []
      flattenOptions(flattened, options, null)
      if (!flattened.length) throw new Error(this.lineMsg() + 'no selectable options')

      var key = this.name + ':' + (choiceLine + 1)
      var picks = picksSoFar[key]
      if (!picks) picks = picksSoFar[key] = new Array(flattened.length).fill(0)
      while (picks.length < flattened.length) picks.push(0)

      var index
      if (strategy === 'coverage') {
        // Prefer the least-picked option so rare branches get exercised.
        var min = Infinity
        var cands = []
        for (var i = 0; i < flattened.length; i++) {
          var c = picks[i] || 0
          if (c < min) {
            min = c
            cands = [i]
          } else if (c === min) cands.push(i)
        }
        index = cands[Math.floor(Math.random() * cands.length)]
      } else {
        index = Math.floor(Math.random() * flattened.length)
      }
      picks[index] = (picks[index] || 0) + 1

      if (recording) {
        recording.steps++
        var rec = recording.choices[key]
        if (!rec) {
          rec = recording.choices[key] = {
            scene: this.name,
            line: choiceLine + 1,
            options: flattened.map(function (f) {
              return String(f.ultimateOption.name || '').slice(0, 80)
            })
          }
        }
        if (recording.steps > recording.maxSteps) {
          throw new Error(this.lineMsg() + 'playtest step cap hit (possible infinite loop)')
        }
      }

      var item = flattened[index]
      if (!this.temps._choiceEnds) this.temps._choiceEnds = {}
      for (var j = 0; j < options.length; j++) {
        this.temps._choiceEnds[options[j].line - 1] = allowFallthrough ? this.lineNum : 0
      }
      this.paragraph()
      var self = this
      timeout = function () {
        self.standardResolution(item.ultimateOption)
      }
      this.finished = true

      function flattenOptions(list, opts, flat) {
        if (!flat) flat = {}
        for (var k = 0; k < opts.length; k++) {
          var option = opts[k]
          flat[option.group] = k
          if (option.suboptions) {
            flattenOptions(list, option.suboptions, flat)
          } else {
            flat.ultimateOption = option
            if (!option.unselectable) {
              var copy = {}
              for (var p in flat) copy[p] = flat[p]
              list.push(copy)
            }
          }
        }
      }
    }
  }

  /**
   * Run `count` seeded playthroughs. Returns aggregated, structured results.
   * opts: { seedBase, strategy: 'uniform'|'coverage', maxSteps, onProgress }
   */
  function run(files, mygameJs, count, opts) {
    opts = opts || {}
    strategy = opts.strategy === 'coverage' ? 'coverage' : 'uniform'
    var seedBase = opts.seedBase || 0
    picksSoFar = {}
    lineCoverage = {}
    ;(0, eval)(mygameJs) // (re)creates nav + stats globals
    nav.setStartingStatsClone(stats)
    installOverrides(files)

    var out = {
      total: count,
      completed: 0,
      seedBase: seedBase,
      strategy: strategy,
      errors: [],
      endings: {},
      statsAgg: {},
      choices: {},
      lineCoverage: null,
      steps: 0
    }
    var choiceMeta = {}

    for (var i = 0; i < count; i++) {
      var seed = seedBase + i
      timeout = null
      nav.resetStats(stats)
      Math.seedrandom('pt' + seed)
      recording = { steps: 0, maxSteps: opts.maxSteps || 5000, ending: null, choices: choiceMeta }
      var scene = new Scene(nav.getStartupScene(), stats, nav, false)
      try {
        scene.execute()
        var guard = 0
        while (timeout && guard++ < (opts.maxSteps || 5000) + 100) {
          var fn = timeout
          timeout = null
          fn()
        }
        out.completed++
        var endKey = recording.ending
          ? recording.ending.scene + ':' + recording.ending.line
          : '(ran out of scenes)'
        var end = out.endings[endKey]
        if (!end) {
          end = out.endings[endKey] = {
            scene: recording.ending ? recording.ending.scene : null,
            line: recording.ending ? recording.ending.line : 0,
            count: 0
          }
        }
        end.count++
        // Numeric stat aggregation at run end.
        for (var k in stats) {
          if (typeof stats[k] !== 'number') continue
          if (/^choice_/.test(k) || k === 'implicit_control_flow') continue
          var agg = out.statsAgg[k]
          if (!agg) agg = out.statsAgg[k] = { min: Infinity, max: -Infinity, sum: 0, n: 0 }
          var v = stats[k]
          if (v < agg.min) agg.min = v
          if (v > agg.max) agg.max = v
          agg.sum += v
          agg.n++
        }
      } catch (e) {
        out.errors.push({
          seed: seed,
          message: String((e && e.message) || e).slice(0, 300)
        })
      }
      out.steps += recording.steps
      recording = null
      if (opts.onProgress && (i + 1) % 25 === 0) opts.onProgress(i + 1, count)
    }

    // Join choice metadata with global pick counts.
    for (var key in choiceMeta) {
      var meta = choiceMeta[key]
      out.choices[key] = {
        scene: meta.scene,
        line: meta.line,
        options: meta.options,
        picks: picksSoFar[key] || []
      }
    }
    out.lineCoverage = lineCoverage
    return out
  }

  globalThis.PlaytestCore = { run: run }
})()
