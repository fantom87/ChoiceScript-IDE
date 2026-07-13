# Changelog

ChoiceScript IDE — a dedicated desktop editor for authoring ChoiceScript games.

> This project was versioned locally before the git history began (the repo
> starts at v0.0.41). The entries below reconstruct the full release history;
> every listed version shipped as a portable build. From v0.0.41 onward each
> version is also a real commit + tag.

## 0.0.49

- 🎲 Playtest Lab: a structured replacement for RandomTest. Seeded automated
  playthroughs (100–10,000 runs) recording data instead of a text log:
  ending distribution with percentages (click to jump), stat min/avg/max at
  game end, options that were never picked, and reproducible failures (the
  seed replays the exact run). Choose uniform random or coverage-seeking
  (prefers options it has tried least — finds rare branches faster). Each
  run also paints a traversal heatmap onto the node canvas: heavily-travelled
  nodes glow amber, cold paths stay plain.

## 0.0.48

- Coverage painted onto the canvas: nodes QuickTest's branch-walker never
  reaches are dimmed, and in the whole-game view each scene title carries a
  ⚠ count of unreached lines — dead labels and unlockable options become
  visible at a glance. Updates automatically as the deep pass runs.
- (Canonical build for 0.0.47's spellcheck feature — install this one.)

## 0.0.47

- Prose spellcheck: blue squiggles on unknown words — prose only (commands,
  ${…}, @{…}, [markup] and comments are never flagged; option text is).
  Quick fixes offer dictionary suggestions and "Add to the project
  dictionary" (stored per project). Toggle in the status bar.

## 0.0.46

- Local file history: every save snapshots the previous version of the scene
  (deduped, last 25 kept in .cside/history). 🕘 History in the editor header
  lists them with previews; restoring is itself undoable.
- Scene rename: hover a scene in the sidebar → ✏ renames the file AND updates
  *scene_list plus every *goto_scene / *gosub_scene / *redirect_scene across
  the project.
- Session restore: reopening a project returns you to the scene and view you
  left. The status bar now also shows words written this session (+N).
- CI on GitHub: every push runs the full 40-check headless harness +
  typecheck; tagged releases automatically gain macOS and Linux builds
  (Windows stays hand-shipped). The in-app updater is Windows-only by design.

## 0.0.45

- Advanced tutorial: a second 10-lesson course (🎓 menu) continuing the
  lighthouse game into the deep end — subroutines (*gosub/*return),
  parameters (*params), scene subroutine libraries (*gosub_scene),
  multireplace @{…}, arrays + label loops, *rand, player input
  (*input_text / $!{…}), investigation hubs with *disable_reuse,
  opposed_pair stat bars, and implicit_control_flow. Same live code
  validation as the basic course; progress tracked separately.
- Auto-reload toggle (status bar): turn it off and the live game stops
  refreshing while you type — edits queue up and apply on ↻ or Ctrl+S.
  Calmer for long writing sessions; on by default.

## 0.0.44

- Build-a-game tutorial: a 12-lesson course (🎓 → "Build-a-game tutorial")
  where you write a real mini-game — "The Lighthouse Keeper" — from *title to
  *ending: prose and page breaks, choices, labels and *goto convergence,
  variables and ${…}, *if/*else and fairmath, nested choices, *fake_choice,
  option modifiers, a second scene, the stats screen, achievements, and
  testing/exporting. The IDE checks your actual code live as you type — Next
  unlocks when the structure is really there — with a working example one
  click away in every lesson. Progress is saved; the tutorial project lives
  alongside your real ones.
- The 🎓 button now offers both the quick UI tour and the full course.

## 0.0.43

- Interactive tutorial: a guided spotlight tour of the whole IDE (editor,
  live game, node canvas, whole-game map, settings form, testing). Steps
  auto-advance when you actually do the thing — switch to Nodes, tick Whole
  game — and never block the app. Offered automatically on first run;
  replayable any time from the 🎓 toolbar button.
- `npm run check:game -- <folder>` — headless validator for any game folder:
  AST round-trip, lint, the engine's branch-walking autotester, and prose
  word counts.

## 0.0.42

- In-app updates: the editor checks GitHub Releases shortly after launch and,
  when a newer version exists, shows an update banner. One click downloads the
  new portable exe (with progress), launches it and closes the old one.
  Dismissible; silent when offline or up to date.
- `npm run release` publishes the current version's portable exe + zip as a
  GitHub Release, with notes pulled from this changelog.

## 0.0.41

- Goto fan-ins merge too: every `*goto` converging on the same label now shares
  one routing lane, so the whole fan-in collapses into a single visible trunk
  (e.g. 24 options all jumping to `*label done` render as one path with
  branches feeding in, not a 10-lane parallel bundle).

## 0.0.40

- Thinner zoomed-out connectors: stroke-width buckets toned down from 2/4/8 to
  2/3/4 so the whole-game view's paths match the single-scene look.
- Convergence trunks: plain flow edges entering the same node merge into a
  shared "bus + single drop" trunk above the target. Same-looking edges only
  (same target/colour/dash); each candidate is validated against node
  rectangles and falls back to its normal curve when blocked.

## 0.0.39

- Editable whole-game view: every node in every scene is editable in place —
  inline fields, context menus (adds go to the plate you clicked in),
  add/delete/reorder, choice count steppers. Edits write to the correct
  scene's file.
- Cross-scene drag-connect: drag to another scene's plate title for
  `*goto_scene <scene>`, or to a node inside it for
  `*goto_scene <scene> <label>` (the label is created in the target scene if
  needed).
- Zoom-based level of detail: zoomed out the game view is a fast read-only
  overview; zoom in past 0.55 and full editing chrome appears.
- Multi-select clipboard: Ctrl+C copies selected nodes as plain ChoiceScript
  text, Ctrl+V pastes as an unconnected island, Delete removes them.
- ⚙ Game settings form: title, author, scene list, `*create` stats and
  achievements from startup.txt edited as a form (round-trip safe).
- ELK layout engine trial: "Layout: Standard / ELK (beta)" switch in
  single-scene view — real obstacle-aware orthogonal edge routing.

## 0.0.38

- Straight-drop exits (kills the "exit squiggle"): a path leaves straight down
  when the corridor under its source is clear; side gutters only when blocked.
- Direct goto steps: near jumps take a simple down/across/down path when
  nothing is in the way, instead of looping through the left channel.
- Scene titles position themselves over the entry node, so "first node under
  the scene name" holds without widening plates.

## 0.0.37

- Scene plates centre on their entry node; the first node always sits under
  the scene title.
- Exits leave directly under their source node (order-preserving spacing).
- Gateway continuations simplified to strip-run + straight drop — the hub's
  16-way fan-in untangles into parallel runs.

## 0.0.36

- Wrapped choice-grid rows connect via the aligned column gutters instead of
  plunging through rows.
- Pigtail fix: adjacent goto targets take a stepped direct path instead of a
  U-turn through the channel.

## 0.0.35

- Corridors between scenes are shelf-aware (clear the tallest plate in the
  row), plate gap widened to fit all lanes.
- Deterministic plate refit: plates re-hug their actually-rendered children
  after layout, guaranteeing nothing overflows.

## 0.0.34

- Short-edge squiggle fix (smoothstep offset clamped to the node gap).
- Two-lane corridors: exit-indexed and gateway-indexed lanes stop corridor
  overlap between plates.
- Custom colours apply everywhere: canvas nodes, edges, editor keywords and
  per-line tints all share one palette.

## 0.0.33

- Whole-game overflow root-caused (measured-size race) — plates now only
  finalize once every node is measured.
- Orthogonal path cleanup: routes start exactly at the node, killing diagonal
  jogs; dynamic gutter widths per scene; edge culling threshold raised so
  paths don't vanish when zoomed in.
- Selection tracing: click a node or plate to highlight it and all its
  connections (everything else dims).
- Custom node colours (🎨 popover, persisted in project config).

## 0.0.32

- Gutter exit routing: exits step sideways into a verified-clear vertical
  gutter between node columns, then down.
- Export quality presets (low / medium / high).

## 0.0.31

- Choice grids align into true columns (each option drags its exclusive
  subtree along).
- Scene title is a floating gateway above the edge layer — paths pass under
  it; it expands with the number of incoming connections.
- Entering whole-game view keeps the current scene framed.
- Export progress reports each stage (render / connections / per-scene /
  encode / save).

## 0.0.30

- Choice grid root-cause fix: dagre rank forcing via per-edge minlen+weight
  (12 options → 3 rows of 5).
- Universal channel routing for in-scene `*goto` edges in both views.
- Pass-based whole-game export: edges drawn as canvas vectors under per-scene
  captures composited into place.

## 0.0.29

- Pure cross-scene edge router: exits through the plate bottom, corridors
  between shelves, highways around the map, in through the target's title
  gateway — never through other plates.
- Wide choices wrap into a grid (5 per row).
- Export culling fix (off-screen plates were missing from captures).

## 0.0.28

- Whole-game plates re-fit with measured node sizes (no more overflow).
- Plates flow in scene_list order (startup first).
- Export progress ticker.

## 0.0.27

- Export picks its destination first via a native save dialog (PNG/JPEG by
  extension); font-inlining hang fully fixed.
- Parallel edges separate into distinct lanes.
- Corridor gaps between scene plates for cross-scene paths.

## 0.0.26

- Whole-game v3: scenes are real parent plates — drag the title to move the
  whole scene, drag nodes freely inside (the plate re-fits).
- Shelf packing replaces the grid (no more dead space).
- Cased adaptive edges: dark casing under coloured cores makes crossings
  readable; stroke width adapts to zoom.

## 0.0.25

- Whole-game performance: static node rendering in game mode (thousands of
  live inputs were the chop), viewport culling.
- Puzzle-piece scene mosaic: tinted, touching scene plates.
- Export hang fixed (skip font inlining); JPEG export option.
- Release archive layout: newest build copied to the project root.

## 0.0.24

- Whole-game view: every scene laid out and stitched into one map with
  cross-scene edges; scene banners; PNG export of either view.

## 0.0.23

- Node-only authoring batch: insert palette (text/set/temp/if/if-else/goto/
  page_break/choice/fake/custom command), move up/down, wrap-in-`*if`,
  editable option modifiers, variables panel (create/temp), new scene from the
  canvas.

## 0.0.22

- Islands: right-click add creates an unconnected node at the click point.
- `*goto`/`*gosub` edges drawn (amber, arrowed); sequence edges suppressed
  after hard terminators.
- Drag-to-connect: dragging between nodes writes the `*goto` (labels
  auto-created or reused).

## 0.0.21

- Per-line code colouring uses text colour (not background).
- Position preservation: field edits keep your hand-dragged layout; only
  structural changes re-run layout.

## 0.0.20

- Right-click context menus on canvas and nodes (add/insert/delete/play).
- On-demand ⚑ Review popover replaces always-on error nagging.
- Per-line editor tints matching node colours.

## 0.0.19

- Hotfix: node view crashed the whole app (React Flow provider missing).
  Added an error boundary and an SSR smoke test so a canvas crash can never
  blank the app again.

## 0.0.18

- Measured node layout (no more clipped/overlapping headers), wrapped
  headers, add-node menu, editor↔canvas colour sync, whole-node hover
  highlight.

## 0.0.15–0.0.17

- Choice-flow graph: every `#option` is its own node; choice nodes fan out to
  option nodes; nested choices break out recursively (0.0.15–16).
- Suggestions batch (0.0.17): option-modifier parsing (`*selectable_if …
  #Opt`), structural editing from the canvas (insert/delete/play-from-node),
  view consolidation (retired the old Beats/Graph views), lint hardening
  (fall-into-else, function parens, needs-parens, `*rand` targets), per-option
  word counts.

## 0.0.12–0.0.14

- Typed node editor: statement-level AST canvas with guaranteed byte-exact
  round-trip; docked nested children with indent guides; choice count
  steppers (0.0.12–13).
- Collapsible deep nesting + full undo/redo shared between editor and canvas
  (0.0.14).

## 0.0.7–0.0.11

- First node editor (beat-level, Twine-style), colour-coded typed headers,
  editor↔canvas hover sync, resizable nodes, reflow-on-resize toggle.

## 0.0.6

- Alt+T/Alt+F choice shortcuts fixed (Electron menu was eating Alt).

## 0.0.2–0.0.5

- Editor toolkit: command completion + snippets, chorded inserts, find/replace
  across the project, rename variable/label, go-to-definition, word counts,
  RandomTest integration, full Monaco feature set.

## 0.0.1

- Initial release. Electron + Monaco + the real ChoiceScript engine running
  live in a sandboxed iframe: open a project, edit with a custom ChoiceScript
  language (syntax, lint, quick fixes), hot reload that keeps your place,
  save points, isolated scene preview with seeded stats, flow graph,
  auto-indent normalization, whole-project error detection (engine
  autotester), export to self-contained HTML, portable Windows build.
