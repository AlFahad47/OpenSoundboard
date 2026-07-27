import { type ReactNode } from 'react'
import {
  Mic,
  MicOff,
  Music2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { colorOf, useStore } from '../state/store'
import { engine } from '../audio/engine'
import { useEngine, useLevels, useMicHealth, usePlaybackPosition } from '../hooks/useEngine'
import { formatTime } from '../lib/format'
import { LevelMeter } from './LevelMeter'
import { Slider } from './primitives'
import { Waveform } from './Waveform'

export function PlayerBar(): ReactNode {
  const snapshot = useEngine()
  const sounds = useStore((s) => s.sounds)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const updateSound = useStore((s) => s.updateSound)
  const stopAll = useStore((s) => s.stopAll)
  const playRandom = useStore((s) => s.playRandom)
  const playNext = useStore((s) => s.playNext)

  const active = snapshot.playing.length > 0
  const levels = useLevels(true)
  const position = usePlaybackPosition(active)
  const micHealth = useMicHealth(snapshot.micActive && settings.micPassthrough)

  const current = snapshot.currentSoundId
    ? (sounds.find((s) => s.id === snapshot.currentSoundId) ?? null)
    : null

  const end = current
    ? current.trimEnd > current.trimStart
      ? current.trimEnd
      : current.duration
    : 0
  const segment = current ? Math.max(0.01, end - current.trimStart) : 0
  const color = current ? colorOf(current) : 'var(--bg-raised)'

  const VolumeIcon =
    settings.masterVolume === 0 ? VolumeX : settings.masterVolume < 0.55 ? Volume1 : Volume2

  return (
    <footer className="player">
      <span
        className="player__line"
        style={{ width: current && segment > 0 ? `${Math.min(100, (position / segment) * 100)}%` : '0%' }}
      />

      <div className="player__now">
        <span
          className="player__art"
          data-idle={!current}
          style={current ? { ['--pad' as string]: color } : undefined}
        >
          <Music2 />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="player__title">{current ? current.name : 'Nothing playing'}</div>
          <div className="player__sub">
            {current
              ? `${formatTime(position)} / ${formatTime(segment)}${
                  snapshot.playing.length > 1 ? ` · ${snapshot.playing.length} layered` : ''
                }`
              : `${sounds.length} sound${sounds.length === 1 ? '' : 's'} in library`}
          </div>
        </div>
      </div>

      <div className="player__center">
        <div className="player__transport">
          <button
            className="tbtn"
            title="Previous sound"
            disabled={!sounds.length}
            onClick={() => void playNext(-1)}
          >
            <SkipBack />
          </button>

          <button
            className="tbtn tbtn--main"
            title={snapshot.paused ? 'Resume' : active ? 'Pause' : 'Play a random sound'}
            onClick={() => (active ? void engine.togglePause() : void playRandom())}
            disabled={!sounds.length}
          >
            {active && !snapshot.paused ? <Pause /> : <Play />}
          </button>

          <button className="tbtn" title="Stop everything" disabled={!active} onClick={stopAll}>
            <Square />
          </button>

          <button
            className="tbtn"
            title="Next sound"
            disabled={!sounds.length}
            onClick={() => void playNext(1)}
          >
            <SkipForward />
          </button>

          <span style={{ width: 6 }} />

          <button
            className="tbtn"
            title="Play something at random"
            disabled={!sounds.length}
            onClick={() => void playRandom()}
          >
            <Shuffle />
          </button>

          <button
            className="tbtn"
            data-on={current?.loop ?? false}
            title={current ? 'Loop this sound' : 'Select a sound to loop it'}
            disabled={!current}
            onClick={() => current && updateSound(current.id, { loop: !current.loop })}
          >
            <Repeat />
          </button>
        </div>

        <div className="scrub">
          <span className="scrub__time">{formatTime(position)}</span>
          {current ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Waveform
                soundId={current.id}
                path={current.path}
                color={colorOf(current)}
                height={26}
                progress={segment > 0 ? position / segment : -1}
                onSeek={(ratio) => void engine.seek(current, ratio * segment)}
              />
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                background: 'var(--line-soft)'
              }}
            />
          )}
          <span className="scrub__time scrub__time--right">{formatTime(segment)}</span>
        </div>
      </div>

      <div className="player__right">
        <div className="meters">
          <LevelMeter
            label="You"
            level={levels.monitor}
            title="What you hear on your own headphones"
          />
          <LevelMeter
            label="Them"
            level={levels.broadcast}
            disabled={!snapshot.broadcastReady}
            title={
              snapshot.broadcastReady
                ? 'What is sent to the virtual cable'
                : 'No virtual cable selected — open Setup'
            }
          />
          <LevelMeter
            label="Mic"
            level={levels.mic}
            disabled={!snapshot.micActive || !settings.micPassthrough}
            title={
              micHealth === 'silent'
                ? 'Your microphone is producing no sound — open Setup for how to fix it'
                : (snapshot.micError ?? 'Microphone passthrough level')
            }
          />
        </div>

        <button
          className="tbtn"
          data-on={settings.micPassthrough && snapshot.micActive}
          title={
            snapshot.micError
              ? `Microphone error: ${snapshot.micError}`
              : settings.micPassthrough
                ? 'Microphone is being passed through — click to mute'
                : 'Microphone is muted — click to unmute'
          }
          onClick={() => updateSettings({ micPassthrough: !settings.micPassthrough })}
          style={
            !settings.micPassthrough
              ? { color: 'var(--bad)' }
              : micHealth === 'silent'
                ? { color: 'var(--warn)' }
                : undefined
          }
        >
          {settings.micPassthrough ? <Mic /> : <MicOff />}
        </button>

        <div className="volume">
          <VolumeIcon size={15} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <Slider
            value={settings.masterVolume}
            min={0}
            max={1.5}
            step={0.01}
            aria-label="Master volume"
            onChange={(value) => updateSettings({ masterVolume: value })}
          />
        </div>
      </div>
    </footer>
  )
}
