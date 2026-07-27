import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type HotkeyPayload, type RemoteCommand } from '../shared/ipc'
import type { CableProgress, ImportedFile, Library, VoiceRoutingStatus } from '../shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  library: {
    load: (): Promise<Library> => ipcRenderer.invoke(IPC.libraryLoad),
    save: (library: Library): Promise<void> => ipcRenderer.invoke(IPC.librarySave, library)
  },

  files: {
    pick: (): Promise<ImportedFile[]> => ipcRenderer.invoke(IPC.filesPick),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.filesPickFolder),
    scanFolder: (dir: string): Promise<ImportedFile[]> => ipcRenderer.invoke(IPC.filesScanFolder, dir),
    resolveDropped: (paths: string[]): Promise<ImportedFile[]> =>
      ipcRenderer.invoke(IPC.filesResolveDropped, paths),
    read: (file: string): Promise<Uint8Array | null> => ipcRenderer.invoke(IPC.filesRead, file),
    exists: (file: string): Promise<boolean> => ipcRenderer.invoke(IPC.filesExists, file),
    stat: (file: string): Promise<{ size: number; mtime: number } | null> =>
      ipcRenderer.invoke(IPC.filesStat, file),
    reveal: (file: string): Promise<void> => ipcRenderer.invoke(IPC.filesReveal, file),
    saveDialog: (name: string): Promise<string | null> => ipcRenderer.invoke(IPC.filesSaveDialog, name),
    saveBuffer: (
      file: string,
      data: Uint8Array
    ): Promise<{ ok: boolean; file?: ImportedFile; error?: string }> =>
      ipcRenderer.invoke(IPC.filesSaveBuffer, file, data),
    /**
     * Chromium hides the real path on dropped File objects. webUtils is the
     * supported way to recover it, and it must run here in the preload.
     */
    pathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },

  hotkeys: {
    register: (bindings: { id: string; accelerator: string }[]): Promise<string[]> =>
      ipcRenderer.invoke(IPC.hotkeysRegister, bindings),
    suspend: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.hotkeysSuspend, value),
    onFired: (handler: (payload: HotkeyPayload) => void): Unsubscribe =>
      on<HotkeyPayload>(IPC.hotkeyFired, handler)
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowMaximize),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    onMaximizedChanged: (handler: (value: boolean) => void): Unsubscribe =>
      on<boolean>(IPC.windowMaximizedChanged, handler)
  },

  app: {
    info: (): Promise<{
      version: string
      electron: string
      chrome: string
      platform: string
      userData: string
      music: string
    }> => ipcRenderer.invoke(IPC.appInfo),
    setStartup: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.appSetStartup, enabled),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    relaunch: () => ipcRenderer.invoke(IPC.appRelaunch),
    onTrayCommand: (handler: (command: string) => void): Unsubscribe =>
      on<string>(IPC.trayCommand, handler)
  },

  cable: {
    isInstalled: (): Promise<boolean> => ipcRenderer.invoke(IPC.cableStatus),
    install: (): Promise<CableProgress> => ipcRenderer.invoke(IPC.cableInstall),
    restartWindows: (): Promise<void> => ipcRenderer.invoke(IPC.cableRestart),
    onProgress: (handler: (progress: CableProgress) => void): Unsubscribe =>
      on<CableProgress>(IPC.cableProgress, handler)
  },

  voiceRoute: {
    status: (): Promise<VoiceRoutingStatus> => ipcRenderer.invoke(IPC.voiceRouteStatus),
    enable: (): Promise<VoiceRoutingStatus> => ipcRenderer.invoke(IPC.voiceRouteEnable),
    disable: (): Promise<VoiceRoutingStatus> => ipcRenderer.invoke(IPC.voiceRouteDisable)
  },

  remote: {
    start: (port: number, pin: string): Promise<{ ok: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.remoteStart, port, pin),
    stop: (): Promise<boolean> => ipcRenderer.invoke(IPC.remoteStop),
    status: (): Promise<{ running: boolean; url: string | null; clients: number }> =>
      ipcRenderer.invoke(IPC.remoteStatus),
    pushState: (state: unknown) => ipcRenderer.send(IPC.remoteState, state),
    onCommand: (handler: (command: RemoteCommand) => void): Unsubscribe =>
      on<RemoteCommand>(IPC.remoteCommand, handler)
  }
}

contextBridge.exposeInMainWorld('soundboard', api)

export type OpenSoundboardApi = typeof api
