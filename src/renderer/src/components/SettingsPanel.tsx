import { useEffect, useState, type ReactNode } from 'react'
import {
  Cable,
  Keyboard,
  Info,
  Palette,
  RefreshCw,
  RotateCcw,
  Settings2,
  Signal,
  Sliders,
  Smartphone,
  TriangleAlert,
  Volume2
} from 'lucide-react'
import type { GlobalHotkeys, ThemeMode } from '@shared/types'
import { useStore } from '../state/store'
import { looksVirtual, useDevices } from '../hooks/useDevices'
import { useEngine } from '../hooks/useEngine'
import { decibels } from '../lib/format'
import { Card, Row, Slider, Switch } from './primitives'
import { HotkeyInput } from './HotkeyInput'
import { CableSetup } from './CableSetup'
import { VoiceRouting } from './VoiceRouting'
import { MicCheck } from './MicCheck'

const HOTKEY_LABELS: { key: keyof GlobalHotkeys; label: string; hint: string }[] = [
  { key: 'stopAll', label: 'Stop all sounds', hint: 'Panic button — silences everything at once' },
  { key: 'playPause', label: 'Pause / resume', hint: 'Freezes playback without losing position' },
  { key: 'quickSearch', label: 'Quick search', hint: 'Opens the launcher over any window' },
  { key: 'random', label: 'Play random sound', hint: 'From whatever is currently filtered' },
  { key: 'next', label: 'Next sound', hint: '' },
  { key: 'previous', label: 'Previous sound', hint: '' },
  { key: 'volumeUp', label: 'Volume up', hint: '' },
  { key: 'volumeDown', label: 'Volume down', hint: '' },
  { key: 'toggleMic', label: 'Mute / unmute microphone', hint: '' },
  { key: 'startRecording', label: 'Start / stop recording', hint: '' },
  { key: 'toggleWindow', label: 'Show / hide OpenSoundboard', hint: '' }
]

const ACCENTS = ['#7c5cff', '#4dabf7', '#22d3ee', '#51cf66', '#ffd43b', '#ff922b', '#f06595', '#ff6b6b']

