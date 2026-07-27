import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Loader2, TriangleAlert, Wand2 } from 'lucide-react'
import type { VoiceRoutingStatus } from '@shared/types'
import { useStore } from '../state/store'
import { Switch } from './primitives'

/**
 * The toggle that removes the last manual step. With it on, Discord/games that
 * are set to their default microphone pick OpenSoundboard up with no configuration.
 */
export function VoiceRouting(): ReactNode {
  const enabled = useStore((s) => s.settings.autoRouteVoiceApps)
  const updateSettings = useStore((s) => s.updateSettings)
  const toast = useStore((s) => s.toast)

  const [status, setStatus] = useState<VoiceRoutingStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await window.soundboard.voiceRoute.status())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = next
        ? await window.soundboard.voiceRoute.enable()
        : await window.soundboard.voiceRoute.disable()
      setStatus(result)

      if (next && !result.active) {
        toast(result.error ?? 'Could not switch your microphone over', 'error')
        updateSettings({ autoRouteVoiceApps: false })
        return
      }

      updateSettings({ autoRouteVoiceApps: next })
      toast(
        next
          ? 'Voice apps will now hear OpenSoundboard automatically'
          : 'Your normal microphone has been put back',
        'success'
      )
    } finally {
      setBusy(false)
    }
  }

  if (status && !status.supported) return null

  const unavailable = Boolean(status?.error) && !enabled

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Switch
        title="Set this up in Discord and games for me"
        hint={
          unavailable
            ? 'Install the audio cable first — there is nothing to switch to yet.'
            : 'Points Windows at the cable so voice apps need no setup. Your normal microphone is put back when you close OpenSoundboard.'
        }
        checked={enabled && Boolean(status?.active)}
        disabled={busy || unavailable}
        onChange={(value) => void toggle(value)}
      />

      {busy ? (
        <div className="cablecard" data-tone="busy">
          <Loader2 size={16} className="cablecard__icon spin" />
          <div className="cablecard__text">Switching your microphone over…</div>
        </div>
      ) : enabled && status?.active ? (
        <div className="cablecard" data-tone="good">
          <Check size={16} className="cablecard__icon" />
          <div className="cablecard__text">
            <strong>Nothing else to configure.</strong>
            <div className="cablecard__hint">
              Windows is sending <strong>{status.cableName}</strong> to any app using its default
              microphone — that covers Discord, most games and OBS out of the box.
              {status.restoreName ? (
                <>
                  {' '}
                  <strong>{status.restoreName}</strong> comes back when you close OpenSoundboard.
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : status?.error && !unavailable ? (
        <div className="cablecard" data-tone="warn">
          <TriangleAlert size={16} className="cablecard__icon" />
          <div className="cablecard__text">{status.error}</div>
        </div>
      ) : !enabled ? (
        <div className="cablecard" data-tone="neutral">
          <Wand2 size={16} className="cablecard__icon" />
          <div className="cablecard__text">
            <strong>Or set it yourself</strong>
            <div className="cablecard__hint">
              Leave this off and pick <strong>{status?.cableName ?? 'CABLE Output'}</strong> as the
              microphone inside each app instead.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
