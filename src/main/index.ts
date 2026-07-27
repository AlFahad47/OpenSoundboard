import { app, BrowserWindow, ipcMain, shell, desktopCapturer, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '../shared/ipc'
import type { Library } from '../shared/types'
import { loadLibrary, saveLibrary } from './store'
import {
  fileExists,
  pickFiles,
  pickFolder,
  readFileBuffer,
  resolveDropped,
  reveal,
  saveBuffer,
  saveDialog,
  scanFolder,
  statFile
} from './files'
import { registerAll, setHotkeyWindow, suspend, unregisterAll, type HotkeyBinding } from './hotkeys'
import { createTray, destroyTray, iconPath } from './tray'
import { broadcastState, remoteStatus, setRemoteWindow, startRemote, stopRemote } from './remote'
import { installCable, isCableInstalled, restartWindows, setCableWindow } from './cable'
import {
  disableVoiceRouting,
  enableVoiceRouting,
  needsRestore,
  reapplyVoiceRouting,
  restoreVoiceRouting,
  voiceRoutingStatus
} from './voice-routing'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..', '..')
process.env.VITE_PUBLIC = path.join(process.env.APP_ROOT, 'build')

let win: BrowserWindow | null = null
let quitting = false
/** Mirrors the renderer's setting so the close button knows what to do. */
let closeToTray = true

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

function createWindow(): void {
  const icon = iconPath()

  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#0d0d12',
    title: 'OpenSoundboard',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Sounds are triggered by hotkeys with no click in between, so the
      // renderer must be allowed to start audio without a gesture.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => {
    win?.show()
  })

  win.on('maximize', () => win?.webContents.send(IPC.windowMaximizedChanged, true))
  win.on('unmaximize', () => win?.webContents.send(IPC.windowMaximizedChanged, false))

  win.on('close', (event) => {
    if (!quitting && closeToTray) {
      event.preventDefault()
      win?.hide()
    }
  })

  win.on('closed', () => {
    win = null
    setHotkeyWindow(null)
    setRemoteWindow(null)
    setCableWindow(null)
  })

  // External links open in the user's browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  setHotkeyWindow(win)
  setRemoteWindow(win)
  setCableWindow(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }
}

function configureSession(): void {
  const ses = session.defaultSession

  // The app needs the mic for passthrough and needs device labels to build the
  // output picker. Everything else stays denied.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  ses.setDevicePermissionHandler(() => true)

  // Enables "record what you hear": Windows loopback capture through getDisplayMedia.
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

function registerIpc(): void {
  ipcMain.handle(IPC.libraryLoad, async () => {
    const library = await loadLibrary()
    closeToTray = library.settings.closeToTray
    // Re-assert the routing the user left switched on, or undo a routing that
    // a crashed session never restored.
    void reapplyVoiceRouting(library.settings.autoRouteVoiceApps)
    return library
  })
  ipcMain.handle(IPC.librarySave, (_e, library: Library) => {
    closeToTray = library?.settings?.closeToTray ?? true
    return saveLibrary(library)
  })

  ipcMain.handle(IPC.filesPick, () => pickFiles(win))
  ipcMain.handle(IPC.filesPickFolder, () => pickFolder(win))
  ipcMain.handle(IPC.filesScanFolder, (_e, dir: string) => scanFolder(dir))
  ipcMain.handle(IPC.filesResolveDropped, (_e, paths: string[]) => resolveDropped(paths))
  ipcMain.handle(IPC.filesRead, (_e, file: string) => readFileBuffer(file))
  ipcMain.handle(IPC.filesExists, (_e, file: string) => fileExists(file))
  ipcMain.handle(IPC.filesStat, (_e, file: string) => statFile(file))
  ipcMain.handle(IPC.filesReveal, (_e, file: string) => reveal(file))
  ipcMain.handle(IPC.filesSaveDialog, (_e, name: string) => saveDialog(win, name))
  ipcMain.handle(IPC.filesSaveBuffer, (_e, file: string, data: Uint8Array) => saveBuffer(file, data))

  ipcMain.handle(IPC.hotkeysRegister, (_e, bindings: HotkeyBinding[]) => registerAll(bindings ?? []))
  ipcMain.handle(IPC.hotkeysSuspend, (_e, value: boolean) => suspend(Boolean(value)))

  ipcMain.handle(IPC.windowMinimize, () => win?.minimize())
  ipcMain.handle(IPC.windowMaximize, () => {
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowIsMaximized, () => win?.isMaximized() ?? false)
  ipcMain.handle(IPC.windowClose, () => win?.close())

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    userData: app.getPath('userData'),
    music: app.getPath('music')
  }))

  ipcMain.handle(IPC.appSetStartup, (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--minimized'] })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle(IPC.appOpenExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return null
  })

  ipcMain.handle(IPC.appRelaunch, () => {
    quitting = true
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle(IPC.voiceRouteStatus, () => voiceRoutingStatus())
  ipcMain.handle(IPC.voiceRouteEnable, () => enableVoiceRouting())
  ipcMain.handle(IPC.voiceRouteDisable, () => disableVoiceRouting())

  ipcMain.handle(IPC.cableStatus, () => isCableInstalled())
  ipcMain.handle(IPC.cableInstall, () => installCable())
  ipcMain.handle(IPC.cableRestart, () => restartWindows())

  ipcMain.handle(IPC.remoteStart, (_e, port: number, pin: string) => startRemote(port, pin))
  ipcMain.handle(IPC.remoteStop, () => {
    stopRemote()
    return true
  })
  ipcMain.handle(IPC.remoteStatus, () => remoteStatus())
  ipcMain.on(IPC.remoteState, (_e, state) => broadcastState(state))
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.opensoundboard.app')
  configureSession()
  registerIpc()
  createWindow()

  if (win) {
    createTray(win, () => {
      quitting = true
      app.quit()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else win?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * One-shot: restoreVoiceRouting() only clears the on-disk marker when it
 * succeeds, so without this a failing restore would leave needsRestore() true,
 * preventDefault the next quit as well, and trap the user in an app that cannot
 * be closed.
 */
let restoreAttempted = false

app.on('before-quit', (event) => {
  quitting = true
  // Putting the microphone back needs an async COM call, so hold the quit for
  // one pass rather than leaving the user muted in every voice app.
  if (needsRestore() && !restoreAttempted) {
    restoreAttempted = true
    event.preventDefault()
    void restoreVoiceRouting()
      .catch((err) => console.error('[main] restore failed:', err))
      .finally(() => app.quit())
  }
})

app.on('will-quit', () => {
  unregisterAll()
  stopRemote()
  destroyTray()
})
