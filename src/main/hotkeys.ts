import { globalShortcut, type BrowserWindow } from 'electron'
import { IPC, type HotkeyPayload } from '../shared/ipc'

export interface HotkeyBinding {
  /** "sound:<id>" or "global:<action>" */
  id: string
  accelerator: string
}

let registered: HotkeyBinding[] = []
let suspended = false
let targetWindow: BrowserWindow | null = null

export function setHotkeyWindow(win: BrowserWindow | null): void {
  targetWindow = win
}

function fire(id: string): void {
  const payload: HotkeyPayload = { id, phase: 'down' }
  targetWindow?.webContents.send(IPC.hotkeyFired, payload)
}

/**
 * Replaces every registration in one shot.
 * Returns the accelerators that the OS refused — usually because another app owns them.
 */
export function registerAll(bindings: HotkeyBinding[]): string[] {
  globalShortcut.unregisterAll()
  registered = bindings
  if (suspended) return []

  const failed: string[] = []
  const seen = new Set<string>()

  for (const binding of bindings) {
    const accel = binding.accelerator?.trim()
    if (!accel) continue
    // First binding wins if the user assigned the same combo twice.
    if (seen.has(accel.toLowerCase())) {
      failed.push(accel)
      continue
    }
    seen.add(accel.toLowerCase())
    try {
      const ok = globalShortcut.register(accel, () => fire(binding.id))
      if (!ok) failed.push(accel)
    } catch {
      failed.push(accel)
    }
  }
  return failed
}

/** Used while the user is recording a new hotkey, so we don't swallow their keystrokes. */
export function suspend(value: boolean): void {
  suspended = value
  if (value) {
    globalShortcut.unregisterAll()
  } else {
    registerAll(registered)
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll()
  registered = []
}
