import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  TriangleAlert
} from 'lucide-react'
import type { CableProgress } from '@shared/types'
import { useStore } from '../state/store'
import { bestCable, useDevices } from '../hooks/useDevices'

/**
 * The virtual cable step, reduced to one button.
 *
 * Shared by the first-run guide and Setup so both always show the same state.
 */
export function CableSetup({ compact = false }: { compact?: boolean }): ReactNode {
  const devices = useDevices()
  const toast = useStore((s) => s.toast)
  const [progress, setProgress] = useState<CableProgress | null>(null)
  const [busy, setBusy] = useState(false)

  const found = bestCable(devices.outputs)

  useEffect(() => window.soundboard.cable.onProgress(setProgress), [])

  const install = async (): Promise<void> => {
    setBusy(true)
    setProgress({ stage: 'downloading', percent: 1, message: 'Starting…' })
    try {
      const result = await window.soundboard.cable.install()
      setProgress(result)
      if (result.stage === 'installed') {
        await devices.refresh()
        toast('Virtual audio cable installed', 'success')
      }
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------------ found

  if (found) {
    return (
      <div className="cablecard" data-tone="good">
        <Check size={16} className="cablecard__icon" />
        <div className="cablecard__text">
          <strong>{found.label}</strong> is ready to use.
          {!compact ? (
            <div className="cablecard__hint">
              OpenSoundboard will send sounds here. In Discord, your game or OBS, pick the matching{' '}
              <strong>CABLE Output</strong> as the microphone.
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------- in progress

  const stage = progress?.stage
  const working = busy || stage === 'downloading' || stage === 'extracting' || stage === 'verifying' || stage === 'installing'

  if (working) {
    return (
      <div className="cablecard" data-tone="busy">
        <Loader2 size={16} className="cablecard__icon spin" />
        <div className="cablecard__text">
          <strong>{progress?.message ?? 'Working…'}</strong>
          <div className="cableprogress">
            <div className="cableprogress__fill" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          {stage === 'verifying' ? (
            <div className="cablecard__hint">
              <ShieldCheck size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
              Confirming the driver is signed by VB-Audio before running it.
            </div>
          ) : stage === 'installing' ? (
            <div className="cablecard__hint">
              Windows will ask for permission — choose <strong>Yes</strong>.
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------ needs reboot

  if (stage === 'reboot-required') {
    return (
      <div className="cablecard" data-tone="warn">
        <RotateCw size={16} className="cablecard__icon" />
        <div className="cablecard__text">
          <strong>Almost done — Windows needs a restart.</strong>
          <div className="cablecard__hint">
            Audio drivers only load at startup. OpenSoundboard will pick the cable up automatically
            afterwards.
          </div>
          <div className="cablecard__actions">
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void window.soundboard.cable.restartWindows()}
            >
              <RotateCw />
              Restart now
            </button>
            <button className="btn btn--sm" onClick={() => setProgress(null)}>
              I&apos;ll restart later
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------ failed

  const failed = stage === 'error' || stage === 'cancelled'

  return (
    <div className="cablecard" data-tone={failed ? 'bad' : 'neutral'}>
      {failed ? (
        <TriangleAlert size={16} className="cablecard__icon" />
      ) : (
        <Download size={16} className="cablecard__icon" />
      )}
      <div className="cablecard__text">
        <strong>
          {failed ? progress?.message : 'Install the virtual audio cable'}
        </strong>
        <div className="cablecard__hint">
          {failed
            ? 'You can try again, or install it by hand from the VB-Audio site.'
            : 'One click. OpenSoundboard downloads the official VB-Audio driver, checks its signature and installs it for you. Windows will ask for permission once.'}
        </div>
        <div className="cablecard__actions">
          <button className="btn btn--sm btn--primary" onClick={() => void install()}>
            {failed ? <RefreshCw /> : <Download />}
            {failed ? 'Try again' : 'Install automatically'}
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void window.soundboard.app.openExternal('https://vb-audio.com/Cable/')}
          >
            <ExternalLink />
            Install manually
          </button>
          <button className="btn btn--sm" onClick={() => void devices.refresh()} title="Re-scan devices">
            <RefreshCw />
          </button>
        </div>
      </div>
    </div>
  )
}
