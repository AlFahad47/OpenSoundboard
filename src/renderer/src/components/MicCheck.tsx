import { type ReactNode } from 'react'
import { Check, Mic, MicOff, TriangleAlert } from 'lucide-react'
import { useStore } from '../state/store'
import { useEngine, useLevels, useMicHealth } from '../hooks/useEngine'
import { LevelMeter } from './LevelMeter'

/**
 * Live proof of whether the microphone is actually producing audio.
 *
 * Without this, "my voice doesn't reach Discord" is indistinguishable from a
 * bug in the routing — the passthrough can be wired perfectly and still carry
 * silence if Windows or the headset is muting the capture.
 */
export function MicCheck(): ReactNode {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const snapshot = useEngine()
  const levels = useLevels(true)
  const health = useMicHealth(snapshot.micActive)

  const passthroughOff = !settings.micPassthrough

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }}>
          <LevelMeter label="Mic" level={levels.mic} disabled={!snapshot.micActive} />
        </span>
        <span
          className="pill"
          data-tone={health === 'ok' ? 'good' : health === 'silent' ? 'bad' : 'warn'}
        >
          {health === 'ok' ? (
            <>
              <Check size={11} /> Hearing you
            </>
          ) : health === 'silent' ? (
            <>
              <TriangleAlert size={11} /> No signal
            </>
          ) : health === 'listening' ? (
            <>
              <Mic size={11} /> Listening…
            </>
          ) : (
            <>
              <MicOff size={11} /> Mic off
            </>
          )}
        </span>
      </div>

      {health === 'silent' ? (
        <div className="cablecard" data-tone="bad">
          <TriangleAlert size={16} className="cablecard__icon" />
          <div className="cablecard__text">
            <strong>Your microphone is not producing any sound.</strong>
            <div className="cablecard__hint">
              OpenSoundboard is passing it through correctly, but nothing is arriving. Usually one of:
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, lineHeight: 1.6 }}>
                <li>The mute switch or button on the headset itself</li>
                <li>
                  Windows <strong>Settings → Privacy &amp; security → Microphone</strong>, with
                  “Let desktop apps access your microphone” turned off — Windows then feeds apps
                  silence rather than refusing
                </li>
                <li>The wrong input picked above (a headset can expose several)</li>
                <li>Windows input volume at zero, or another app holding the device exclusively</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {passthroughOff ? (
        <div className="cablecard" data-tone="warn">
          <MicOff size={16} className="cablecard__icon" />
          <div className="cablecard__text">
            <strong>Microphone passthrough is off.</strong>
            <div className="cablecard__hint">
              People will hear your sounds but not your voice.
              <button
                className="btn btn--sm btn--primary"
                style={{ marginTop: 9 }}
                onClick={() => updateSettings({ micPassthrough: true })}
              >
                <Mic />
                Turn it back on
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
