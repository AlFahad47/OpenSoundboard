import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Circle, Mic, Monitor, Pause, Play, Save, Square, Layers, Trash2 } from 'lucide-react'
import { recorder, type RecordFormat, type RecordSource } from '../audio/recorder'
import { useStore } from '../state/store'
import { formatBytes, formatPreciseTime } from '../lib/format'
import { Card, Row, Switch } from './primitives'
import { LevelMeter } from './LevelMeter'

const SOURCES: { key: RecordSource; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'mic', label: 'Microphone', hint: 'Just your voice', icon: <Mic size={15} /> },
  {
    key: 'system',
    label: 'What you hear',
    hint: 'Everything playing on this PC',
    icon: <Monitor size={15} />
  },
  { key: 'both', label: 'Both mixed', hint: 'Voice over system audio', icon: <Layers size={15} /> }
]

interface Draft {
  data: Uint8Array
  extension: string
  duration: number
  name: string
}

export function RecorderPanel(): ReactNode {
  const settings = useStore((s) => s.settings)
  const addFiles = useStore((s) => s.addFiles)
  const toast = useStore((s) => s.toast)

  const [source, setSource] = useState<RecordSource>('mic')
  const [format, setFormat] = useState<RecordFormat>('wav')
  const [autoAdd, setAutoAdd] = useState(true)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const frameRef = useRef(0)

  useEffect(() => {
    if (!running) {
      cancelAnimationFrame(frameRef.current)
      return
    }
    const tick = (): void => {
      setElapsed(recorder.elapsed())
      setLevel(recorder.level())
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [running])

  // A recording in progress must not be silently dropped when the tab unmounts.
  useEffect(() => {
    return () => {
      if (recorder.active) recorder.cancel()
    }
  }, [])

  const start = async (): Promise<void> => {
    try {
      await recorder.start(source, settings.micDeviceId)
      setRunning(true)
      setPaused(false)
      setDraft(null)
    } catch (err) {
      const message = (err as Error)?.message ?? 'Could not start recording'
      toast(
        source !== 'mic' && /denied|permission|not allow/i.test(message)
          ? 'System audio capture was cancelled'
          : message,
        'error'
      )
    }
  }

  const stop = async (): Promise<void> => {
    const result = await recorder.stop(format)
    setRunning(false)
    setPaused(false)
    setLevel(0)
    if (!result) {
      toast('Nothing was recorded', 'error')
      return
    }
    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
      .replace(/:/g, '-')
    setDraft({ ...result, name: `Recording ${stamp}` })
    if (autoAdd) await save({ ...result, name: `Recording ${stamp}` })
  }

  /**
   * The stored folder can be blank (a fresh profile, or settings reset), which
   * would resolve to the drive root and be refused. Fall back to the real Music
   * folder and remember it, so recording never fails for want of a path.
   */
  const resolveDir = async (): Promise<string> => {
    if (settings.recordingsDir) return settings.recordingsDir
    const info = await window.soundboard.app.info()
    const dir = `${info.music}\\OpenSoundboard Recordings`
    useStore.getState().updateSettings({ recordingsDir: dir })
    return dir
  }

  /** Windows rejects \ / : * ? " < > | in file names. */
  const safeName = (name: string): string =>
    name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Recording'

  const save = async (target: Draft): Promise<void> => {
    const dir = await resolveDir()
    const file = `${dir}\\${safeName(target.name)}.${target.extension}`
    const result = await window.soundboard.files.saveBuffer(file, target.data)
    if (!result.ok || !result.file) {
      toast(result.error ?? 'Could not write the recording to disk', 'error')
      return
    }
    await addFiles([result.file])
    setDraft(null)
  }

  const saveAs = async (target: Draft): Promise<void> => {
    const path = await window.soundboard.files.saveDialog(
      `${safeName(target.name)}.${target.extension}`
    )
    if (!path) return
    const result = await window.soundboard.files.saveBuffer(path, target.data)
    if (!result.ok || !result.file) {
      toast(result.error ?? 'Could not write the recording to disk', 'error')
      return
    }
    await addFiles([result.file])
    setDraft(null)
  }

  return (
    <div className="panel">
      <div className="panel__inner">
        <Card
          title="Recorder"
          subtitle="Capture your microphone, your system audio, or both together"
          icon={<Mic />}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {SOURCES.map((option) => (
              <button
                key={option.key}
                className="btn"
                disabled={running}
                onClick={() => setSource(option.key)}
                style={{
                  height: 'auto',
                  padding: '11px 10px',
                  flexDirection: 'column',
                  gap: 5,
                  ...(source === option.key
                    ? {
                        borderColor: 'var(--accent)',
                        background: 'var(--accent-soft)',
                        color: 'var(--text)'
                      }
                    : {})
                }}
              >
                {option.icon}
                <span style={{ fontSize: 12.5 }}>{option.label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)', fontWeight: 400 }}>
                  {option.hint}
                </span>
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 14px',
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-input)',
              border: `1px solid ${running ? 'var(--bad)' : 'var(--line)'}`,
              transition: 'border-color .2s'
            }}
          >
            <button
              className="tbtn tbtn--main"
              style={{
                width: 48,
                height: 48,
                background: running ? 'var(--bad)' : 'var(--accent)',
                boxShadow: running ? '0 0 22px -4px var(--bad)' : undefined
              }}
              onClick={() => (running ? void stop() : void start())}
              title={running ? 'Stop recording' : 'Start recording'}
            >
              {running ? <Square /> : <Circle fill="currentColor" />}
            </button>

            {running ? (
              <button
                className="tbtn"
                onClick={() => {
                  if (paused) recorder.resume()
                  else recorder.pause()
                  setPaused(!paused)
                }}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play /> : <Pause />}
              </button>
            ) : null}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="mono"
                style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}
              >
                {formatPreciseTime(elapsed)}
              </div>
              <div style={{ marginTop: 6 }}>
                <LevelMeter label="Level" level={level} disabled={!running || paused} />
              </div>
            </div>

            {running ? (
              <span className="pill" data-tone={paused ? 'warn' : 'bad'}>
                <span className={paused ? '' : 'pulse'}>●</span>
                {paused ? 'Paused' : 'Recording'}
              </span>
            ) : null}
          </div>

          {source !== 'mic' ? (
            <div className="row__hint">
              Windows will ask you to pick a screen to share — that is how it grants access to system
              audio. The picture is discarded immediately; only the sound is recorded.
            </div>
          ) : null}
        </Card>

        {draft ? (
          <Card title="Recording ready" subtitle={`${formatBytes(draft.data.byteLength)} captured`} icon={<Save />}>
            <Row title="Name">
              <input
                className="input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Row>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" onClick={() => void save(draft)}>
                <Save />
                Save to library
              </button>
              <button className="btn" onClick={() => void saveAs(draft)}>
                Save as…
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn btn--danger" onClick={() => setDraft(null)}>
                <Trash2 />
                Discard
              </button>
            </div>
          </Card>
        ) : null}

        <Card title="Recording options" icon={<Save />}>
          <Row title="Format" hint="WAV is uncompressed and works everywhere. WebM is much smaller.">
            <select
              className="input"
              value={format}
              disabled={running}
              onChange={(event) => setFormat(event.target.value as RecordFormat)}
            >
              <option value="wav">WAV — uncompressed</option>
              <option value="webm">WebM / Opus — compact</option>
            </select>
          </Row>
          <Switch
            title="Add to library automatically"
            hint="Saves straight into your recordings folder when you stop."
            checked={autoAdd}
            onChange={setAutoAdd}
          />
          <Row title="Recordings folder" hint={settings.recordingsDir || 'Not set'}>
            <button
              className="btn btn--sm"
              onClick={async () => {
                const folder = await window.soundboard.files.pickFolder()
                if (folder) useStore.getState().updateSettings({ recordingsDir: folder })
              }}
            >
              Change…
            </button>
          </Row>
        </Card>
      </div>
    </div>
  )
}
