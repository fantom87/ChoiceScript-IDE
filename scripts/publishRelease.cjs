/*
 * Publish the current version as a GitHub Release (via the gh CLI), attaching
 * the portable exe + zip from releases/<ver>/. Release notes are pulled from
 * that version's CHANGELOG.md section. Idempotent: skips if the release
 * already exists. Run with `npm run release` after `npm run dist`.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const pkg = require('../package.json')
const version = pkg.version
const tag = `v${version}`
const ROOT = path.join(__dirname, '..', '..')
const verDir = path.join(ROOT, 'releases', version)

const artifacts = [
  path.join(verDir, `ChoiceScript IDE-${version}-portable.exe`),
  path.join(verDir, `ChoiceScript IDE-${version}-x64.zip`)
].filter((p) => fs.existsSync(p))

if (artifacts.length === 0) {
  console.error(`[release] no artifacts in releases/${version}/ — run \`npm run dist\` first`)
  process.exit(1)
}

/** The CHANGELOG.md section for this version (between its ## and the next). */
function changelogNotes() {
  try {
    const lines = fs
      .readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')
      .split(/\r?\n/)
    const start = lines.findIndex((l) => l.trim() === `## ${version}`)
    if (start >= 0) {
      let end = lines.length
      for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
          end = i
          break
        }
      }
      const notes = lines.slice(start + 1, end).join('\n').trim()
      if (notes) return notes
    }
  } catch {
    /* fall through */
  }
  return `Release ${tag}. See CHANGELOG.md.`
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

// Idempotence: if the release already exists, leave it alone.
try {
  gh(['release', 'view', tag])
  console.log(`[release] ${tag} already exists on GitHub — skipping`)
  process.exit(0)
} catch {
  /* not found → create it */
}

const notesFile = path.join(require('os').tmpdir(), `cside-release-notes-${version}.md`)
fs.writeFileSync(notesFile, changelogNotes(), 'utf8')
try {
  gh(['release', 'create', tag, ...artifacts, '--title', tag, '--notes-file', notesFile], {
    stdio: 'inherit'
  })
} finally {
  fs.rmSync(notesFile, { force: true })
}
console.log(`[release] published ${tag} with ${artifacts.length} artifact(s)`)
