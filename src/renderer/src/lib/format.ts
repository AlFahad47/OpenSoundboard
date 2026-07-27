export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Clip length for pads and rows. Soundboards are full of sub-second stings, and
 * m:ss collapses all of them to "0:00", so short clips get a decimal instead.
 */
export function formatLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return formatTime(seconds)
}

export function formatPreciseTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatRelative(timestamp: number | null): string {
  if (!timestamp) return 'Never'
  const delta = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return 'Just now'
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/** Turns an Electron accelerator into something readable on a key cap. */
export function prettyAccelerator(accelerator: string | null): string {
  if (!accelerator) return ''
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return 'Ctrl'
        case 'Control':
          return 'Ctrl'
        case 'Alt':
          return 'Alt'
        case 'Shift':
          return 'Shift'
        case 'Super':
          return 'Win'
        case 'Space':
          return 'Space'
        case 'Left':
          return '←'
        case 'Right':
          return '→'
        case 'Up':
          return '↑'
        case 'Down':
          return '↓'
        default:
          return part
      }
    })
    .join(' + ')
}

export function decibels(gain: number): string {
  if (gain <= 0.0001) return '-∞'
  const db = 20 * Math.log10(gain)
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/** Percentage of a range, for CSS slider fills. */
export function fillPercent(value: number, min: number, max: number): string {
  const pct = ((value - min) / (max - min)) * 100
  return `${Math.max(0, Math.min(100, pct))}%`
}
