import { useEffect, useState, type ReactNode } from 'react'
import {
  AudioLines,
  Minus,
  Square,
  Copy,
  X,
  Radio,
  TriangleAlert,
  Monitor,
  Moon,
  Sun
} from 'lucide-react'
import type { ThemeMode } from '@shared/types'
import { useEngine } from '../hooks/useEngine'
import { useStore } from '../state/store'

const THEMES: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun, label: 'Light' },
  { mode: 'dark', icon: Moon, label: 'Dark' },
  { mode: 'system', icon: Monitor, label: 'Match Windows' }
]

/** Three-state segmented control, mirroring the reference's sun/moon pill. */
function ThemeToggle(): ReactNode {
  const theme = useStore((s) => s.settings.theme)
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <div className="themetoggle">
      {THEMES.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          data-on={theme === mode}
          onClick={() => updateSettings({ theme: mode })}
          title={label}
          aria-label={label}
          aria-pressed={theme === mode}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  )
}

export function TitleBar(): ReactNode {
  const [maximized, setMaximized] = useState(false)
  const snapshot = useEngine()
  const setPanel = useStore((s) => s.setPanel)
  const conflicts = useStore((s) => s.hotkeyConflicts)

  useEffect(() => {
    void window.soundboard.window.isMaximized().then(setMaximized)
    return window.soundboard.window.onMaximizedChanged(setMaximized)
  }, [])

  const broadcasting = snapshot.broadcastReady

  return (
    <div className="titlebar">
      <div className="titlebar__brand">
        <span className="titlebar__mark">
          <AudioLines />
        </span>
        OpenSoundboard
      </div>

      <button
        className="titlebar__status"
        onClick={() => setPanel('settings')}
        title={
          broadcasting
            ? 'Sounds are being sent to your virtual cable'
            : 'No output device selected — only you can hear sounds'
        }
      >
        {broadcasting ? (
          <>
            <Radio size={12} color="var(--good)" />
            Broadcasting
          </>
        ) : (
          <>
            <TriangleAlert size={12} color="var(--warn)" />
            Local only
          </>
        )}
      </button>

      {conflicts.length ? (
        <button
          className="titlebar__status"
          onClick={() => setPanel('settings')}
          title={`These shortcuts are already taken by another app: ${conflicts.join(', ')}`}
        >
          <TriangleAlert size={12} color="var(--bad)" />
          {conflicts.length} hotkey{conflicts.length === 1 ? '' : 's'} blocked
        </button>
      ) : null}

      <div className="titlebar__spacer" />

      <ThemeToggle />

      <div className="winbtns">
        <button className="winbtn" onClick={() => window.soundboard.window.minimize()} aria-label="Minimise">
          <Minus size={15} />
        </button>
        <button
          className="winbtn"
          onClick={() => window.soundboard.window.toggleMaximize().then(setMaximized)}
          aria-label={maximized ? 'Restore' : 'Maximise'}
        >
          {maximized ? <Copy size={13} /> : <Square size={12} />}
        </button>
        <button
          className="winbtn winbtn--close"
          onClick={() => window.soundboard.window.close()}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
