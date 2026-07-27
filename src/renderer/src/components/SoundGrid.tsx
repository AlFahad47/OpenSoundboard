import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Heart, Play, Repeat, Square, TriangleAlert } from 'lucide-react'
import type { Sound } from '@shared/types'
import { colorOf, useStore } from '../state/store'
import { cachedPeaks, subscribePeaks } from '../audio/decoder'
import { formatLength, prettyAccelerator } from '../lib/format'
import { usePlaybackPosition } from '../hooks/useEngine'
import { ContextMenu } from './primitives'
import { buildSoundMenu } from './soundMenu'

interface Props {
  sounds: Sound[]
  playing: string[]
  currentSoundId: string | null
}

export function SoundGrid({ sounds, playing, currentSoundId }: Props): ReactNode {
  const padSize = useStore((s) => s.settings.padSize)
  const selection = useStore((s) => s.selection)
  const [menu, setMenu] = useState<{ x: number; y: number; sound: Sound } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const position = usePlaybackPosition(playing.length > 0)

  const playingSet = useMemo(() => new Set(playing), [playing])
  const selectedSet = useMemo(() => new Set(selection), [selection])

  return (
    <>
      <div className="pads" data-size={padSize}>
        {sounds.map((sound) => (
          <Pad
            key={sound.id}
            sound={sound}
            playing={playingSet.has(sound.id)}
            selected={selectedSet.has(sound.id)}
            dragging={dragging === sound.id}
            progress={
              sound.id === currentSoundId && sound.duration > 0
                ? Math.min(1, position / effectiveDuration(sound))
                : 0
            }
            onDragStateChange={setDragging}
            onMenu={(x, y) => setMenu({ x, y, sound })}
          />
        ))}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildSoundMenu(menu.sound, selection)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}

function effectiveDuration(sound: Sound): number {
  const end = sound.trimEnd > sound.trimStart ? sound.trimEnd : sound.duration
  return Math.max(0.01, end - sound.trimStart)
}

const Pad = memo(function Pad({
  sound,
  playing,
  selected,
  dragging,
  progress,
  onMenu,
  onDragStateChange
}: {
  sound: Sound
  playing: boolean
  selected: boolean
  dragging: boolean
  progress: number
  onMenu: (x: number, y: number) => void
  onDragStateChange: (id: string | null) => void
}): ReactNode {
  const playSound = useStore((s) => s.playSound)
  const stopSound = useStore((s) => s.stopSound)
  const toggleSelection = useStore((s) => s.toggleSelection)
  const moveSound = useStore((s) => s.moveSound)
  const selection = useStore((s) => s.selection)

  const color = colorOf(sound)

  const handleClick = (event: React.MouseEvent): void => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      toggleSelection(sound.id, true)
      return
    }
    toggleSelection(sound.id, false)
    if (playing) stopSound(sound.id)
    else void playSound(sound.id)
  }

  return (
    <button
      className="pad"
      style={{ ['--pad' as string]: color }}
      data-playing={playing}
      data-selected={selected}
      data-missing={sound.missing}
      data-dragging={dragging}
      title={sound.missing ? `Missing file: ${sound.path}` : sound.name}
      draggable
      onDragStart={(event) => {
        const ids = selection.includes(sound.id) ? selection : [sound.id]
        event.dataTransfer.setData('application/x-soundboard-sounds', JSON.stringify(ids))
        event.dataTransfer.effectAllowed = 'move'
        onDragStateChange(sound.id)
      }}
      onDragEnd={() => onDragStateChange(null)}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-soundboard-sounds')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData('application/x-soundboard-sounds')
        if (!raw) return
        event.preventDefault()
        event.stopPropagation()
        try {
          const ids = JSON.parse(raw) as string[]
          if (ids[0] && ids[0] !== sound.id) moveSound(ids[0], sound.id)
        } catch {
          /* not our payload */
        }
      }}
      onClick={handleClick}
      onAuxClick={(event) => {
        // Middle click auditions on the local output only.
        if (event.button === 1) {
          event.preventDefault()
          void playSound(sound.id, { preview: true })
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.clientX, event.clientY)
      }}
    >
      <PadWave soundId={sound.id} color={color} />

      <div className="pad__top">
        <span className="pad__badge">
          {sound.missing ? <TriangleAlert /> : playing ? <Square /> : <Play />}
        </span>
        <span className="pad__flags">
          {sound.favorite ? (
            <span className="pad__flag" data-on="true" title="Favourite">
              <Heart fill="currentColor" />
            </span>
          ) : null}
          {sound.loop ? (
            <span className="pad__flag" title="Loops">
              <Repeat />
            </span>
          ) : null}
        </span>
      </div>

      <div className="pad__name">{sound.name}</div>

      <div className="pad__meta">
        {sound.hotkey ? <span className="pad__key">{prettyAccelerator(sound.hotkey)}</span> : null}
        <span>{formatLength(effectiveDuration(sound))}</span>
        {sound.playCount > 0 ? <span>· {sound.playCount}×</span> : null}
      </div>

      {progress > 0 ? (
        <span className="pad__progress" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      ) : null}
    </button>
  )
})

/**
 * Pads draw a waveform only when peaks are already cached. Kicking off a decode
 * for every visible pad would stall a large library on first paint.
 */
function PadWave({ soundId, color }: { soundId: string; color: string }): ReactNode {
  const [peaks, setPeaks] = useState(() => cachedPeaks(soundId))

  useEffect(() => {
    setPeaks(cachedPeaks(soundId))
    if (cachedPeaks(soundId)) return
    return subscribePeaks((key) => {
      if (key === soundId) setPeaks(cachedPeaks(soundId))
    })
  }, [soundId])

  const path = useMemo(() => {
    if (!peaks) return null
    const buckets = peaks.length / 2
    const step = Math.max(1, Math.floor(buckets / 60))
    const points: string[] = []
    let index = 0
    for (let b = 0; b < buckets; b += step) {
      const amplitude = Math.max(Math.abs(peaks[b * 2]), Math.abs(peaks[b * 2 + 1]))
      points.push(`${index === 0 ? 'M' : 'L'}${((b / buckets) * 100).toFixed(2)},${(50 - amplitude * 46).toFixed(2)}`)
      index++
    }
    for (let b = buckets - 1; b >= 0; b -= step) {
      const amplitude = Math.max(Math.abs(peaks[b * 2]), Math.abs(peaks[b * 2 + 1]))
      points.push(`L${((b / buckets) * 100).toFixed(2)},${(50 + amplitude * 46).toFixed(2)}`)
    }
    return `${points.join(' ')} Z`
  }, [peaks])

  if (!path) return null

  return (
    <svg className="pad__wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill={color} />
    </svg>
  )
}
