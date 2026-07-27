import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { prettyAccelerator } from '../lib/format'
import { isModifierOnly, toAccelerator } from '../lib/hotkey'

/**
 * Records a global hotkey. Global shortcuts are suspended in the main process
 * while recording, otherwise pressing an already-bound combo would fire it
 * instead of being captured.
 */
export function HotkeyInput({
  value,
  onChange,
  placeholder = 'Click to set'
}: {
  value: string | null
  onChange: (accelerator: string | null) => void
  placeholder?: string
}): ReactNode {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const recordingRef = useRef(false)

  useEffect(() => {
    recordingRef.current = recording
    void window.soundboard.hotkeys.suspend(recording)
    if (!recording) setPreview(null)
    return () => {
      if (recordingRef.current) void window.soundboard.hotkeys.suspend(false)
    }
  }, [recording])

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'Escape') {
        setRecording(false)
        return
      }
      if (event.code === 'Backspace' || event.code === 'Delete') {
        onChange(null)
        setRecording(false)
        return
      }
      if (isModifierOnly(event)) {
        // Show the modifiers building up so the box feels responsive.
        const parts: string[] = []
        if (event.ctrlKey) parts.push('Ctrl')
        if (event.altKey) parts.push('Alt')
        if (event.shiftKey) parts.push('Shift')
        if (event.metaKey) parts.push('Super')
        setPreview(parts.length ? `${parts.join(' + ')} + …` : null)
        return
      }

      const accelerator = toAccelerator(event)
      if (!accelerator) {
        setPreview('Add Ctrl, Alt or Shift')
        return
      }
      onChange(accelerator)
      setRecording(false)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (isModifierOnly(event)) setPreview(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [recording, onChange])

  const label = recording ? (preview ?? 'Press keys…') : value ? prettyAccelerator(value) : placeholder

  return (
    <div
      className="hotkeybox"
      data-recording={recording}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (!recording && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          setRecording(true)
        }
      }}
    >
      <span className="hotkeybox__value" data-empty={!value && !recording}>
        {label}
      </span>
      {value && !recording ? (
        <button
          className="hotkeybox__clear"
          aria-label="Clear hotkey"
          onClick={(event) => {
            event.stopPropagation()
            onChange(null)
          }}
        >
          <X />
        </button>
      ) : null}
    </div>
  )
}
