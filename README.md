# ChoiceScript IDE

A dedicated desktop IDE for authoring [ChoiceScript](https://www.choiceofgames.com/make-your-own-games/choicescript-intro/) games — the interactive-fiction language behind Choice of Games titles.

Monaco code editor on the left, the **real ChoiceScript engine running your game live** on the right, and a node-based visual editor that can build a whole game without touching code.

## Features

- **Live play pane** — the actual engine runs in-app with hot reload that keeps your place in the story as you edit.
- **Full language tooling** — syntax highlighting, completion, snippets, lint with quick fixes, find/replace, rename, go-to-definition, auto-indent normalization, word counts.
- **Deep error detection** — instant inline diagnostics plus whole-project branch-walking (the engine's own autotester and RandomTest) for errors that only show up at run time.
- **Node editor** — every statement as a typed, editable node with guaranteed byte-exact round-trip to source. Add, delete, reorder, drag-to-connect (`*goto` written for you), copy/paste, play from any node.
- **Whole-game view** — every scene stitched into one connected map (scene plates, routed cross-scene paths, merged fan-ins) that's fully editable, with PNG/JPEG export to show off how expansive your game is.
- **Save points** — snapshot any moment of a playthrough and jump back to it, even after edits.
- **Isolated scene preview** — run any scene directly with seeded stats.
- **Game settings form** — title, author, scene list, stats and achievements edited as a form.
- **Export** — one self-contained playable HTML file.

## Development

```bash
npm install
npm run dev        # run the app
npm run typecheck  # TS check (node + web configs)
npm run diag       # headless self-test harness (runs the real engine in Node)
npm run dist       # portable .exe + .zip
```

Built with Electron, electron-vite, React, TypeScript, Monaco, React Flow, dagre/ELK.

## Credits

The bundled ChoiceScript engine (`resources/engine`) is by Dan Fabulich / [Choice of Games](https://www.choiceofgames.com/), included unmodified under its own [license](https://github.com/dfabulich/choicescript). ChoiceScript is a trademark of Choice of Games LLC; this project is an independent tool and is not affiliated with them.
