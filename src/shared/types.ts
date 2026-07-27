/** Types shared between the main process, the preload bridge and the renderer. */

export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'm4a',
  'aac',
  'mp4',
  'webm',
  'weba',
  'wma',
  'aiff',
  'aif'
] as const

export interface Sound {
  id: string
  /** Absolute path on disk. */
  path: string
  name: string
  categoryId: string | null
  tags: string[]
  /** Electron accelerator string, e.g. "Ctrl+Shift+1". Null when unbound. */
  hotkey: string | null
  /** Linear gain multiplier, 0..2. 1 = unity. */
  volume: number
  /** Semitones, -24..24. */
  pitch: number
  /** Playback rate multiplier, 0.25..4. */
  speed: number
  /** Hex colour used for the pad. Null falls back to a hash of the id. */
  color: string | null
  /** Seconds. 0 until the file has been probed. */
  duration: number
  /** Trim points in seconds. trimEnd of 0 means "until the end". */
  trimStart: number
  trimEnd: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  favorite: boolean
  playCount: number
  lastPlayed: number | null
  addedAt: number
  /** Set when the file could not be found on the last scan. */
  missing: boolean
  /** Bytes, used for duplicate detection. */
  size: number
}

export interface Category {
  id: string
  name: string
  color: string
  /** lucide-react icon name. */
  icon: string
  order: number
}

export type ThemeMode = 'system' | 'dark' | 'light'
export type ViewMode = 'grid' | 'list'
export type SortKey = 'custom' | 'name' | 'recent' | 'plays' | 'duration' | 'added'
export type PadSize = 'sm' | 'md' | 'lg'

export interface GlobalHotkeys {
  stopAll: string | null
  playPause: string | null
  next: string | null
  previous: string | null
  volumeUp: string | null
  volumeDown: string | null
  quickSearch: string | null
  random: string | null
  toggleMic: string | null
  toggleWindow: string | null
  startRecording: string | null
}

export interface Settings {
  /** Device the user hears sounds on (their own headphones/speakers). */
  monitorDeviceId: string
  /** Virtual-cable device that other people hear. */
  broadcastDeviceId: string
  /** Physical microphone captured for passthrough. */
  micDeviceId: string

  masterVolume: number
  monitorVolume: number
  broadcastVolume: number
  micVolume: number

  micPassthrough: boolean
  /** Hear your own mic in your monitor output. */
  micMonitor: boolean
  /** Duck the mic while a sound is playing so the sound stays intelligible. */
  ducking: boolean
  duckAmount: number
  duckAttack: number
  duckRelease: number

  /** Peak-normalise every sound to a common target. */
  normalize: boolean
  normalizeTarget: number
  /** Milliseconds of fade applied when a sound is stopped early. */
  stopFade: number
  /** Only one sound at a time. */
  exclusivePlayback: boolean
  /** Preview (double-click) plays on the monitor only. */
  previewOnMonitor: boolean

  hotkeysEnabled: boolean
  globalHotkeys: GlobalHotkeys
  /** Hold the hotkey to play, release to stop. */
  holdToPlay: boolean

  theme: ThemeMode
  view: ViewMode
  padSize: PadSize
  sort: SortKey
  accent: string
  showWaveform: boolean
  /** Right-hand rail with most played, recently added and live meters. */
  showRail: boolean

  minimizeToTray: boolean
  closeToTray: boolean
  launchOnStartup: boolean
  startMinimized: boolean

  /**
   * Point Windows' default communications microphone at the cable so voice apps
   * need no setup. Restored when OpenSoundboard exits.
   */
  autoRouteVoiceApps: boolean

  remoteEnabled: boolean
  remotePort: number
  remotePin: string

  recordingsDir: string
  /** Set once the first-run wizard has been dismissed. */
  onboarded: boolean
}

export interface Library {
  version: number
  sounds: Sound[]
  categories: Category[]
  settings: Settings
}

/** A file the main process handed us to import. */
export interface ImportedFile {
  path: string
  name: string
  size: number
}

export type CableStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'reboot-required'
  | 'cancelled'
  | 'error'

export interface CableProgress {
  stage: CableStage
  percent: number
  message: string
}

export interface VoiceRoutingStatus {
  supported: boolean
  active: boolean
  cableName: string | null
  restoreName: string | null
  error: string | null
}

export interface AudioDeviceHint {
  /** Best-guess virtual cable device label found on the system. */
  label: string
  kind: 'cable' | 'voicemeeter' | 'unknown'
}

export const DEFAULT_HOTKEYS: GlobalHotkeys = {
  stopAll: 'Ctrl+Alt+S',
  playPause: 'Ctrl+Alt+Space',
  next: 'Ctrl+Alt+Right',
  previous: 'Ctrl+Alt+Left',
  volumeUp: 'Ctrl+Alt+Up',
  volumeDown: 'Ctrl+Alt+Down',
  quickSearch: 'Ctrl+Alt+F',
  random: 'Ctrl+Alt+R',
  toggleMic: 'Ctrl+Alt+M',
  toggleWindow: 'Ctrl+Alt+Q',
  startRecording: 'Ctrl+Alt+E'
}

export const DEFAULT_SETTINGS: Settings = {
  monitorDeviceId: 'default',
  broadcastDeviceId: '',
  micDeviceId: 'default',

  masterVolume: 1,
  monitorVolume: 0.8,
  broadcastVolume: 1,
  micVolume: 1,

  micPassthrough: true,
  micMonitor: false,
  ducking: true,
  duckAmount: 0.45,
  duckAttack: 80,
  duckRelease: 320,

  normalize: false,
  normalizeTarget: 0.89,
  stopFade: 60,
  exclusivePlayback: false,
  previewOnMonitor: true,

  hotkeysEnabled: true,
  globalHotkeys: DEFAULT_HOTKEYS,
  holdToPlay: false,

  theme: 'dark',
  view: 'grid',
  padSize: 'md',
  sort: 'custom',
  accent: '#e8334a',
  showWaveform: true,
  showRail: true,

  minimizeToTray: false,
  closeToTray: true,
  launchOnStartup: false,
  startMinimized: false,

  autoRouteVoiceApps: false,

  remoteEnabled: false,
  remotePort: 8377,
  remotePin: '',

  recordingsDir: '',
  onboarded: false
}

export function createDefaultLibrary(): Library {
  return {
    version: 1,
    sounds: [],
    categories: [
      { id: 'cat-memes', name: 'Memes', color: '#ff6b6b', icon: 'Laugh', order: 0 },
      { id: 'cat-music', name: 'Music', color: '#4dabf7', icon: 'Music', order: 1 },
      { id: 'cat-fx', name: 'Effects', color: '#51cf66', icon: 'Zap', order: 2 },
      { id: 'cat-voice', name: 'Voice', color: '#ffd43b', icon: 'Mic', order: 3 }
    ],
    settings: { ...DEFAULT_SETTINGS, globalHotkeys: { ...DEFAULT_HOTKEYS } }
  }
}
