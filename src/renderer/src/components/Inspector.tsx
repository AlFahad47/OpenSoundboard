import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Heart, Palette, Scissors, Trash2, X, Play, Square } from 'lucide-react'
import type { Sound } from '@shared/types'
import { autoColor, colorOf, useStore } from '../state/store'
import { decibels, formatBytes, formatLength, formatRelative } from '../lib/format'
import { Field, Slider, Switch } from './primitives'
import { HotkeyInput } from './HotkeyInput'
import { Waveform } from './Waveform'
import { engine } from '../audio/engine'
import { usePlaybackPosition } from '../hooks/useEngine'

const SWATCHES = [
  '#7c5cff',
  '#f06595',
  '#4dabf7',
  '#51cf66',
  '#ffd43b',
  '#ff922b',
  '#22d3ee',
  '#e599f7',
  '#ff6b6b',
  '#94d82d'
]

export function Inspector({
  sound,
  playing
}: {
  sound: Sound
  playing: boolean
}): ReactNode {
  const updateSound = useStore((s) => s.updateSound)
  const removeSounds = useStore((s) => s.removeSounds)
  const categories = useStore((s) => s.categories)
  const setEditorSound = useStore((s) => s.setEditorSound)
  const setSelection = useStore((s) => s.setSelection)
  const playSound = useStore((s) => s.playSound)
  const stopSound = useStore((s) => s.stopSound)
  const selection = useStore((s) => s.selection)

  const [tagDraft, setTagDraft] = useState('')
  const [showColors, setShowColors] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const position = usePlaybackPosition(playing)

  useEffect(() => {
    const focus = (): void => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
    window.addEventListener('soundboard:focus-rename', focus)
    return () => window.removeEventListener('soundboard:focus-rename', focus)
  }, [])

  const color = colorOf(sound)
  const end = sound.trimEnd > sound.trimStart ? sound.trimEnd : sound.duration
  const segment = Math.max(0.01, end - sound.trimStart)
  const many = selection.length > 1

  const addTag = (): void => {
    const value = tagDraft.trim().toLowerCase()
    if (!value || sound.tags.includes(value)) {
      setTagDraft('')
      return
    }
    updateSound(sound.id, { tags: [...sound.tags, value] })
    setTagDraft('')
  }

  return (
    <aside className="inspector">
      <div className="inspector__head">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="inspector__title">{many ? `${selection.length} sounds selected` : sound.name}</div>
            {!many ? <div className="inspector__path">{sound.path}</div> : null}
          </div>
          <button
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => setSelection([])}
            aria-label="Close inspector"
          >
            <X />
          </button>
        </div>
      </div>

      <div className="inspector__body">
        {!many ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={() => (playing ? stopSound(sound.id) : void playSound(sound.id))}
              >
                {playing ? <Square /> : <Play />}
                {playing ? 'Stop' : 'Play'}
              </button>
              <button
                className="btn btn--icon"
                title={sound.favorite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() => updateSound(sound.id, { favorite: !sound.favorite })}
                style={sound.favorite ? { color: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
              >
                <Heart fill={sound.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                className="btn btn--icon"
                title="Edit clip"
                onClick={() => setEditorSound(sound.id)}
              >
                <Scissors />
              </button>
            </div>

            <Waveform
              soundId={sound.id}
              path={sound.path}
              color={color}
              height={54}
              progress={playing ? position / segment : -1}
              trim={
                sound.trimStart > 0 || sound.trimEnd > 0
                  ? {
                      start: sound.duration ? sound.trimStart / sound.duration : 0,
                      end: sound.duration ? end / sound.duration : 1
                    }
                  : null
              }
              onSeek={(ratio) => {
                if (!sound.duration) return
                void engine.seek(sound, ratio * segment)
              }}
            />

            <Field label="Name">
              <input
                ref={nameRef}
                className="input"
                value={sound.name}
                onChange={(event) => updateSound(sound.id, { name: event.target.value })}
              />
            </Field>

            <Field label="Category">
              <select
                className="input"
                value={sound.categoryId ?? ''}
                onChange={(event) =>
                  updateSound(sound.id, { categoryId: event.target.value || null })
                }
              >
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Hotkey">
              <HotkeyInput
                value={sound.hotkey}
                onChange={(accelerator) => updateSound(sound.id, { hotkey: accelerator })}
              />
            </Field>
          </>
        ) : (
          <div className="switch__hint" style={{ marginBottom: 4 }}>
            Changes below apply to every selected sound.
          </div>
        )}

        <Field label="Volume" value={decibels(sound.volume)}>
          <Slider
            value={sound.volume}
            min={0}
            max={2}
            step={0.01}
            aria-label="Sound volume"
            onChange={(value) => applyToSelection(sound, selection, { volume: value })}
          />
        </Field>

        <Field label="Pitch" value={`${sound.pitch > 0 ? '+' : ''}${sound.pitch} st`}>
          <Slider
            value={sound.pitch}
            min={-12}
            max={12}
            step={1}
            aria-label="Pitch"
            onChange={(value) => applyToSelection(sound, selection, { pitch: value })}
          />
        </Field>

        <Field label="Speed" value={`${sound.speed.toFixed(2)}×`}>
          <Slider
            value={sound.speed}
            min={0.5}
            max={2}
            step={0.05}
            aria-label="Playback speed"
            onChange={(value) => applyToSelection(sound, selection, { speed: value })}
          />
        </Field>

        <div className="grid2">
          <Field label="Fade in" value={`${sound.fadeIn.toFixed(2)}s`}>
            <Slider
              value={sound.fadeIn}
              min={0}
              max={3}
              step={0.05}
              aria-label="Fade in"
              onChange={(value) => applyToSelection(sound, selection, { fadeIn: value })}
            />
          </Field>
          <Field label="Fade out" value={`${sound.fadeOut.toFixed(2)}s`}>
            <Slider
              value={sound.fadeOut}
              min={0}
              max={3}
              step={0.05}
              aria-label="Fade out"
              onChange={(value) => applyToSelection(sound, selection, { fadeOut: value })}
            />
          </Field>
        </div>

        <Switch
          title="Loop"
          hint="Repeat until stopped"
          checked={sound.loop}
          onChange={(value) => applyToSelection(sound, selection, { loop: value })}
        />

        {!many ? (
          <>
            <Field label="Tags">
              <div className="tags">
                {sound.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                    <button
                      onClick={() =>
                        updateSound(sound.id, { tags: sound.tags.filter((t) => t !== tag) })
                      }
                      aria-label={`Remove ${tag}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="input"
                placeholder="Add a tag and press Enter"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addTag()}
                onBlur={addTag}
              />
            </Field>

            <Field label="Pad colour">
              <button
                className="btn"
                style={{ justifyContent: 'space-between' }}
                onClick={() => setShowColors((value) => !value)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Palette />
                  {sound.color ? 'Custom' : 'Automatic'}
                </span>
                <span
                  style={{ width: 16, height: 16, borderRadius: 5, background: color }}
                  aria-hidden
                />
              </button>
              {showColors ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button
                    className="btn btn--sm"
                    onClick={() => updateSound(sound.id, { color: null })}
                    title="Automatic colour"
                    style={{ width: 26, height: 26, padding: 0, background: autoColor(sound.id) }}
                  />
                  {SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      onClick={() => updateSound(sound.id, { color: swatch })}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: swatch,
                        boxShadow:
                          sound.color === swatch
                            ? `0 0 0 2px var(--bg-base), 0 0 0 4px ${swatch}`
                            : 'none'
                      }}
                      aria-label={swatch}
                    />
                  ))}
                </div>
              ) : null}
            </Field>

            <div
              style={{
                display: 'grid',
                gap: 5,
                paddingTop: 4,
                borderTop: '1px solid var(--line-soft)',
                fontSize: 11.5,
                color: 'var(--text-faint)'
              }}
            >
              <Stat label="Length" value={formatLength(sound.duration)} />
              {sound.trimStart > 0 || sound.trimEnd > 0 ? (
                <Stat label="Trimmed to" value={formatLength(segment)} />
              ) : null}
              <Stat label="Plays" value={String(sound.playCount)} />
              <Stat label="Last played" value={formatRelative(sound.lastPlayed)} />
              <Stat label="File size" value={formatBytes(sound.size)} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn--sm"
                style={{ flex: 1 }}
                onClick={() => void window.soundboard.files.reveal(sound.path)}
              >
                <FolderOpen />
                Show file
              </button>
              <button
                className="btn btn--sm btn--danger"
                style={{ flex: 1 }}
                onClick={() => removeSounds([sound.id])}
              >
                <Trash2 />
                Remove
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn--danger" onClick={() => removeSounds(selection)}>
            <Trash2 />
            Remove {selection.length} sounds
          </button>
        )}
      </div>
    </aside>
  )
}

function applyToSelection(sound: Sound, selection: string[], patch: Partial<Sound>): void {
  const store = useStore.getState()
  if (selection.length > 1 && selection.includes(sound.id)) store.updateSounds(selection, patch)
  else store.updateSound(sound.id, patch)
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span>{label}</span>
      <span className="mono" style={{ color: 'var(--text-dim)' }}>
        {value}
      </span>
    </div>
  )
}
