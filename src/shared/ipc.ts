/** Channel names for main <-> renderer traffic. Keeping them in one place stops typos. */
export const IPC = {
  // library persistence
  libraryLoad: 'library:load',
  librarySave: 'library:save',

  // files
  filesPick: 'files:pick',
  filesPickFolder: 'files:pick-folder',
  filesScanFolder: 'files:scan-folder',
  filesResolveDropped: 'files:resolve-dropped',
  filesRead: 'files:read',
  filesExists: 'files:exists',
  filesReveal: 'files:reveal',
  filesSaveBuffer: 'files:save-buffer',
  filesSaveDialog: 'files:save-dialog',
  filesStat: 'files:stat',

  // hotkeys
  hotkeysRegister: 'hotkeys:register',
  hotkeysSuspend: 'hotkeys:suspend',
  hotkeyFired: 'hotkey:fired',

  // window
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed',

  // app / system
  appInfo: 'app:info',
  appSetStartup: 'app:set-startup',
  appOpenExternal: 'app:open-external',
  appRelaunch: 'app:relaunch',

  // virtual audio cable setup
  cableStatus: 'cable:status',
  cableInstall: 'cable:install',
  cableProgress: 'cable:progress',
  cableRestart: 'cable:restart',

  // routing voice apps through the cable automatically
  voiceRouteStatus: 'voice-route:status',
  voiceRouteEnable: 'voice-route:enable',
  voiceRouteDisable: 'voice-route:disable',

  // remote control
  remoteStart: 'remote:start',
  remoteStop: 'remote:stop',
  remoteStatus: 'remote:status',
  remoteCommand: 'remote:command',
  remoteState: 'remote:state',

  // tray / misc renderer events
  trayCommand: 'tray:command',
  deepLinkFiles: 'app:files-opened'
} as const

export type HotkeyPayload = {
  /** "sound:<id>" or "global:<action>" */
  id: string
  /** keydown for press, keyup only when hold-to-play is on. */
  phase: 'down' | 'up'
}

export type RemoteCommand =
  | { type: 'play'; id: string }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'volume'; value: number }
  | { type: 'random' }
  | { type: 'sync' }
