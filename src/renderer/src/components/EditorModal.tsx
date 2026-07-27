import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  FlipHorizontal2,
  Gauge,
  Loader2,
  Play,
  Save,
  Scissors,
  Square,
  Undo2,
  Wand2
} from 'lucide-react'
import type { Sound } from '@shared/types'
import { channelsOf, decodeFile, peaksFromChannels } from '../audio/decoder'
import {
  cloneClip,
  clipDuration,
  fade,
  fillBuffer,
  normalize,
  resample,
  reverse,
  trim,
  trimSilence,
  type Clip
} from '../audio/editor'
import { encodeWav } from '../audio/wav'
import { colorOf, useStore } from '../state/store'
import { formatPreciseTime } from '../lib/format'
import { Field, Modal, Slider } from './primitives'

/**
 * Two ways out of this dialog:
 *   "Apply trim"  — stores in/out points on the sound, touching nothing on disk.
 *   "Save as new" — renders the processed audio to a new WAV in the library.
 */
export function EditorModal({ sound, onClose }: { sound: Sound; onClose: () => void }): ReactNode {
  const updateSound = useStore((s) => s.updateSound)
  const addFiles = useStore((s) => s.addFiles)
  const toast = useStore((s) => s.toast)

  const [original, setOriginal] = useState<Clip | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [selection, setSelection] = useState({ start: 0, end: 1 })
  const [fadeIn, setFadeIn] = useState(sound.fadeIn)
  const [fadeOut, setFadeOut] = useState(sound.fadeOut)
  const [speed, setSpeed] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const previewCtx = useRef<AudioContext | null>(null)
  const previewNode = useRef<AudioBufferSourceNode | null>(null)

  const color = colorOf(sound)

  useEffect(() => {
    let cancelled = false
    void decodeFile(sound.id, sound.path).then((decoded) => {
      if (cancelled || !decoded) {
        if (!decoded) toast('Could not read that file for editing', 'error')
        return
      }
      const loaded: Clip = {
        channels: channelsOf(decoded).map((channel) => channel.slice()),
        sampleRate: decoded.sampleRate
      }
      setOriginal(loaded)
      setClip(loaded)
      const total = clipDuration(loaded)
      setSelection({
        start: total ? sound.trimStart / total : 0,
        end: total && sound.trimEnd > sound.trimStart ? sound.trimEnd / total : 1
      })
    })
    return () => {
      cancelled = true
    }
  }, [sound.id, sound.path, sound.trimStart, sound.trimEnd, toast])

  useEffect(() => {
    return () => {
      previewNode.current?.stop()
      previewCtx.current?.close().catch(() => {})
    }
  }, [])

  const duration = clip ? clipDuration(clip) : 0
  const peaks = useMemo(() => (clip ? peaksFromChannels(clip.channels, 700) : null), [clip])

  // ------------------------------------------------------------ waveform draw

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = 132
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const buckets = peaks.length / 2
    const bar = 2
    const gap = 1
    const columns = Math.max(1, Math.floor(width / (bar + gap)))
    const mid = height / 2

    for (let i = 0; i < columns; i++) {
      const ratio = i / columns
      const bucket = Math.min(buckets - 1, Math.floor(ratio * buckets))
      const amplitude = Math.max(Math.abs(peaks[bucket * 2]), Math.abs(peaks[bucket * 2 + 1]))
      const h = Math.max(2, amplitude * (height - 14))
      const inside = ratio >= selection.start && ratio <= selection.end
      ctx.fillStyle = inside ? color : 'rgba(255,255,255,0.11)'
      ctx.fillRect(i * (bar + gap), mid - h / 2, bar, h)
    }
  }, [peaks, selection, color])

  // --------------------------------------------------------------- selection

  const ratioFromEvent = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const ratio = ratioFromEvent(event.clientX)
      setSelection((current) =>
        dragging === 'start'
          ? { ...current, start: Math.min(ratio, current.end - 0.005) }
          : { ...current, end: Math.max(ratio, current.start + 0.005) }
      )
    }
    const up = (): void => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, ratioFromEvent])

  // ----------------------------------------------------------------- preview

  const stopPreview = useCallback((): void => {
    try {
      previewNode.current?.stop()
    } catch {
      /* already stopped */
    }
    previewNode.current = null
    setPlaying(false)
  }, [])

  const preview = async (): Promise<void> => {
    if (!clip) return
    if (playing) {
      stopPreview()
      return
    }

    if (!previewCtx.current) previewCtx.current = new AudioContext()
    const ctx = previewCtx.current
    if (ctx.state === 'suspended') await ctx.resume()

    const start = selection.start * duration
    const end = selection.end * duration
    const region = fade(trim(clip, start, end), fadeIn, fadeOut)

    const buffer = ctx.createBuffer(
      region.channels.length,
      region.channels[0].length,
      region.sampleRate
    )
    fillBuffer(buffer, region.channels)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = speed
    try {
      source.detune.value = pitch * 100
    } catch {
      /* optional */
    }
    source.connect(ctx.destination)
    source.onended = () => {
      previewNode.current = null
      setPlaying(false)
    }
    source.start()
    previewNode.current = source
    setPlaying(true)
  }

  // ------------------------------------------------------------- destructive

  const mutate = async (operation: (input: Clip) => Clip | Promise<Clip>): Promise<void> => {
    if (!clip) return
    setBusy(true)
    stopPreview()
    try {
      const next = await operation(clip)
      setClip(next)
      setSelection({ start: 0, end: 1 })
    } finally {
      setBusy(false)
    }
  }

  const applyTrim = (): void => {
    const start = selection.start * duration
    const end = selection.end * duration
    updateSound(sound.id, {
      trimStart: Number(start.toFixed(3)),
      trimEnd: Number(end.toFixed(3)),
      fadeIn,
      fadeOut,
      speed,
      pitch
    })
    toast('Trim and effects applied', 'success')
    onClose()
  }

  const saveAsNew = async (): Promise<void> => {
    if (!clip) return
    setBusy(true)
    stopPreview()
    try {
      let output = trim(clip, selection.start * duration, selection.end * duration)
      output = fade(output, fadeIn, fadeOut)
      if (speed !== 1 || pitch !== 0) output = await resample(output, speed, pitch)

      const data = encodeWav(output)
      const suggested = `${sound.name} (edited).wav`
      const path = await window.soundboard.files.saveDialog(suggested)
      if (!path) return

      const result = await window.soundboard.files.saveBuffer(path, data)
      if (!result.ok || !result.file) {
        toast(result.error ?? 'Could not save the edited file', 'error')
        return
      }
      await addFiles([{ ...result.file, name: `${sound.name} (edited)` }], sound.categoryId)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const selectionSeconds = {
    start: selection.start * duration,
    end: selection.end * duration
  }

  return (
    <Modal
      title={`Edit — ${sound.name}`}
      subtitle="Trim and shape the clip. Nothing is written to disk unless you save a new file."
      width={720}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || !clip} onClick={() => void saveAsNew()}>
            {busy ? <Loader2 className="spin" /> : <Save />}
            Save as new file
          </button>
          <button className="btn btn--primary" disabled={!clip} onClick={applyTrim}>
            <Scissors />
            Apply trim
          </button>
        </>
      }
    >
      {!clip ? (
        <div className="empty" style={{ padding: '54px 0' }}>
          <Loader2 className="spin" size={22} />
          <span className="empty__text">Decoding audio…</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 17 }}>
          <div
            ref={trackRef}
            style={{
              position: 'relative',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-input)',
              border: '1px solid var(--line)',
              overflow: 'hidden',
              touchAction: 'none'
            }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: 132, display: 'block' }} />

            <div
              style={{
                position: 'absolute',
                inset: `0 ${(1 - selection.start) * 100}% 0 0`,
                background: 'rgb(6 6 11 / 0.62)',
                pointerEvents: 'none'
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: `0 0 0 ${selection.end * 100}%`,
                background: 'rgb(6 6 11 / 0.62)',
                pointerEvents: 'none'
              }}
            />

            <Handle
              position={selection.start}
              color={color}
              onPointerDown={() => setDragging('start')}
            />
            <Handle position={selection.end} color={color} onPointerDown={() => setDragging('end')} />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 11.5,
              color: 'var(--text-faint)'
            }}
          >
            <button className="btn btn--sm" onClick={() => void preview()}>
              {playing ? <Square /> : <Play />}
              {playing ? 'Stop' : 'Preview selection'}
            </button>
            <span className="mono">
              {formatPreciseTime(selectionSeconds.start)} → {formatPreciseTime(selectionSeconds.end)}
            </span>
            <span className="mono">
              ({formatPreciseTime(selectionSeconds.end - selectionSeconds.start)} of{' '}
              {formatPreciseTime(duration)})
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn--sm"
              onClick={() => setSelection({ start: 0, end: 1 })}
              disabled={selection.start === 0 && selection.end === 1}
            >
              Select all
            </button>
          </div>

          <div className="grid2">
            <Field label="Fade in" value={`${fadeIn.toFixed(2)}s`}>
              <Slider value={fadeIn} min={0} max={4} step={0.05} onChange={setFadeIn} aria-label="Fade in" />
            </Field>
            <Field label="Fade out" value={`${fadeOut.toFixed(2)}s`}>
              <Slider
                value={fadeOut}
                min={0}
                max={4}
                step={0.05}
                onChange={setFadeOut}
                aria-label="Fade out"
              />
            </Field>
            <Field label="Speed" value={`${speed.toFixed(2)}×`}>
              <Slider value={speed} min={0.5} max={2} step={0.05} onChange={setSpeed} aria-label="Speed" />
            </Field>
            <Field label="Pitch" value={`${pitch > 0 ? '+' : ''}${pitch} st`}>
              <Slider value={pitch} min={-12} max={12} step={1} onChange={setPitch} aria-label="Pitch" />
            </Field>
          </div>

          <Field label="Destructive tools" value="Applied to the working copy">
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button
                className="btn btn--sm"
                disabled={busy}
                onClick={() => void mutate((input) => normalize(input, 0.97))}
              >
                <Wand2 />
                Normalise
              </button>
              <button
                className="btn btn--sm"
                disabled={busy}
                onClick={() =>
                  void mutate((input) =>
                    trim(input, selection.start * duration, selection.end * duration)
                  )
                }
              >
                <Scissors />
                Crop to selection
              </button>
              <button
                className="btn btn--sm"
                disabled={busy}
                onClick={() => void mutate((input) => trimSilence(input))}
              >
                <Gauge />
                Trim silence
              </button>
              <button
                className="btn btn--sm"
                disabled={busy}
                onClick={() => void mutate((input) => reverse(input))}
              >
                <FlipHorizontal2 />
                Reverse
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn--sm"
                disabled={busy || !original || clip === original}
                onClick={() => {
                  if (!original) return
                  setClip(cloneClip(original))
                  setSelection({ start: 0, end: 1 })
                }}
              >
                <Undo2 />
                Revert
              </button>
            </div>
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Handle({
  position,
  color,
  onPointerDown
}: {
  position: number
  color: string
  onPointerDown: () => void
}): ReactNode {
  return (
    <div
      onPointerDown={(event) => {
        event.preventDefault()
        onPointerDown()
      }}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${position * 100}%`,
        width: 13,
        marginLeft: -6.5,
        cursor: 'ew-resize',
        display: 'grid',
        placeItems: 'center',
        touchAction: 'none'
      }}
    >
      <span style={{ position: 'absolute', inset: '0 auto 0 6px', width: 2, background: color }} />
      <span
        style={{
          position: 'absolute',
          top: 6,
          width: 11,
          height: 15,
          borderRadius: 4,
          background: color,
          boxShadow: '0 2px 6px rgb(0 0 0 / .45)'
        }}
      />
    </div>
  )
}
