import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EngineFrame } from './engine/EngineFrame'
import type { EngineError, EngineHandle } from './engine/EngineFrame'
import { SceneTree } from './project/SceneTree'
import { ProblemsPanel } from './project/ProblemsPanel'
import { SavePointsPanel } from './project/SavePointsPanel'
import { Welcome } from './project/Welcome'
import { RandomTestPanel } from './project/RandomTestPanel'
import { runRandomTest, parseRandomResults } from './choicescript/randomTest'
import type { SavePoint } from '../../shared/types'
import type { UpdateInfo } from '../../shared/update'
import { buildProject } from './project/projectModel'
import { generateMygameJs } from './choicescript/mygameGen'
import { buildChoiceScriptIndex } from './choicescript/analyze'
import { lintProject } from './choicescript/lint'
import type { Diagnostic } from './choicescript/lint'
import { runDeepLint } from './choicescript/deepLint'
import { StatSeedForm } from './preview/StatSeedForm'
import { enumerateStats, randomizeStats, buildIsolatedRun } from './choicescript/stats'
import type { StatDef } from './choicescript/stats'
import { ChoiceTreePanel } from './preview/ChoiceTreePanel'
import { parseChoiceTree } from './choicescript/choiceTree'
import { AstCanvas } from './graph/AstCanvas'
import { GameSettingsPanel } from './project/GameSettingsPanel'
import { HistoryPanel } from './project/HistoryPanel'
import { PlaytestPanel } from './project/PlaytestPanel'
import { Tutorial } from './tutorial/Tutorial'
import { LessonPanel } from './tutorial/LessonPanel'
import { LESSONS } from './tutorial/lessons'
import { ADVANCED_LESSONS } from './tutorial/advancedLessons'
import { lineTints } from './choicescript/ast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { normalizeIndentation } from './choicescript/indent'
import { insertIntoSceneList } from './choicescript/sceneList'
import { renameSceneRefs, validSceneName } from './choicescript/sceneRename'
import { checkProse, type Misspelling } from './choicescript/spell'
import { getSpellDict } from './choicescript/spellDict'
import { spellHooks } from './editor/setupMonaco'
import { resolveDefinition, detectSymbol, renameVariable, renameLabel, replaceProject } from './choicescript/navigation'
import { countProject } from './choicescript/wordCount'
import { InsertMenu } from './editor/InsertMenu'
import { FindPanel } from './project/FindPanel'
import { DEFAULT_CONFIG } from '../../shared/types'
import type { IdeConfig } from '../../shared/types'
import { MonacoEditor } from './editor/MonacoEditor'
import type { MonacoEditorHandle } from './editor/MonacoEditor'
import { setChoiceScriptIndex } from './editor/setupMonaco'

interface ProjectPaths {
  root: string
  scenesDir: string
}

