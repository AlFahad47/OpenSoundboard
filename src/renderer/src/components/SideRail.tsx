import { useMemo, type ReactNode } from 'react'
import { Activity, Clock3, Flame, Keyboard, Play } from 'lucide-react'
import { colorOf, useStore } from '../state/store'
import { formatLength, formatRelative, prettyAccelerator } from '../lib/format'
import { useEngine, useLevels } from '../hooks/useEngine'
import { LevelMeter } from './LevelMeter'

/**
 * The right-hand column. The reference layout puts social widgets here; a
 * soundboard has no use for those, so it carries the things you actually reach
 * for mid-call: your heaviest hitters, what you just added, live output levels
 * and the hotkeys you have bound.
 */
export function SideRail(): ReactNode {
  const sounds = useStore((s) => s.sounds)
  const settings = useStore((s) => s.settings)
  const playSound = useStore((s) => s.playSound)
  const snapshot = useEngine()
  const levels = useLevels(true)

  const mostPlayed = useMemo(
    () => [...sounds].filter((s) => s.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 5),
    [sounds]
  )

  const recent = useMemo(
    () => [...sounds].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4),
    [sounds]
  )

  const bound = useMemo(() => sounds.filter((s) => s.hotkey).slice(0, 6), [sounds])

  return (
    <aside className="siderail">
      <section className="railcard">
        <header className="railcard__head">
          <Flame size={13} />
          <span>Most played</span>
        </header>
        {mostPlayed.length ? (
          <div className="railcard__body">
            {mostPlayed.map((sound, index) => (
              <button
                key={sound.id}
                className="rankrow"
                onClick={() => void playSound(sound.id)}
                title={`Play ${sound.name}`}
              >
                <span className="rankrow__n">{index + 1}</span>
                <span className="rankrow__dot" style={{ background: colorOf(sound) }} />
                <span className="rankrow__name">{sound.name}</span>
                <span className="rankrow__count">{sound.playCount}×</span>
                <Play className="rankrow__play" />
              </button>
            ))}
          </div>
        ) : (
          <div className="railcard__empty">Play something to build a top list.</div>
        )}
      </section>

      <section className="railcard">
        <header className="railcard__head">
          <Clock3 size={13} />
          <span>Recently added</span>
        </header>
        {recent.length ? (
          <div className="railcard__body">
            {recent.map((sound) => (
              <button
                key={sound.id}
                className="rankrow"
                onClick={() => void playSound(sound.id)}
                title={`Play ${sound.name}`}
              >
                <span className="rankrow__dot" style={{ background: colorOf(sound) }} />
                <span className="rankrow__name">{sound.name}</span>
                <span className="rankrow__count">{formatRelative(sound.addedAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="railcard__empty">Drag audio files anywhere to add them.</div>
        )}
      </section>

      <section className="railcard">
        <header className="railcard__head">
          <Activity size={13} />
          <span>Routing</span>
        </header>
        <div className="railcard__body" style={{ gap: 6 }}>
          {/* Levels live in the transport bar, which is always on screen —
              repeating them here just competed for attention. */}
          <div className="statrow">
            <span>They hear</span>
            <strong style={{ color: snapshot.broadcastReady ? 'var(--good)' : 'var(--warn)' }}>
              {snapshot.broadcastReady ? 'Cable live' : 'Local only'}
            </strong>
          </div>
          <div className="statrow">
            <span>Microphone</span>
            <strong
              style={{
                color:
                  snapshot.micActive && settings.micPassthrough ? 'var(--good)' : 'var(--text-faint)'
              }}
            >
              {!settings.micPassthrough ? 'Muted' : snapshot.micActive ? 'Passing through' : 'Off'}
            </strong>
          </div>
          <div className="statrow">
            <span>Now playing</span>
            <strong>{snapshot.playing.length || '—'}</strong>
          </div>
        </div>
      </section>

      <section className="railcard">
        <header className="railcard__head">
          <Keyboard size={13} />
          <span>Your hotkeys</span>
        </header>
        {bound.length ? (
          <div className="railcard__body">
            {bound.map((sound) => (
              <div key={sound.id} className="keyrow">
                <span className="rankrow__dot" style={{ background: colorOf(sound) }} />
                <span className="rankrow__name">{sound.name}</span>
                <span className="pad__key">{prettyAccelerator(sound.hotkey)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="railcard__empty">
            Select a sound and set a hotkey to fire it from anywhere.
          </div>
        )}
      </section>

      <section className="railcard">
        <header className="railcard__head">
          <span>Library</span>
        </header>
        <div className="railcard__body" style={{ gap: 6 }}>
          <Stat label="Sounds" value={String(sounds.length)} />
          <Stat label="Hotkeys bound" value={String(sounds.filter((s) => s.hotkey).length)} />
          <Stat label="Favourites" value={String(sounds.filter((s) => s.favorite).length)} />
          <Stat
            label="Total length"
            value={formatLength(sounds.reduce((sum, s) => sum + s.duration, 0))}
          />
        </div>
      </section>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="statrow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
