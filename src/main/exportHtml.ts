import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface ExportOptions {
  mygameJs: string
  scenes: Record<string, string>
  title: string
  author: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'game'
}

/**
 * Assemble a single self-contained playable HTML file: the ChoiceScript engine,
 * generated mygame.js, and all scene sources inlined, with save support. Mirrors
 * what the engine's compile.js produces, adapted to serve scenes from memory.
 */
export async function buildStandaloneHtml(
  engineDir: string,
  opts: ExportOptions
): Promise<string> {
  const read = (f: string): Promise<string> => fs.readFile(join(engineDir, f), 'utf8')
  const [persist, alertifyJs, util, seed, ui, scene, nav, style, alertifyCss] = await Promise.all([
    read('persist.js'),
    read('alertify.min.js'),
    read('util.js'),
    read('seedrandom.js'),
    read('ui.js'),
    read('scene.js'),
    read('navigator.js'),
    read('style.css'),
    read('alertify.css')
  ])

  const inline = (js: string): string => `<script>${js}\n</script>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>${escapeHtml(opts.title || 'ChoiceScript Game')}</title>
<script>window.version="1.0";</script>
<style>${style}</style>
<style id="dynamic"></style>
<style>${alertifyCss}</style>
${inline(persist)}
${inline(alertifyJs)}
${inline(util)}
${inline(seed)}
${inline(ui)}
${inline(scene)}
${inline(nav)}
${inline(opts.mygameJs)}
<script>
window.alreadyLoaded = true;
window.storeName = ${JSON.stringify('cs-' + slug(opts.title))};
window.__scenes = ${JSON.stringify(opts.scenes)};
Scene.baseUrl = "";
var rootDir = "";
Scene.prototype.loadScene = function () {
  this.loadLines(window.__scenes[this.name] || "");
  this.loaded = true;
  if (this.executing) {
    if (typeof doneLoading === "function") doneLoading();
    this.execute();
  }
};
window.onload = function () {
  window.main = document.getElementById("main");
  if (typeof loadPreferences === "function") { try { loadPreferences(); } catch (e) {} }
  if (window.nav && window.nav.setStartingStatsClone) window.nav.setStartingStatsClone(window.stats);
  loadAndRestoreGame();
};
</script>
</head>
<body>
<div class="container" id="container1">
  <div id="header">
    <h1 id="title" class="gameTitle">${escapeHtml(opts.title || '')}</h1>
    <h2 id="author" class="gameTitle">${opts.author ? 'by ' + escapeHtml(opts.author) : ''}</h2>
    <p id="headerLinks"></p>
    <p id="buttons">
      <button id="statsButton" class="spacedLink" onclick="showStats()">Show Stats</button>
      <button id="menuButton" onclick="showMenu()" class="spacedLink">Menu</button>
    </p>
  </div>
  <div id="main"><div id="text"></div><script>startLoading();</script></div>
  <div id="mobileLinks" class="webOnly"></div>
</div>
</body>
</html>`
}
