/*
 * Launches the built app in diagnostic mode: it boots, runs a scripted
 * UI/engine self-check, writes diag-app-report.md, and quits. Run on a real
 * display via `npm run diag:app`.
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const out = path.join(process.cwd(), 'diag-app-report.md')
const env = { ...process.env, CSIDE_DIAGNOSTIC: '1', CSIDE_DIAG_OUT: out }

console.log('Launching app diagnostic — a window opens briefly, runs checks, then closes…')
const child = spawn('npx', ['electron-vite', 'preview'], { env, stdio: 'inherit', shell: true })
child.on('exit', (code) => {
  console.log(`\nDiagnostic finished. Report: ${out}`)
  process.exit(code == null ? 0 : code)
})
