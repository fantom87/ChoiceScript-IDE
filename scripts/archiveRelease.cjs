/*
 * Archive the current build for posterity. After `electron-builder` runs, this:
 *   1. copies dist/ChoiceScript IDE-<ver>-{portable.exe,x64.zip} into
 *      <repo>/releases/<ver>/  (releases/ holds ONLY version folders), and
 *   2. puts a copy of the newest build in the MAIN project folder (repo root),
 *      replacing whatever previous version sat there.
 * Invoked automatically at the tail of `npm run dist`.
 */
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const version = pkg.version
const DIST = path.join(__dirname, '..', 'dist')
const ROOT = path.join(__dirname, '..', '..')
const RELEASES = path.join(ROOT, 'releases')

const artifacts = [
  `ChoiceScript IDE-${version}-portable.exe`,
  `ChoiceScript IDE-${version}-x64.zip`
]

const present = artifacts.filter((f) => fs.existsSync(path.join(DIST, f)))
if (present.length === 0) {
  console.log(`[archive] no build artifacts for v${version} in dist/ — nothing to archive`)
  process.exit(0)
}

// 1. Permanent version-named archive folder (releases/ = version folders only).
const verDir = path.join(RELEASES, version)
fs.mkdirSync(verDir, { recursive: true })
for (const f of present) fs.copyFileSync(path.join(DIST, f), path.join(verDir, f))

// Migration/tidy: no loose exe/zip may sit at the releases/ root any more.
for (const f of fs.readdirSync(RELEASES)) {
  if (/\.(exe|zip)$/i.test(f)) fs.rmSync(path.join(RELEASES, f), { force: true })
}

// 2. The latest build lives in the MAIN project folder — replace the old one.
// A locked file (the old exe is probably RUNNING) must not abort the archive:
// warn and move on; everything is already safe in releases/<ver>/.
for (const f of fs.readdirSync(ROOT)) {
  if (!/^ChoiceScript IDE-.*\.(exe|zip)$/i.test(f)) continue
  try {
    fs.rmSync(path.join(ROOT, f), { force: true })
  } catch (e) {
    console.warn(`[archive] could not remove ${f} (in use?): ${e.message}`)
  }
}
for (const f of present) {
  try {
    fs.copyFileSync(path.join(DIST, f), path.join(ROOT, f))
  } catch (e) {
    console.warn(`[archive] could not copy ${f} to project root (in use?): ${e.message}`)
  }
}

// 3. Prune superseded builds from dist/ — releases/ is the permanent archive,
//    so dist/ only needs the current version's artifacts.
let pruned = 0
for (const f of fs.readdirSync(DIST)) {
  const m = /^ChoiceScript IDE-(\d+\.\d+\.\d+)-(?:portable\.exe|x64\.zip)$/.exec(f)
  if (m && m[1] !== version) {
    fs.rmSync(path.join(DIST, f), { force: true })
    pruned++
  }
}

console.log(
  `[archive] v${version}: archived to releases/${version}/, latest copied to project root (${present.length} file(s)), pruned ${pruned} old build file(s) from dist/`
)
