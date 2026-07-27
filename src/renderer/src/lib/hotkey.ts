/**
 * Keyboard event -> Electron accelerator.
 *
 * Electron's globalShortcut only accepts its own accelerator vocabulary, so the
 * recorder has to translate rather than store raw key codes.
 */

const CODE_MAP: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  CapsLock: 'Capslock',
  PrintScreen: 'PrintScreen',
  ScrollLock: 'Scrolllock',
  Pause: 'Pause',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

export function isModifierOnly(event: KeyboardEvent): boolean {
  return MODIFIER_CODES.has(event.code)
}

function baseKey(event: KeyboardEvent): string | null {
  const { code } = event

  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad') && /Numpad\d/.test(code)) return `num${code.slice(6)}`
  if (/^F\d{1,2}$/.test(code)) return code
  return CODE_MAP[code] ?? null
}

/** Returns null when the combination cannot be expressed as an accelerator. */
export function toAccelerator(event: KeyboardEvent): string | null {
  if (isModifierOnly(event)) return null

  const key = baseKey(event)
  if (!key) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Super')

  // A bare letter would swallow that key system-wide, so require a modifier
  // unless the user picked a function key or numpad key, which are safe alone.
  const standalone = /^F\d{1,2}$/.test(key) || key.startsWith('num')
  if (!parts.length && !standalone) return null

  parts.push(key)
  return parts.join('+')
}

export function acceleratorLabel(accelerator: string | null): string {
  return accelerator ?? 'Not set'
}
