import { useState, type ReactNode } from 'react'
import { ArrowRight, AudioLines, Cable, Check, Headphones, Mic } from 'lucide-react'
import { useStore } from '../state/store'
import { looksVirtual, useDevices } from '../hooks/useDevices'
import { Modal } from './primitives'
import { CableSetup } from './CableSetup'
import { VoiceRouting } from './VoiceRouting'

/**
 * First-run guide. The virtual-cable step is the one thing users cannot guess,
 * so it gets its own screen with an honest explanation of why it is needed.
 */
export function Onboarding({ onClose }: { onClose: () => void }): ReactNode {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [step, setStep] = useState(0)
  const devices = useDevices()

  const finish = (): void => {
    updateSettings({ onboarded: true })
    onClose()
  }

  const steps: { title: string; subtitle: string; body: ReactNode }[] = [
    {
      title: 'Welcome to OpenSoundboard',
      subtitle: 'A soundboard that plays into your microphone.',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: 96,
              borderRadius: 'var(--r-lg)',
              background:
                'linear-gradient(140deg, color-mix(in srgb, var(--accent) 28%, transparent), transparent 70%)',
              border: '1px solid var(--line)'
            }}
          >
            <AudioLines size={34} color="var(--accent)" />
          </div>
          <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            OpenSoundboard sends every sound to two places at once: your own headphones, so you can hear
            what you are doing, and a virtual audio cable that voice apps read as a microphone. Your
            real microphone is mixed in alongside, so you can keep talking.
          </p>
          <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-faint)', fontSize: 12.5 }}>
            This takes about a minute to set up. You can change any of it later in Setup.
          </p>
        </div>
      )
    },
    {
      title: 'Set up your audio cable',
      subtitle: 'One click — OpenSoundboard handles the rest.',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            To let other apps hear your sounds, Windows needs a small audio driver. OpenSoundboard can
            fetch and install the official one for you — you only have to approve the Windows
            permission prompt.
          </p>

          <CableSetup />

          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--text-faint)' }}>
            Already using VoiceMeeter or another virtual device? That works too — just pick it on the
            next step.
          </p>
        </div>
      )
    },
    {
      title: 'Choose your devices',
      subtitle: 'Where sounds go and which microphone to mix in.',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {!devices.labelled ? (
            <button
              className="btn"
              onClick={async () => {
                await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
                await devices.refresh()
              }}
            >
              <Mic />
              Allow microphone access to see device names
            </button>
          ) : null}

          <Choice
            icon={<Cable />}
            label="They hear"
            hint="Your virtual cable. Select this same device as the microphone in Discord or your game."
          >
            <select
              className="input"
              value={settings.broadcastDeviceId}
              onChange={(event) => updateSettings({ broadcastDeviceId: event.target.value })}
            >
              <option value="">Not set — only I will hear sounds</option>
              {devices.outputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {looksVirtual(device.label) ? '★ ' : ''}
                  {device.label || 'Unnamed output'}
                </option>
              ))}
            </select>
          </Choice>

          <Choice icon={<Headphones />} label="You hear" hint="Your own headphones or speakers.">
            <select
              className="input"
              value={settings.monitorDeviceId}
              onChange={(event) => updateSettings({ monitorDeviceId: event.target.value })}
            >
              <option value="default">System default</option>
              {devices.outputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Unnamed output'}
                </option>
              ))}
            </select>
          </Choice>

          <Choice icon={<Mic />} label="Your microphone" hint="Mixed into the cable so you can talk.">
            <select
              className="input"
              value={settings.micDeviceId}
              onChange={(event) => updateSettings({ micDeviceId: event.target.value })}
            >
              <option value="default">System default</option>
              {devices.inputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Unnamed input'}
                </option>
              ))}
            </select>
          </Choice>

          <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
            <VoiceRouting />
          </div>
        </div>
      )
    }
  ]

  const current = steps[step]
  const last = step === steps.length - 1

  return (
    <Modal
      title={current.title}
      subtitle={current.subtitle}
      width={520}
      onClose={finish}
      footer={
        <>
          <div style={{ display: 'flex', gap: 5, marginRight: 'auto' }}>
            {steps.map((_, index) => (
              <span
                key={index}
                style={{
                  width: index === step ? 18 : 6,
                  height: 6,
                  borderRadius: 99,
                  background: index === step ? 'var(--accent)' : 'var(--line-strong)',
                  transition: 'width .2s, background .2s'
                }}
              />
            ))}
          </div>
          {step > 0 ? (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <button className="btn" onClick={finish}>
              Skip
            </button>
          )}
          <button className="btn btn--primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Start using OpenSoundboard' : 'Continue'}
            {last ? <Check /> : <ArrowRight />}
          </button>
        </>
      }
    >
      {current.body}
    </Modal>
  )
}

function Choice({
  icon,
  label,
  hint,
  children
}: {
  icon: ReactNode
  label: string
  hint: string
  children: ReactNode
}): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 11 }}>
      <span className="card__icon" style={{ marginTop: 2 }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 560, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 7, lineHeight: 1.45 }}>
          {hint}
        </div>
        {children}
      </div>
    </div>
  )
}