export default function App() {
  const engineRef = useRef<EngineHandle>(null)
  const editorRef = useRef<MonacoEditorHandle>(null)

  const [paths, setPaths] = useState<ProjectPaths | null>(null)
  const [files, setFiles] = useState<Record<string, string>>({})
  const [activeScene, setActiveScene] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('Loading engine…')
  const [errors, setErrors] = useState<EngineError[]>([])

  const [engineReady, setEngineReady] = useState(false)
  const [booted, setBooted] = useState(false)

  const [savePoints, setSavePoints] = useState<SavePoint[]>([])
  const [autosave, setAutosave] = useState(false)
  const [isolating, setIsolating] = useState(false)
  const [isolatedStats, setIsolatedStats] = useState<StatDef[]>([])
  const [viewMode, setViewMode] = useState<'live' | 'choices' | 'typed'>('live')
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const [followPlaythrough, setFollowPlaythrough] = useState(true)
  const followRef = useRef(followPlaythrough)
  followRef.current = followPlaythrough
  const lastEditRef = useRef(0)
  const [config, setConfig] = useState<IdeConfig>(DEFAULT_CONFIG)
  const [creatingScene, setCreatingScene] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')
  const [showWelcome, setShowWelcome] = useState(false)
  const [randomOpen, setRandomOpen] = useState(false)
  const [randomRunning, setRandomRunning] = useState(false)
  const [randomLog, setRandomLog] = useState<string[]>([])
  const [randomSummary, setRandomSummary] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [playtestOpen, setPlaytestOpen] = useState(false)
  /** Traversal heat from the last playtest (scene -> visits per 1-based line). */
  const [playHeat, setPlayHeat] = useState<Record<string, number[]> | null>(null)
  const [renaming, setRenaming] = useState<{ kind: 'variable' | 'label'; oldName: string; scene: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Interactive tutorial (auto-offered on first run, replayable via 🎓).
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [canvasGameMode, setCanvasGameMode] = useState(false)
  // Build-a-game tutorials: course + lesson index (-1 = closed), persisted.
  const [learnOpen, setLearnOpen] = useState(false)
  const [lessonCourse, setLessonCourse] = useState<'basic' | 'adv'>('basic')
  const [lessonIdx, setLessonIdx] = useState(-1)
  // In-app updates: checked once shortly after boot against GitHub Releases.
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updatePct, setUpdatePct] = useState<number | null>(null)
  const [updateErr, setUpdateErr] = useState<string | null>(null)
  const currentStateRef = useRef<{ json: string; scene?: string; lineNum?: number } | null>(null)
  const autosaveRef = useRef(autosave)
  autosaveRef.current = autosave
  const MAX_AUTOSAVES = 5

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagErrors = useRef<string[]>([])
  // Latest values for use inside debounced callbacks.
  const filesRef = useRef(files)
  filesRef.current = files
  const activeRef = useRef(activeScene)
  activeRef.current = activeScene

  const project = useMemo(() => {
    if (!paths) return null
    return buildProject({ root: paths.root, scenesDir: paths.scenesDir, files })
  }, [paths, files])

  // Persist the session (scene + view) per project for next launch.
  useEffect(() => {
    if (!paths || !activeScene) return
    localStorage.setItem(`cside-session-${paths.root}`, JSON.stringify({ scene: activeScene, view: viewMode }))
  }, [paths, activeScene, viewMode])

  // First run: offer the tour once a project is actually on screen.
  useEffect(() => {
    if (!project) return
    if (localStorage.getItem('cside-tutorial-seen')) return
    const t = setTimeout(() => setTutorialOpen(true), 1200)
    return () => clearTimeout(t)
  }, [project])
  const closeTutorial = useCallback(() => {
    localStorage.setItem('cside-tutorial-seen', '1')
    setTutorialOpen(false)
  }, [])

  const lessonKey = lessonCourse === 'adv' ? 'cside-lesson-adv-idx' : 'cside-lesson-idx'
  const setLesson = useCallback(
    (i: number) => {
      if (i < 0) {
        // Finished — clear progress so a fresh run starts at lesson 1.
        localStorage.removeItem(lessonKey)
        setLessonIdx(-1)
        setStatus('Tutorial complete — happy writing! 🎉')
        return
      }
      localStorage.setItem(lessonKey, String(i))
      setLessonIdx(i)
    },
    [lessonKey]
  )

  // One update check shortly after boot (no-op in dev / offline).
  useEffect(() => {
    const t = setTimeout(() => {
      window.cside
        .updateCheck()
        .then((u) => setUpdate(u))
        .catch(() => {})
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  const applyUpdate = useCallback(() => {
    if (!update) return
    setUpdateErr(null)
    setUpdatePct(0)
    const off = window.cside.onUpdateProgress(setUpdatePct)
    window.cside
      .updateApply(update)
      .catch((e) => {
        setUpdateErr((e as Error).message ?? String(e))
        setUpdatePct(null)
      })
      .finally(off)
  }, [update])

  // Keep the editor's completion index in sync with the project.
  useEffect(() => {
    if (project) {
      setChoiceScriptIndex(buildChoiceScriptIndex(files, project.sceneList))
    }
  }, [files, project])

  // Inline lint diagnostics for the whole project.
  const diagnostics = useMemo<Record<string, Diagnostic[]>>(() => {
    if (!project) return {}
    return lintProject(files, project.sceneList)
  }, [files, project])

  // Deep whole-project pass (autotester in a worker) → deferred diagnostics.
  const [deepByScene, setDeepByScene] = useState<Record<string, Diagnostic[]>>({})
  useEffect(() => {
    if (!project) return
    const t = setTimeout(() => {
      runDeepLint(filesRef.current, project.sceneList).then((diags) => {
        if (window.cside.selftest) {
          const first = diags[0]
          console.log(
            `[selftest] deep pass: ${diags.length} deferred; first=${first ? `${first.scene}:${first.line + 1} [${first.code}] ${first.message}` : 'none'}`
          )
        }
        const grouped: Record<string, Diagnostic[]> = {}
        for (const d of diags) (grouped[d.scene] ??= []).push(d)
        setDeepByScene(grouped)
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [files, project])

  const allProblems = useMemo(
    () =>
      [...Object.values(diagnostics).flat(), ...Object.values(deepByScene).flat()].sort(
        (a, b) =>
          a.scene.localeCompare(b.scene) ||
          a.line - b.line ||
          (a.deferred === b.deferred ? 0 : a.deferred ? 1 : -1)
      ),
    [diagnostics, deepByScene]
  )

  const activeDiagnostics = useMemo(
    () =>
      activeScene
        ? [...(diagnostics[activeScene] ?? []), ...(deepByScene[activeScene] ?? [])]
        : [],
    [activeScene, diagnostics, deepByScene]
  )

  const jumpToProblem = useCallback((scene: string, line: number, column: number) => {
    setActiveScene(scene)
    setTimeout(() => editorRef.current?.revealLine(line + 1, column), 60)
  }, [])

  const navigateToSource = useCallback((scene: string, line: number) => {
    setActiveScene(scene)
    setTimeout(() => editorRef.current?.revealLine(line + 1, 1), 60)
  }, [])

  const choiceTree = useMemo(
    () => (activeScene ? parseChoiceTree(files[activeScene] ?? '') : []),
    [activeScene, files]
  )

  // Coverage: unreached line ranges per scene, from the deep pass.
  const unreachedByScene = useMemo(() => {
    const map: Record<string, [number, number][]> = {}
    for (const [scene, diags] of Object.entries(deepByScene)) {
      for (const d of diags) {
        if (d.code !== 'untested') continue
        ;(map[scene] ??= []).push([d.line, d.endLine ?? d.line])
      }
    }
    return map
  }, [deepByScene])

  const words = useMemo(() => countProject(files), [files])
  // Session writing stats: project word count when this project was opened.
  const sessionBaseline = useRef<number | null>(null)
  const sessionDelta = sessionBaseline.current === null ? 0 : words.total - sessionBaseline.current

  // Node-canvas ↔ editor sync: the 1-based line under the editor cursor/mouse.
  const [hoverLine, setHoverLine] = useState<number | null>(null)

  // Custom node-type colours apply EVERYWHERE: set them as CSS variables on
  // the document root so the canvas, editor tints, and any future surface
  // share one palette.
  useEffect(() => {
    const root = document.documentElement
    const defaults: Record<string, string> = {
      text: '#9a9a9a',
      command: '#c586c0',
      choice: '#dcdcaa',
      option: '#4ec9b0',
      if: '#569cd6'
    }
    for (const key of Object.keys(defaults)) {
      root.style.setProperty(`--c-${key}`, config.typeColors?.[key as keyof typeof config.typeColors] ?? defaults[key])
    }
  }, [config.typeColors])

  // Per-line editor tints matching node colours (when the option is on).
  const editorTints = useMemo(
    () =>
      (config.matchNodeColors ?? true) && activeScene ? lineTints(files[activeScene] ?? '') : [],
    [files, activeScene, config.matchNodeColors]
  )

  // Declared variables for the node canvas panel: startup stats + scene temps.
  const sceneVariables = useMemo(() => {
    const out: { name: string; value: string; kind: 'create' | 'temp' }[] = []
    for (const raw of (files['startup'] ?? '').split(/\r?\n/)) {
      const m = /^\s*\*create\s+(\w+)\s*(.*)$/.exec(raw)
      if (m) out.push({ name: m[1].toLowerCase(), value: m[2].trim(), kind: 'create' })
    }
    if (activeScene && activeScene !== 'startup') {
      for (const raw of (files[activeScene] ?? '').split(/\r?\n/)) {
        const m = /^\s*\*temp\s+(\w+)\s*(.*)$/.exec(raw)
        if (m) out.push({ name: m[1].toLowerCase(), value: m[2].trim(), kind: 'temp' })
      }
    }
    return out
  }, [files, activeScene])

  // Apply a set of changed scene buffers: update state, persist, hot-reload.
  const applyChangedFiles = useCallback(
    async (changed: Record<string, string>) => {
      if (!Object.keys(changed).length) return
      setFiles((prev) => ({ ...prev, ...changed }))
      if (paths) {
        for (const scene in changed) {
          await window.cside.writeScene(paths.scenesDir, scene, changed[scene])
        }
      }
      engineRef.current?.hotReload(changed)
    },
    [paths]
  )

  const gotoDefinition = useCallback((lineText: string, word: string) => {
    const loc = resolveDefinition(filesRef.current, activeRef.current ?? 'startup', lineText, word)
    if (loc) navigateToSource(loc.scene, loc.line)
    else setStatus(`No definition found for '${word}'`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requestRename = useCallback((word: string, lineText: string) => {
    const kind = detectSymbol(lineText, word)
    if (kind === 'scene') {
      setStatus("Scene rename isn't supported yet — use Find & Replace")
      return
    }
    setRenaming({ kind, oldName: word, scene: activeRef.current ?? 'startup' })
    setRenameValue(word)
  }, [])

  const commitRename = useCallback(async () => {
    const r = renaming
    setRenaming(null)
    if (!r || !renameValue.trim() || renameValue.trim() === r.oldName) return
    const nn = renameValue.trim()
    const changed =
      r.kind === 'label'
        ? renameLabel(filesRef.current, r.scene, r.oldName, nn)
        : renameVariable(filesRef.current, r.oldName, nn)
    await applyChangedFiles(changed)
    setStatus(`Renamed ${r.kind} '${r.oldName}' → '${nn}' across ${Object.keys(changed).length} scene(s)`)
  }, [renaming, renameValue, applyChangedFiles])

  const replaceAll = useCallback(
    async (query: string, replacement: string, opts: { regex: boolean; caseSensitive: boolean }) => {
      const changed = replaceProject(filesRef.current, query, replacement, opts)
      await applyChangedFiles(changed)
      setStatus(`Replaced in ${Object.keys(changed).length} scene(s)`)
    },
    [applyChangedFiles]
  )

  // --- Loading a project --------------------------------------------------
  const openProjectData = useCallback(
    (data: { root: string; scenesDir: string; files: Record<string, string> }) => {
      setPaths({ root: data.root, scenesDir: data.scenesDir })
      setFiles(data.files)
      sessionBaseline.current = countProject(data.files).total
      // Resume where this project was last left (dev CSIDE_SCENE wins).
      let session: { scene?: string; view?: 'live' | 'typed' | 'choices' } | null = null
      try {
        session = JSON.parse(localStorage.getItem(`cside-session-${data.root}`) ?? 'null')
      } catch {
        session = null
      }
      const initial = window.cside.initialScene
      const first =
        initial && data.files[initial] !== undefined
          ? initial
          : session?.scene && data.files[session.scene] !== undefined
            ? session.scene
            : data.files['startup'] !== undefined
              ? 'startup'
              : Object.keys(data.files)[0] ?? null
      setActiveScene(first)
      if (session?.view) setViewMode(session.view)
      setDirty(new Set())
      setErrors([])
      setBooted(false)
      setDeepByScene({})
      setShowWelcome(false)
      window.cside.setLastProject(data.root).catch(() => {})
      window.cside
        .listSaves(data.root)
        .then(setSavePoints)
        .catch(() => setSavePoints([]))
      window.cside
        .readConfig(data.root)
        .then(setConfig)
        .catch(() => setConfig(DEFAULT_CONFIG))
    },
    []
  )

  useEffect(() => {
    // Reopen the last project, else show the welcome screen.
    window.cside
      .getLastProject()
      .then((root) => {
        if (root) {
          window.cside.loadProject(root).then(openProjectData).catch(() => setShowWelcome(true))
        } else {
          setShowWelcome(true)
        }
      })
      .catch(() => setShowWelcome(true))
  }, [openProjectData])

  const handleOpenProject = useCallback(async () => {
    try {
      const data = await window.cside.openProjectDialog()
      if (data) openProjectData(data)
    } catch (e) {
      setStatus(`Open failed: ${(e as Error).message}`)
    }
  }, [openProjectData])

  const handleNewProject = useCallback(async () => {
    try {
      const data = await window.cside.newProjectDialog()
      if (data) openProjectData(data)
    } catch (e) {
      setStatus(`New project failed: ${(e as Error).message}`)
    }
  }, [openProjectData])

  const handleSample = useCallback(async () => {
    try {
      openProjectData(await window.cside.loadSample())
    } catch (e) {
      setStatus(`Failed to load sample: ${(e as Error).message}`)
    }
  }, [openProjectData])

  // Build-a-game courses: open (creating on first use) the tutorial project,
  // then resume wherever the learner left off in the chosen course.
  const startLessons = useCallback(
    async (course: 'basic' | 'adv') => {
      setLearnOpen(false)
      try {
        const data = await window.cside.loadTutorial()
        if (paths?.root !== data.root) openProjectData(data)
        const key = course === 'adv' ? 'cside-lesson-adv-idx' : 'cside-lesson-idx'
        const saved = parseInt(localStorage.getItem(key) ?? '0', 10)
        setLessonCourse(course)
        setLessonIdx(Number.isFinite(saved) && saved >= 0 ? saved : 0)
      } catch (e) {
        setStatus(`Tutorial failed to open: ${(e as Error).message}`)
      }
    },
    [paths, openProjectData]
  )

  // --- Booting the engine once both engine + project are ready ------------
  useEffect(() => {
    if (!engineReady || !project || booted) return
    setStatus('Booting game…')
    engineRef.current?.loadGame({ mygameJs: project.mygameJs, scenes: project.data.files })
    setBooted(true)

    // Dev self-test: exercise the save-point save + jump path.
    if (window.cside.selftest) {
      setTimeout(async () => {
        const st = engineRef.current?.getLastState()
        console.log(`[selftest] lastState scene=${st?.scene} line=${st?.lineNum}`)
        await handleSaveCurrent()
        console.log('[selftest] saved current point')
        if (st) {
          engineRef.current?.runFrom({ state: st.json })
          console.log('[selftest] jumped to saved state')
        }
      }, 1500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, project, booted])

  // --- Editing ------------------------------------------------------------
  // --- Live-pane reload policy ----------------------------------------------
  // Auto (default): debounced hot reload on every edit. Off: edits queue up
  // and the game only reloads on ↻ / Ctrl+S — calmer for long writing spells.
  const [autoReload, setAutoReload] = useState(() => localStorage.getItem('cside-auto-reload') !== '0')
  const autoReloadRef = useRef(autoReload)
  autoReloadRef.current = autoReload
  const pendingReload = useRef<Set<string>>(new Set())
  const [reloadPending, setReloadPending] = useState(false)

  const flushReload = useCallback(() => {
    const pend = pendingReload.current
    if (!pend.size) return
    setErrors([])
    lastEditRef.current = Date.now()
    const latest = filesRef.current
    if (pend.has('startup')) {
      // Startup affects nav/stats/scene_list — full reboot from startup.
      engineRef.current?.loadGame({ mygameJs: generateMygameJs(latest['startup'] ?? '', latest), scenes: latest })
    } else {
      const changed: Record<string, string> = {}
      for (const s of pend) changed[s] = latest[s] ?? ''
      engineRef.current?.hotReload(changed)
    }
    pendingReload.current = new Set()
    setReloadPending(false)
  }, [])

  const queueReload = useCallback(
    (sceneName: string) => {
      pendingReload.current.add(sceneName)
      if (autoReloadRef.current) {
        if (reloadTimer.current) clearTimeout(reloadTimer.current)
        reloadTimer.current = setTimeout(flushReload, 300)
      } else {
        setReloadPending(true)
      }
    },
    [flushReload]
  )

  const toggleAutoReload = useCallback(
    (on: boolean) => {
      setAutoReload(on)
      localStorage.setItem('cside-auto-reload', on ? '1' : '0')
      if (on) flushReload() // apply anything that queued up while manual
    },
    [flushReload]
  )

  const handleEdit = useCallback(
    (text: string) => {
      const scene = activeRef.current
      if (!scene) return
      setFiles((prev) => ({ ...prev, [scene]: text }))
      setDirty((prev) => new Set(prev).add(scene))
      queueReload(scene)
    },
    [queueReload]
  )

  // Canvas edits go through the editor's model (an undoable executeEdits), so
  // both editor typing and node-canvas edits share Monaco's per-scene undo
  // stack. (Routing them straight to setFiles would hit model.setValue, which
  // wipes the undo history.)
  const applyEditUndoable = useCallback(
    (text: string) => {
      const ed = editorRef.current
      if (ed) ed.applyFullText(text)
      else handleEdit(text)
    },
    [handleEdit]
  )

  // Edit ANY scene (whole-game mode edits non-active scenes): the active scene
  // goes through the undoable editor path; others update state + hot-reload
  // directly (not in the editor's undo stack — noted limitation).
  const editSceneText = useCallback(
    (sceneName: string, text: string) => {
      if (sceneName === activeRef.current) {
        applyEditUndoable(text)
        return
      }
      setFiles((prev) => ({ ...prev, [sceneName]: text }))
      setDirty((prev) => new Set(prev).add(sceneName))
      queueReload(sceneName)
    },
    [applyEditUndoable, queueReload]
  )

  // Rename a scene everywhere: file on disk, *scene_list, every *goto_scene /
  // *gosub_scene / *redirect_scene reference across the project.
  const renameSceneByName = useCallback(
    async (oldName: string, newName: string) => {
      if (!paths || !oldName || oldName === newName) return
      if (oldName === 'startup' || oldName === 'choicescript_stats') {
        setStatus(`${oldName} has a fixed name in ChoiceScript`)
        return
      }
      if (!validSceneName(newName)) {
        setStatus('Scene names: letters, numbers, - and _ only')
        return
      }
      const res = await window.cside.renameScene(paths.scenesDir, oldName, newName)
      if (!res.ok) {
        setStatus(`Rename failed: ${res.reason}`)
        return
      }
      const latest = filesRef.current
      const changedRefs = renameSceneRefs(latest, oldName, newName)
      const next: Record<string, string> = {}
      for (const s of Object.keys(latest)) {
        if (s === oldName) continue
        next[s] = changedRefs[s] ?? latest[s]
      }
      next[newName] = changedRefs[oldName] ?? latest[oldName]
      setFiles(next)
      // Persist every scene whose TEXT changed (the file itself was renamed
      // on disk already; self-references live in the new file now).
      for (const s of Object.keys(changedRefs)) {
        const target = s === oldName ? newName : s
        await window.cside.writeScene(paths.scenesDir, target, next[target]).catch(() => {})
      }
      setDirty((prev) => new Set([...prev].filter((s) => s !== oldName)))
      if (activeRef.current === oldName) setActiveScene(newName)
      // scene_list / nav changed — full reboot keeps the engine honest.
      pendingReload.current.add('startup')
      flushReload()
      setStatus(`Renamed ${oldName} → ${newName} (${Object.keys(changedRefs).length} file(s) updated)`)
    },
    [paths, flushReload]
  )

  // Global undo/redo — works from the node canvas too, not just the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const isUndo = k === 'z' && !e.shiftKey
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
      if (!isUndo && !isRedo) return
      const el = document.activeElement as HTMLElement | null
      if (el?.closest('.monaco-host')) return // Monaco handles its own undo
      const inCanvas = el?.closest('.beat-canvas')
      // Let native undo run inside dialog/toolbar fields (not canvas fields).
      if (
        !inCanvas &&
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      )
        return
      e.preventDefault()
      if (isRedo) editorRef.current?.redo()
      else editorRef.current?.undo()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const saveScene = useCallback(async (scene: string) => {
    if (!paths) return
    try {
      await window.cside.writeScene(paths.scenesDir, scene, filesRef.current[scene] ?? '')
      setDirty((prev) => {
        const next = new Set(prev)
        next.delete(scene)
        return next
      })
      setStatus(`Saved ${scene}.txt`)
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`)
    }
  }, [paths])

  // --- Save points --------------------------------------------------------
  const genId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const onStateSnapshot = useCallback(
    (state: { json: string; scene?: string; lineNum?: number }) => {
      currentStateRef.current = state

      // Follow the playthrough: move the editor to the current spot. Skipped
      // right after an edit (that snapshot is from a hot reload, not a click).
      if (
        followRef.current &&
        viewModeRef.current === 'live' &&
        state.scene &&
        Date.now() - lastEditRef.current > 1500
      ) {
        const line = (state.lineNum ?? 0) + 1
        const switching = state.scene !== activeRef.current
        if (switching) setActiveScene(state.scene)
        setTimeout(
          () => {
            editorRef.current?.setPlayLine(line)
            editorRef.current?.revealLine(line)
          },
          switching ? 90 : 0
        )
      }

      if (!autosaveRef.current || !paths) return
      const save: SavePoint = {
        id: genId('auto'),
        name: 'Autosave',
        scene: state.scene ?? 'startup',
        lineNum: state.lineNum ?? 0,
        createdAt: new Date().toISOString(),
        auto: true,
        state: state.json
      }
      window.cside.writeSave(paths.root, save).then(() => {
        setSavePoints((prev) => {
          const next = [save, ...prev]
          const prune = next.filter((s) => s.auto).slice(MAX_AUTOSAVES)
          for (const p of prune) window.cside.deleteSave(paths.root, p.id)
          return next.filter((s) => !prune.includes(s))
        })
      })
    },
    [paths]
  )

  const handleSaveCurrent = useCallback(async () => {
    if (!paths) return
    let st = engineRef.current?.getLastState() ?? currentStateRef.current
    if (!st) {
      const json = await engineRef.current?.getSnapshot()
      if (json) st = { json }
    }
    if (!st) {
      setStatus('Nothing to save yet — play to a choice first')
      return
    }
    const save: SavePoint = {
      id: genId('save'),
      name: `${st.scene ?? 'startup'}:${(st.lineNum ?? 0) + 1}`,
      scene: st.scene ?? 'startup',
      lineNum: st.lineNum ?? 0,
      createdAt: new Date().toISOString(),
      auto: false,
      state: st.json
    }
    await window.cside.writeSave(paths.root, save)
    setSavePoints((prev) => [save, ...prev])
    setStatus(`Saved point '${save.name}'`)
  }, [paths])

  const handleJumpSave = useCallback((save: SavePoint) => {
    engineRef.current?.runFrom({ state: save.state })
    setStatus(`Jumped to '${save.name}'`)
  }, [])

  const handleRenameSave = useCallback(
    async (id: string, name: string) => {
      if (!paths) return
      const save = savePoints.find((s) => s.id === id)
      if (!save) return
      const updated = { ...save, name }
      await window.cside.writeSave(paths.root, updated)
      setSavePoints((prev) => prev.map((s) => (s.id === id ? updated : s)))
    },
    [paths, savePoints]
  )

  const handleDeleteSave = useCallback(
    async (id: string) => {
      if (!paths) return
      await window.cside.deleteSave(paths.root, id)
      setSavePoints((prev) => prev.filter((s) => s.id !== id))
    },
    [paths]
  )

  // --- Isolated single-scene preview --------------------------------------
  const openIsolate = useCallback(() => {
    if (!activeRef.current) return
    setIsolatedStats(enumerateStats(filesRef.current['startup'] ?? ''))
    setIsolating(true)
  }, [])

  const editSeed = useCallback((name: string, value: string) => {
    setIsolatedStats((prev) => prev.map((s) => (s.name === name ? { ...s, value } : s)))
  }, [])

  const randomizeSeed = useCallback(() => {
    setIsolatedStats((prev) => randomizeStats(prev))
  }, [])

  const runIsolate = useCallback(() => {
    const scene = activeRef.current
    if (!scene) return
    const run = buildIsolatedRun(scene, isolatedStats)
    engineRef.current?.runFrom({
      state: run.state,
      forcedScene: run.forcedScene,
      forcedStats: run.forcedStats
    })
    setIsolating(false)
    setStatus(`Isolated preview: ${scene}`)
  }, [isolatedStats])

  // Play the active scene from a specific top-level line (node canvas ▶):
  // an isolated run seeded with startup defaults, started mid-scene.
  const playFrom = useCallback((line0: number) => {
    const scene = activeRef.current
    if (!scene) return
    const run = buildIsolatedRun(scene, enumerateStats(filesRef.current['startup'] ?? ''))
    const state = JSON.parse(run.state) as { lineNum: number }
    state.lineNum = line0
    engineRef.current?.runFrom({
      state: JSON.stringify(state),
      forcedScene: run.forcedScene,
      forcedStats: run.forcedStats
    })
    setViewMode('live')
    setStatus(`Playing ${scene} from line ${line0 + 1}`)
  }, [])

  // --- Indentation config + normalization ---------------------------------
  const updateConfig = useCallback(
    (patch: Partial<IdeConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch }
        if (paths) window.cside.writeConfig(paths.root, next).catch(() => {})
        return next
      })
    },
    [paths]
  )

  // --- Prose spellcheck ------------------------------------------------------
  // Active scene only, debounced; the hunspell dictionary parses lazily once.
  const [misspellings, setMisspellings] = useState<Misspelling[]>([])
  useEffect(() => {
    if (config.spellcheck === false || !activeScene) {
      setMisspellings([])
      return
    }
    const text = files[activeScene] ?? ''
    const ignore = new Set((config.spellIgnore ?? []).map((w) => w.toLowerCase()))
    const t = setTimeout(() => {
      try {
        setMisspellings(checkProse(getSpellDict(), text, ignore))
      } catch {
        setMisspellings([])
      }
    }, 700)
    return () => clearTimeout(t)
  }, [activeScene, files, config.spellcheck, config.spellIgnore])

  // Quick-fix hooks: suggestions + "add to the project dictionary".
  useEffect(() => {
    spellHooks.suggest = (w) => {
      try {
        return getSpellDict().suggest(w)
      } catch {
        return []
      }
    }
    spellHooks.addWord = (w) => {
      try {
        getSpellDict().add(w)
      } catch {
        /* dictionary not ready — the config entry still takes effect */
      }
      updateConfig({ spellIgnore: [...new Set([...(config.spellIgnore ?? []), w.toLowerCase()])] })
    }
  }, [config.spellIgnore, updateConfig])

  const normalizeIndent = useCallback(() => {
    const scene = activeRef.current
    if (!scene) return
    const res = normalizeIndentation(filesRef.current[scene] ?? '', {
      style: config.indentStyle,
      width: config.indentWidth
    })
    if (res.changed === 0) {
      setStatus('Indentation already normalized')
      return
    }
    const msg =
      `Normalize ${res.changed} line(s) to ${config.indentWidth} ${config.indentStyle}(s) per level?` +
      (res.ambiguous.length
        ? `\n\n⚠ ${res.ambiguous.length} line(s) mix tabs and spaces (lines ${res.ambiguous.slice(0, 8).join(', ')}${res.ambiguous.length > 8 ? '…' : ''}) — those are a best-effort guess. You can undo with Ctrl+Z.`
        : '\n\nYou can undo with Ctrl+Z.')
    if (window.confirm(msg)) {
      editorRef.current?.applyFullText(res.text)
      setStatus(`Normalized ${res.changed} line(s)`)
    }
  }, [config])

  // --- New scene / export / tests -----------------------------------------
  // Shared scene creation (toolbar dialog + node-canvas "New scene…").
  const createSceneByName = useCallback(
    async (rawName: string, activate: boolean): Promise<boolean> => {
      const name = rawName.trim().toLowerCase()
      if (!name || !paths) return false
      if (!/^[\w-]+$/.test(name)) {
        setStatus('Invalid scene name (use letters, numbers, _ or -)')
        return false
      }
      const res = await window.cside.createScene(paths.scenesDir, name)
      if (!res.created) {
        setStatus(`Could not create scene: ${res.reason}`)
        return false
      }
      const template = `*comment ${name}\n\nYour scene text here.\n\n*finish\n`
      const newStartup = insertIntoSceneList(filesRef.current['startup'] ?? '', name)
      setFiles((prev) => ({ ...prev, [name]: template, startup: newStartup }))
      if (newStartup !== (filesRef.current['startup'] ?? '')) {
        await window.cside.writeScene(paths.scenesDir, 'startup', newStartup)
      }
      if (activate) setActiveScene(name)
      setStatus(`Created scene '${name}'`)
      return true
    },
    [paths]
  )

  const commitNewScene = useCallback(async () => {
    const name = newSceneName
    setCreatingScene(false)
    setNewSceneName('')
    await createSceneByName(name, true)
  }, [newSceneName, createSceneByName])

  const exportGame = useCallback(async () => {
    if (!project) return
    const startup = filesRef.current['startup'] ?? ''
    const title = /^\*title (.*)/m.exec(startup)?.[1]?.trim() || 'ChoiceScript Game'
    const author = /^\*author (.*)/m.exec(startup)?.[1]?.trim() || ''
    setStatus('Exporting…')
    try {
      const path = await window.cside.exportHtml({
        mygameJs: project.mygameJs,
        scenes: filesRef.current,
        title,
        author
      })
      setStatus(path ? `Exported to ${path}` : 'Export cancelled')
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`)
    }
  }, [project])

  const runTests = useCallback(async () => {
    if (!project) return
    setStatus('Running QuickTest…')
    const diags = await runDeepLint(filesRef.current, project.sceneList)
    const grouped: Record<string, Diagnostic[]> = {}
    for (const d of diags) (grouped[d.scene] ??= []).push(d)
    setDeepByScene(grouped)
    const errs = diags.filter((d) => d.severity === 'error').length
    setStatus(errs ? `QuickTest: ${errs} error(s) — see Problems` : 'QuickTest passed ✓')
  }, [project])

  const runRandom = useCallback(
    async (iterations: number, seed: number) => {
      if (!project) return
      setRandomRunning(true)
      setRandomSummary(null)
      setRandomLog([`Running ${iterations} random playthroughs (seed ${seed})…`])
      let pending: string[] = []
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const onLine = (line: string): void => {
        pending.push(line)
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            setRandomLog((prev) => [...prev, ...pending].slice(-600))
            pending = []
            flushTimer = null
          }, 120)
        }
      }
      const messages = await runRandomTest(project.mygameJs, filesRef.current, iterations, seed, onLine)
      const result = parseRandomResults(messages, iterations)
      setRandomLog((prev) => [...prev, ...pending])
      setRandomSummary(result.summary)
      setRandomRunning(false)
      // Surface any errors in the Problems panel (deferred).
      if (result.errors.length) {
        setDeepByScene((prev) => {
          const next = { ...prev }
          for (const e of result.errors) next[e.scene] = [...(next[e.scene] ?? []), e]
          return next
        })
      }
      setStatus(result.summary)
    },
    [project]
  )

  // Diagnostic mode: scripted UI/engine self-check → write a report → quit.
  const diagRan = useRef(false)
  useEffect(() => {
    if (!window.cside.diagnostic || !booted || !project || diagRan.current) return
    diagRan.current = true
    let cancelled = false
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const results: { name: string; pass: boolean; detail: string }[] = []
    const record = (name: string, pass: boolean, detail: string): void => {
      results.push({ name, pass, detail })
    }

    ;(async () => {
      await wait(2000) // let the engine boot + first render settle

      record('engine iframe booted + rendered', booted, booted ? 'rendered' : 'no render signal')

      const st = engineRef.current?.getLastState()
      record('resumable state captured', !!st, st ? `${st.scene}:${(st.lineNum ?? 0) + 1}` : 'none')

      try {
        await handleSaveCurrent()
        record('save point written to disk', true, 'ok')
      } catch (e) {
        record('save point written to disk', false, (e as Error).message)
      }

      diagErrors.current = []
      if (st) {
        engineRef.current?.runFrom({ state: st.json })
        await wait(600)
      }
      record('jump to save (no engine error)', diagErrors.current.length === 0, diagErrors.current[0] ?? 'ok')

      diagErrors.current = []
      const scene = activeRef.current
      if (scene) engineRef.current?.hotReload({ [scene]: filesRef.current[scene] ?? '' })
      await wait(700)
      record('hot reload (no engine error)', diagErrors.current.length === 0, diagErrors.current[0] ?? 'ok')

      try {
        const diags = await runDeepLint(filesRef.current, project.sceneList)
        record('deep-lint worker ran', Array.isArray(diags), `${diags.length} findings`)
      } catch (e) {
        record('deep-lint worker ran', false, (e as Error).message)
      }

      record('inline linter active', true, `${Object.values(diagnostics).flat().length} project diagnostics`)

      if (cancelled) return
      const passed = results.filter((r) => r.pass).length
      const md = [
        '# ChoiceScript IDE — App Diagnostic Report',
        '',
        'Generated by `npm run diag:app` (Electron self-check on a real display).',
        '',
        `**${passed}/${results.length} checks passed.** ${passed === results.length ? '✅ All green.' : '❌ some failed.'}`,
        '',
        '## Renderer / engine-iframe',
        '',
        ...results.map((r) => `- ${r.pass ? '✅' : '❌'} **${r.name}** — ${r.detail}`),
        ''
      ].join('\n')
      window.cside.reportDiagnostic(md)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, project, booted])

  // Ctrl/Cmd+S saves the active scene.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeRef.current) saveScene(activeRef.current)
        if (!autoReloadRef.current) flushReload() // manual mode: save = reload
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveScene, flushReload])

  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [])

  // --- Engine callbacks ---------------------------------------------------
  const onReady = useCallback(() => setEngineReady(true), [])
  const onRendered = useCallback((scene?: string) => {
    setStatus(`Rendered${scene ? ` · scene: ${scene}` : ''}`)
  }, [])
  const onError = useCallback((err: EngineError) => {
    diagErrors.current.push(`${err.scene ?? ''}:${err.line ?? ''} ${err.message}`)
    setErrors((prev) => [err, ...prev].slice(0, 50))
  }, [])

  const onHover = useCallback((scene: string | undefined, line: number) => {
    if (scene && scene === activeRef.current) editorRef.current?.setHoverLine(line + 1)
  }, [])
  const onHoverClear = useCallback(() => editorRef.current?.setHoverLine(null), [])

  const editorValue = activeScene ? files[activeScene] ?? '' : ''

  if (!paths) {
    return showWelcome ? (
      <Welcome onNew={handleNewProject} onOpen={handleOpenProject} onSample={handleSample} />
    ) : (
      <div className="app-loading">Loading…</div>
    )
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="titlebar-title">ChoiceScript IDE</span>
        <button className="tb-button" onClick={handleOpenProject}>Open Project…</button>
        {project && (
          <>
            <button className="tb-button" onClick={() => setCreatingScene(true)}>New Scene</button>
            <InsertMenu onInsert={(snip) => editorRef.current?.insertSnippet(snip)} />
            <button className="tb-button" onClick={() => setFindOpen((o) => !o)}>Find</button>
            <button className="tb-button" data-tut="settings" onClick={() => setSettingsOpen(true)}>⚙ Game</button>
            <button className="tb-button" data-tut="tests" onClick={runTests}>QuickTest</button>
            <button className="tb-button" onClick={() => setRandomOpen(true)}>RandomTest</button>
            <button className="tb-button" title="Seeded automated playthroughs with analytics" onClick={() => setPlaytestOpen(true)}>🎲 Playtest</button>
            <button className="tb-button" onClick={exportGame}>Export…</button>
            <span className="learn-wrap">
              <button className="tb-button" title="Learn the IDE and ChoiceScript" onClick={() => setLearnOpen((o) => !o)}>🎓</button>
              {learnOpen && (
                <span className="learn-pop" onMouseLeave={() => setLearnOpen(false)}>
                  <button
                    onClick={() => {
                      setLearnOpen(false)
                      setTutorialOpen(true)
                    }}
                  >
                    Quick tour of the IDE
                    <span className="learn-sub">2 minutes — where everything lives</span>
                  </button>
                  <button onClick={() => void startLessons('basic')}>
                    Build-a-game tutorial
                    <span className="learn-sub">12 lessons — write a real mini-game, checked as you go</span>
                  </button>
                  <button onClick={() => void startLessons('adv')}>
                    Advanced tutorial
                    <span className="learn-sub">10 lessons — subroutines, arrays, input, hubs &amp; more</span>
                  </button>
                </span>
              )}
            </span>
          </>
        )}
        <span className="titlebar-sub">{paths ? paths.root : 'no project'}</span>
      </header>

      <div className="panes">
        <aside className="pane-sidebar">
          {creatingScene && (
            <input
              className="new-scene-input"
              autoFocus
              placeholder="new scene name…"
              value={newSceneName}
              onChange={(e) => setNewSceneName(e.target.value)}
              onBlur={commitNewScene}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewScene()
                if (e.key === 'Escape') {
                  setCreatingScene(false)
                  setNewSceneName('')
                }
              }}
            />
          )}
          {project && (
            <SceneTree
              scenes={project.scenes}
              activeScene={activeScene}
              dirty={dirty}
              onSelect={setActiveScene}
              onRename={(a, b) => void renameSceneByName(a, b)}
            />
          )}
          {project && (
            <SavePointsPanel
              saves={savePoints}
              autosave={autosave}
              onToggleAutosave={setAutosave}
              onSaveCurrent={handleSaveCurrent}
              onJump={handleJumpSave}
              onRename={handleRenameSave}
              onDelete={handleDeleteSave}
            />
          )}
        </aside>

        <section className="pane pane-editor">
          <div className="pane-header pane-header-row">
            <span>
              {activeScene ? `${activeScene}.txt` : 'no scene'}
              {activeScene && dirty.has(activeScene) ? ' ●' : ''}
            </span>
            {activeScene && (
              <span className="header-actions">
                <button
                  className="header-btn"
                  title="Undo (Ctrl+Z)"
                  onClick={() => editorRef.current?.undo()}
                >
                  ↶ Undo
                </button>
                <button
                  className="header-btn"
                  title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
                  onClick={() => editorRef.current?.redo()}
                >
                  ↷ Redo
                </button>
                <button className="header-btn" title="Normalize indentation of this file" onClick={normalizeIndent}>
                  ⇥ Normalize
                </button>
                <button className="header-btn" title="Preview this scene in isolation" onClick={openIsolate}>
                  ⧉ Isolate
                </button>
                <button
                  className="header-btn"
                  title="Snapshots taken on every save — restore any earlier version"
                  onClick={() => setHistoryOpen(true)}
                >
                  🕘 History
                </button>
              </span>
            )}
          </div>
          <MonacoEditor
            ref={editorRef}
            scene={activeScene}
            value={editorValue}
            diagnostics={activeDiagnostics}
            indentStyle={config.indentStyle}
            indentWidth={config.indentWidth}
            nodeColors={config.matchNodeColors ?? true}
            lineTints={editorTints}
            typeColors={config.typeColors}
            onChange={handleEdit}
            onGotoDefinition={gotoDefinition}
            onRename={requestRename}
            onHoverLine={setHoverLine}
            spelling={misspellings}
          />
        </section>

        <div className="pane-divider" />

        <section className="pane pane-preview">
          <div className="pane-header pane-header-row">
            <span>
              {viewMode === 'choices'
                ? 'Choice Tree'
                : viewMode === 'typed'
                  ? 'Node Editor'
                  : isolating
                    ? 'Isolated Preview'
                    : 'Live Preview'}
            </span>
            <span className="view-toggle">
              <button
                className={`view-btn ${viewMode === 'live' ? 'active' : ''}`}
                onClick={() => setViewMode('live')}
              >
                Live
              </button>
              <button
                className={`view-btn ${viewMode === 'typed' ? 'active' : ''}`}
                onClick={() => setViewMode('typed')}
              >
                Nodes
              </button>
              <button
                className={`view-btn ${viewMode === 'choices' ? 'active' : ''}`}
                onClick={() => setViewMode('choices')}
              >
                Choices
              </button>
            </span>
          </div>
          <div className="preview-body">
            <div
              className="engine-holder"
              style={{ display: viewMode === 'live' ? 'flex' : 'none' }}
            >
              <EngineFrame
                ref={engineRef}
                onReady={onReady}
                onRendered={onRendered}
                onError={onError}
                onStateSnapshot={onStateSnapshot}
                onHover={onHover}
                onHoverClear={onHoverClear}
              />
            </div>
            {viewMode === 'choices' && activeScene && (
              <ChoiceTreePanel
                scene={activeScene}
                tree={choiceTree}
                onJump={(line) => navigateToSource(activeScene, line)}
              />
            )}
            {viewMode === 'typed' && activeScene && (
              <ErrorBoundary label="node editor">
              <AstCanvas
                scene={activeScene}
                text={files[activeScene] ?? ''}
                highlightLine={hoverLine}
                indentStyle={config.indentStyle}
                indentWidth={config.indentWidth}
                files={files}
                sceneList={project?.sceneList ?? []}
                problems={activeDiagnostics}
                variables={sceneVariables}
                onGameModeChange={setCanvasGameMode}
                unreached={unreachedByScene}
                heat={playHeat ?? undefined}
                onNewScene={(name) => void createSceneByName(name, false)}
                typeColors={config.typeColors}
                onTypeColors={(patch) =>
                  updateConfig({ typeColors: { ...config.typeColors, ...patch } })
                }
                onEditScene={editSceneText}
                onJump={(line0, sc) => {
                  if (sc && sc !== activeScene) {
                    setActiveScene(sc)
                    setTimeout(() => editorRef.current?.revealLine(line0 + 1, 1), 80)
                  } else {
                    editorRef.current?.revealLine(line0 + 1, 1)
                  }
                }}
                onHoverRange={(range, focus) =>
                  editorRef.current?.setHoverRange(
                    range ? range[0] : null,
                    range ? range[1] : undefined,
                    focus?.[0],
                    focus?.[1]
                  )
                }
                onIndentChange={updateConfig}
                onNormalize={normalizeIndent}
                onSwitchScene={setActiveScene}
                onPlayFrom={playFrom}
              />
              </ErrorBoundary>
            )}
            {viewMode === 'live' && isolating && activeScene && (
              <StatSeedForm
                scene={activeScene}
                stats={isolatedStats}
                onEdit={editSeed}
                onRandomize={randomizeSeed}
                onRun={runIsolate}
                onClose={() => setIsolating(false)}
              />
            )}
          </div>
        </section>
        {findOpen && (
          <FindPanel
            files={files}
            onNavigate={(scene, line, col) => {
              navigateToSource(scene, line)
              editorRef.current?.revealLine(line + 1, col)
            }}
            onReplaceAll={replaceAll}
            onClose={() => setFindOpen(false)}
          />
        )}
        {renaming && (
          <div className="rename-overlay">
            <div className="rename-box">
              <span>
                Rename {renaming.kind} <strong>{renaming.oldName}</strong> to:
              </span>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            </div>
          </div>
        )}
      </div>

      {randomOpen && (
        <RandomTestPanel
          running={randomRunning}
          log={randomLog}
          summary={randomSummary}
          onRun={runRandom}
          onClose={() => setRandomOpen(false)}
        />
      )}

      {playtestOpen && project && (
        <PlaytestPanel
          files={files}
          mygameJs={generateMygameJs(files['startup'] ?? '', files)}
          onJump={(scene, line0) => jumpToProblem(scene, line0, 1)}
          onHeat={setPlayHeat}
          onClose={() => setPlaytestOpen(false)}
        />
      )}

      {historyOpen && paths && activeScene && (
        <HistoryPanel
          scenesDir={paths.scenesDir}
          scene={activeScene}
          onRestore={applyEditUndoable}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {settingsOpen && (
        <GameSettingsPanel
          startupText={files['startup'] ?? ''}
          onSave={(t) => editSceneText('startup', t)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ProblemsPanel problems={allProblems} onSelect={jumpToProblem} />

      {tutorialOpen && (
        <Tutorial
          signals={{ activeScene, viewMode, gameMode: canvasGameMode, settingsOpen }}
          onClose={closeTutorial}
        />
      )}

      {lessonIdx >= 0 && project && (
        <LessonPanel
          lessons={lessonCourse === 'adv' ? ADVANCED_LESSONS : LESSONS}
          courseLabel={lessonCourse === 'adv' ? 'Advanced' : 'Lesson'}
          idx={lessonIdx}
          files={files}
          onIdx={setLesson}
          onClose={() => setLessonIdx(-1)}
        />
      )}

      {update && (
        <div className="update-banner">
          {updatePct === null ? (
            <>
              <span className="update-title">⬆ Version {update.version} is available</span>
              <button className="header-btn" onClick={applyUpdate}>
                Update &amp; restart
              </button>
              <button className="header-btn" onClick={() => setUpdate(null)} title="Not now">
                ✕
              </button>
            </>
          ) : (
            <span className="update-title">
              {updatePct < 100 ? `Downloading v${update.version}… ${updatePct}%` : 'Restarting into the new version…'}
            </span>
          )}
          {updateErr && <span className="update-err">{updateErr}</span>}
        </div>
      )}

      <footer className="statusbar">
        <span className="statusbar-status">{status}</span>
        <label className="statusbar-follow" title="Sync the editor to the live playthrough position">
          <input
            type="checkbox"
            checked={followPlaythrough}
            onChange={(e) => {
              setFollowPlaythrough(e.target.checked)
              if (!e.target.checked) editorRef.current?.setPlayLine(null)
            }}
          />
          Follow
        </label>
        <span className="statusbar-words" title="Prose word count (this scene / whole project) — and written this session">
          {activeScene ? `${(words.perScene[activeScene] ?? 0).toLocaleString()} / ` : ''}
          {words.total.toLocaleString()} words
          {sessionDelta !== 0 && (
            <span className={`statusbar-session ${sessionDelta > 0 ? 'up' : ''}`}>
              {' '}
              ({sessionDelta > 0 ? '+' : ''}
              {sessionDelta.toLocaleString()})
            </span>
          )}
        </span>
        <span className="statusbar-indent">
          Indent:
          <select
            value={config.indentStyle}
            onChange={(e) => updateConfig({ indentStyle: e.target.value as 'tab' | 'space' })}
          >
            <option value="space">Spaces</option>
            <option value="tab">Tabs</option>
          </select>
          <select
            value={config.indentWidth}
            onChange={(e) => updateConfig({ indentWidth: Number(e.target.value) })}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </span>
        <label className="statusbar-follow" title="Colour code to match the node canvas (commands purple, choices yellow, options teal, if/else blue)">
          <input
            type="checkbox"
            checked={config.matchNodeColors ?? true}
            onChange={(e) => updateConfig({ matchNodeColors: e.target.checked })}
          />
          Node colors
        </label>
        <label
          className="statusbar-follow"
          title={`Prose spellcheck squiggles${misspellings.length ? ` (${misspellings.length} in this scene)` : ''}`}
        >
          <input
            type="checkbox"
            checked={config.spellcheck !== false}
            onChange={(e) => updateConfig({ spellcheck: e.target.checked })}
          />
          Spelling
        </label>
        <label
          className="statusbar-follow"
          title="Reload the live game as you type. Off: edits wait for ↻ or Ctrl+S — calmer for long writing sessions."
        >
          <input type="checkbox" checked={autoReload} onChange={(e) => toggleAutoReload(e.target.checked)} />
          Auto-reload
        </label>
        {!autoReload && (
          <button
            className={`header-btn ${reloadPending ? 'reload-waiting' : ''}`}
            title="Apply queued edits to the live game (Ctrl+S also reloads)"
            onClick={flushReload}
          >
            ↻ Reload{reloadPending ? ' ●' : ''}
          </button>
        )}
        <span className="statusbar-problems">
          {allProblems.length
            ? `${allProblems.length} problem${allProblems.length > 1 ? 's' : ''}`
            : 'No problems'}
          {errors.length ? ` · engine: ${errors[0].message}` : ''}
        </span>
      </footer>
    </div>
  )
}