export function SettingsPanel(): ReactNode {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const conflicts = useStore((s) => s.hotkeyConflicts)
  const toast = useStore((s) => s.toast)
  const setOnboarding = useStore((s) => s.setOnboarding)
  const snapshot = useEngine()
  const devices = useDevices()

  const [remote, setRemote] = useState<{ running: boolean; url: string | null; clients: number }>({
    running: false,
    url: null,
    clients: 0
  })
  const [info, setInfo] = useState<{ version: string; electron: string; chrome: string } | null>(null)

  useEffect(() => {
    void window.soundboard.remote.status().then(setRemote)
    void window.soundboard.app.info().then(setInfo)
    const timer = setInterval(() => {
      void window.soundboard.remote.status().then(setRemote)
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  const hasVirtual = devices.outputs.some((device) => looksVirtual(device.label))

  // "Connected" has to mean the chosen device is actually a cable. Reporting a
  // healthy bus was misleading when the user had picked their headphones.
  const selectedOutput = devices.outputs.find(
    (device) => device.deviceId === settings.broadcastDeviceId
  )
  const selectedIsCable = selectedOutput ? looksVirtual(selectedOutput.label) : false
  const broadcastTone = !settings.broadcastDeviceId
    ? 'warn'
    : selectedIsCable && snapshot.broadcastReady
      ? 'good'
      : 'bad'
  const broadcastLabel = !settings.broadcastDeviceId
    ? 'No cable selected'
    : !snapshot.broadcastReady
      ? 'Output unavailable'
      : selectedIsCable
        ? 'Cable connected'
        : `Not a cable — nobody will hear this${selectedOutput ? '' : ' (device missing)'}`

  const toggleRemote = async (enabled: boolean): Promise<void> => {
    updateSettings({ remoteEnabled: enabled })
    if (enabled) {
      const result = await window.soundboard.remote.start(settings.remotePort, settings.remotePin)
      if (result.ok) {
        toast(`Remote running at ${result.url}`, 'success')
      } else {
        toast(
          result.error === 'EADDRINUSE'
            ? `Port ${settings.remotePort} is already in use`
            : `Could not start the remote: ${result.error}`,
          'error'
        )
        updateSettings({ remoteEnabled: false })
      }
    } else {
      await window.soundboard.remote.stop()
    }
    setRemote(await window.soundboard.remote.status())
  }

  return (
    <div className="panel">
      <div className="panel__inner">
        {!devices.labelled ? (
          <div className="card" style={{ borderColor: 'var(--warn)' }}>
            <div className="card__body" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TriangleAlert size={18} color="var(--warn)" />
              <div style={{ flex: 1 }}>
                <div className="row__title">Device names are hidden</div>
                <div className="row__hint">
                  Windows only reveals audio device names after microphone access is granted once.
                </div>
              </div>
              <button
                className="btn btn--sm"
                onClick={async () => {
                  await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
                  await devices.refresh()
                }}
              >
                Grant access
              </button>
            </div>
          </div>
        ) : null}

        <Card
          title="Audio routing"
          subtitle="Where sounds go, and which microphone gets mixed in"
          icon={<Cable />}
          action={
            <button className="btn btn--sm btn--icon" onClick={() => void devices.refresh()} title="Refresh devices">
              <RefreshCw />
            </button>
          }
        >
          <Row
            title="They hear (virtual cable)"
            hint="Pick your virtual cable here, then select the same cable as the microphone inside Discord, games or OBS."
          >
            <select
              className="input"
              value={settings.broadcastDeviceId}
              onChange={(event) => updateSettings({ broadcastDeviceId: event.target.value })}
            >
              <option value="">Not set — local only</option>
              {devices.outputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {looksVirtual(device.label) ? '★ ' : ''}
                  {device.label || 'Unnamed output'}
                </option>
              ))}
            </select>
          </Row>

          {!hasVirtual && devices.labelled ? <CableSetup /> : null}

          <Row title="You hear (monitor)" hint="Your own headphones or speakers.">
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
          </Row>

          <Row title="Microphone" hint="Mixed into the cable so you can talk over your sounds.">
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
          </Row>

          <MicCheck />

          <VoiceRouting />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
            <span className="pill" data-tone={broadcastTone}>
              <Signal size={11} />
              {broadcastLabel}
            </span>
            <span className="pill" data-tone={snapshot.micActive ? 'good' : 'warn'}>
              <Volume2 size={11} />
              {snapshot.micActive ? 'Microphone live' : snapshot.micError ?? 'Microphone off'}
            </span>
          </div>
        </Card>

        <Card title="Mixing" subtitle="Levels and how the mic behaves while sounds play" icon={<Sliders />}>
          <Row title="Master volume" hint={decibels(settings.masterVolume)}>
            <Slider
              value={settings.masterVolume}
              min={0}
              max={1.5}
              onChange={(value) => updateSettings({ masterVolume: value })}
              aria-label="Master volume"
            />
          </Row>
          <Row title="Your monitor level" hint="Only affects what you hear.">
            <Slider
              value={settings.monitorVolume}
              min={0}
              max={1.5}
              onChange={(value) => updateSettings({ monitorVolume: value })}
              aria-label="Monitor volume"
            />
          </Row>
          <Row title="Cable level" hint="Only affects what others hear.">
            <Slider
              value={settings.broadcastVolume}
              min={0}
              max={1.5}
              onChange={(value) => updateSettings({ broadcastVolume: value })}
              aria-label="Cable volume"
            />
          </Row>
          <Row title="Microphone level" hint={decibels(settings.micVolume)}>
            <Slider
              value={settings.micVolume}
              min={0}
              max={2}
              onChange={(value) => updateSettings({ micVolume: value })}
              aria-label="Microphone volume"
            />
          </Row>

          <Switch
            title="Pass my microphone through"
            hint="Required if you want people to hear you as well as your sounds."
            checked={settings.micPassthrough}
            onChange={(value) => updateSettings({ micPassthrough: value })}
          />
          <Switch
            title="Hear myself"
            hint="Mixes your mic into your own headphones. Handy for checking levels."
            checked={settings.micMonitor}
            onChange={(value) => updateSettings({ micMonitor: value })}
          />
          <Switch
            title="Duck the microphone under sounds"
            hint="Quietens your mic while a sound plays so the sound stays clear."
            checked={settings.ducking}
            onChange={(value) => updateSettings({ ducking: value })}
          />
          {settings.ducking ? (
            <Row title="Duck amount" hint={`Mic drops to ${Math.round((1 - settings.duckAmount) * 100)}%`}>
              <Slider
                value={settings.duckAmount}
                min={0}
                max={1}
                onChange={(value) => updateSettings({ duckAmount: value })}
                aria-label="Duck amount"
              />
            </Row>
          ) : null}
        </Card>

        <Card title="Playback" subtitle="How sounds behave when triggered" icon={<Settings2 />}>
          <Switch
            title="Normalise loudness"
            hint="Evens out quiet and loud clips so nothing blows anyone's ears out."
            checked={settings.normalize}
            onChange={(value) => updateSettings({ normalize: value })}
          />
          <Switch
            title="One sound at a time"
            hint="Starting a sound stops whatever is already playing."
            checked={settings.exclusivePlayback}
            onChange={(value) => updateSettings({ exclusivePlayback: value })}
          />
          <Switch
            title="Preview on my headphones only"
            hint="Middle-click a pad to audition it without anyone else hearing."
            checked={settings.previewOnMonitor}
            onChange={(value) => updateSettings({ previewOnMonitor: value })}
          />
          <Row title="Stop fade" hint={`${settings.stopFade} ms — avoids a hard click when stopping.`}>
            <Slider
              value={settings.stopFade}
              min={0}
              max={400}
              step={10}
              onChange={(value) => updateSettings({ stopFade: value })}
              aria-label="Stop fade"
            />
          </Row>
        </Card>

        <Card
          title="Global hotkeys"
          subtitle="These work even when OpenSoundboard is behind another window"
          icon={<Keyboard />}
        >
          <Switch
            title="Enable global hotkeys"
            checked={settings.hotkeysEnabled}
            onChange={(value) => updateSettings({ hotkeysEnabled: value })}
          />

          {conflicts.length ? (
            <div className="pill" data-tone="bad" style={{ alignSelf: 'flex-start' }}>
              <TriangleAlert size={11} />
              Blocked by another app: {conflicts.join(', ')}
            </div>
          ) : null}

          {HOTKEY_LABELS.map(({ key, label, hint }) => (
            <Row key={key} title={label} hint={hint}>
              <HotkeyInput
                value={settings.globalHotkeys[key]}
                onChange={(accelerator) =>
                  updateSettings({
                    globalHotkeys: { ...settings.globalHotkeys, [key]: accelerator }
                  })
                }
              />
            </Row>
          ))}
        </Card>

        <Card
          title="Phone remote"
          subtitle="Drive the board from any phone on the same Wi-Fi"
          icon={<Smartphone />}
        >
          <Switch
            title="Enable remote control"
            hint="Serves a small web page on your local network. Nothing leaves your machine."
            checked={settings.remoteEnabled}
            onChange={(value) => void toggleRemote(value)}
          />
          <Row title="Port" hint="Change if something else already uses this port.">
            <input
              className="input"
              type="number"
              min={1024}
              max={65535}
              value={settings.remotePort}
              onChange={(event) => updateSettings({ remotePort: Number(event.target.value) })}
            />
          </Row>
          <Row title="PIN" hint="Optional. Anyone on your network can connect without one.">
            <input
              className="input"
              value={settings.remotePin}
              placeholder="No PIN"
              maxLength={8}
              onChange={(event) => updateSettings({ remotePin: event.target.value.replace(/\D/g, '') })}
            />
          </Row>
          {remote.running && remote.url ? (
            <div
              style={{
                padding: 11,
                borderRadius: 'var(--r-md)',
                background: 'var(--bg-input)',
                border: '1px solid var(--line)',
                fontSize: 12
              }}
            >
              Open <strong className="mono">{remote.url}</strong> on your phone.
              <div className="row__hint" style={{ marginTop: 3 }}>
                {remote.clients} device{remote.clients === 1 ? '' : 's'} connected
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="Appearance & system" icon={<Palette />}>
          <Row title="Theme" hint="Match Windows follows your system light/dark setting.">
            <select
              className="input"
              value={settings.theme}
              onChange={(event) => updateSettings({ theme: event.target.value as ThemeMode })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match Windows</option>
            </select>
          </Row>
          <Row title="Accent colour" hint="Used across the interface.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  onClick={() => updateSettings({ accent })}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    background: accent,
                    boxShadow:
                      settings.accent === accent
                        ? `0 0 0 2px var(--bg-panel), 0 0 0 4px ${accent}`
                        : 'none'
                  }}
                  aria-label={accent}
                />
              ))}
            </div>
          </Row>
          <Switch
            title="Show the side panel"
            hint="Most played, recently added, live meters and your hotkeys."
            checked={settings.showRail}
            onChange={(value) => updateSettings({ showRail: value })}
          />
          <Switch
            title="Close to tray"
            hint="The close button hides OpenSoundboard instead of quitting it."
            checked={settings.closeToTray}
            onChange={(value) => updateSettings({ closeToTray: value })}
          />
          <Switch
            title="Start with Windows"
            checked={settings.launchOnStartup}
            onChange={(value) => updateSettings({ launchOnStartup: value })}
          />
        </Card>

        <Card title="About" icon={<Info />}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            OpenSoundboard {info?.version ? `v${info.version}` : ''} · Electron {info?.electron} · Chromium{' '}
            {info?.chrome}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--sm" onClick={() => setOnboarding(true)}>
              Run setup guide again
            </button>
            <button className="btn btn--sm btn--danger" onClick={resetSettings}>
              <RotateCcw />
              Reset all settings
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
