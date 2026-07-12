import { app, BrowserWindow, protocol, shell, Menu } from 'electron'
import { promises as fsp } from 'node:fs'
import { join, normalize, sep, extname } from 'node:path'
import { registerIpc } from './ipc'

const isDev = !app.isPackaged

// Headless/test runs: render via SwiftShader (pure-CPU GL) so rendering and
// capturePage() work even when the environment's GPU is unavailable/wedged.
// Keep the software rasterizer enabled (do NOT disable it). No effect on normal use.
if (process.env['CSIDE_CAPTURE'] || process.env['CSIDE_SELFTEST']) {
  app.disableHardwareAcceleration()
}


/** Absolute path to the bundled ChoiceScript engine directory. */
const engineDir = app.isPackaged
  ? join(process.resourcesPath, 'engine')
  : join(__dirname, '../../resources/engine')

/** Absolute path to the built renderer (served as a proper origin, not file://). */
const rendererDir = join(__dirname, '../renderer')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain'
}

// Must run before `app.whenReady()`. Marks `app://` as a standard, secure
// origin so the engine iframe and its Web Workers (importScripts / fetch)
// behave like a normal https page instead of a restricted custom scheme.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

/**
 * Serve the `app://` scheme:
 *   app://engine/<path> -> the bundled ChoiceScript engine
 *   app://app/<path>    -> the built renderer (production)
 * A proper standard/secure origin so Monaco's workers, module scripts, and
 * fetch behave like a normal web page instead of restricted file://.
 */
function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const baseDir =
      url.host === 'engine' ? engineDir : url.host === 'app' ? rendererDir : null
    if (!baseDir) return new Response('Not Found', { status: 404 })

    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!rel) rel = 'index.html'
    const filePath = normalize(join(baseDir, rel))
    // Path-traversal guard: never serve outside the base directory.
    if (filePath !== baseDir && !filePath.startsWith(baseDir + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const data = await fsp.readFile(filePath)
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': type,
          // Allow the analysis worker (app://app) to importScripts the engine
          // files (app://engine) cross-origin.
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'ChoiceScript IDE',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details))
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[did-fail-load]', code, desc, url)
  })
  win.webContents.on('preload-error', (_e, path, err) => {
    console.log('[preload-error]', path, err?.message)
  })

  // Forward renderer/iframe console output to the main process stdout in dev,
  // so the engine lifecycle is observable without opening DevTools.
  if (isDev) {
    win.webContents.on('console-message', (...args: unknown[]) => {
      const first = args[0] as { message?: string } | undefined
      const message =
        first && typeof first === 'object' && 'message' in first
          ? first.message
          : (args[2] as string)
      console.log('[renderer]', message)
    })
  }

  // Open external links in the user's browser, not new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Dev-only: capture a screenshot to a file for headless visual verification.
  const capturePath = process.env['CSIDE_CAPTURE']
  if (capturePath) {
    console.log('[capture] armed ->', capturePath)
    const doCapture = async (tag: string) => {
      try {
        const img = await win.webContents.capturePage()
        await fsp.writeFile(capturePath, img.toPNG())
        console.log(`[capture] wrote (${tag}) ${capturePath}`)
      } catch (e) {
        console.log(`[capture] failed (${tag})`, (e as Error).message)
      }
    }
    win.webContents.on('did-finish-load', () => {
      console.log('[capture] did-finish-load')
      setTimeout(() => doCapture('finish+3s'), 3000)
    })
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Serve the renderer from the app:// origin (not file://) so Monaco's
    // workers and module scripts load correctly.
    win.loadURL('app://app/index.html')
  }
}

app.whenReady().then(() => {
  // No application menu: frees the Alt key for editor shortcuts (Alt+T, etc.)
  // and removes the default mnemonic bar. The app has its own toolbar.
  Menu.setApplicationMenu(null)
  registerAppProtocol()
  registerIpc()
  createWindow()

  // Diagnostic mode: never hang — quit after a hard deadline even if the
  // renderer never reports (its report handler quits sooner on success).
  if (process.env['CSIDE_DIAGNOSTIC']) {
    setTimeout(() => {
      console.log('[diag] deadline reached; quitting')
      app.quit()
    }, 45000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
