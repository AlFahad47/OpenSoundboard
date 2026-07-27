import { useMemo, useState, type ReactNode } from 'react'
import { Heart, Play, Repeat, Square, TriangleAlert, MoreHorizontal } from 'lucide-react'
import type { Sound } from '@shared/types'
import { colorOf, useStore } from '../state/store'
import { formatLength, formatRelative, prettyAccelerator } from '../lib/format'
import { ContextMenu } from './primitives'
import { buildSoundMenu } from './soundMenu'

interface Props {
  sounds: Sound[]
  playing: string[]
}

export function SoundList({ sounds, playing }: Props): ReactNode {
  const selection = useStore((s) => s.selection)
  const playSound = useStore((s) => s.playSound)
  const stopSound = useStore((s) => s.stopSound)
  const toggleSelection = useStore((s) => s.toggleSelection)
  const categories = useStore((s) => s.categories)
  const [menu, setMenu] = useState<{ x: number; y: number; sound: Sound } | null>(null)

  const playingSet = useMemo(() => new Set(playing), [playing])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
  )

  return (
    <>
      <div className="listrow__head">
        <span />
        <span>Name</span>
        <span>Hotkey</span>
        <span>Length</span>
        <span>Plays</span>
        <span />
      </div>

      <div className="list">
        {sounds.map((sound) => {
          const isPlaying = playingSet.has(sound.id)
          const color = colorOf(sound)
          return (
            <div
              key={sound.id}
              className="listrow"
              style={{ ['--pad' as string]: color }}
              data-playing={isPlaying}
              data-selected={selectedSet.has(sound.id)}
              data-missing={sound.missing}
              draggable
              onDragStart={(event) => {
                const ids = selection.includes(sound.id) ? selection : [sound.id]
                event.dataTransfer.setData('application/x-soundboard-sounds', JSON.stringify(ids))
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={(event) => {
                toggleSelection(sound.id, event.ctrlKey || event.metaKey || event.shiftKey)
              }}
              onDoubleClick={() => (isPlaying ? stopSound(sound.id) : void playSound(sound.id))}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, sound })
              }}
            >
              <button
                className="listrow__play"
                onClick={(event) => {
                  event.stopPropagation()
                  if (isPlaying) stopSound(sound.id)
                  else void playSound(sound.id)
                }}
                aria-label={isPlaying ? 'Stop' : 'Play'}
              >
                {sound.missing ? <TriangleAlert /> : isPlaying ? <Square /> : <Play />}
              </button>

              <div style={{ minWidth: 0 }}>
                <div className="listrow__name">
                  {sound.name}
                  {sound.favorite ? (
                    <Heart
                      size={11}
                      fill="var(--warn)"
                      color="var(--warn)"
                      style={{ marginLeft: 6, verticalAlign: -1 }}
                    />
                  ) : null}
                  {sound.loop ? (
                    <Repeat
                      size={11}
                      color="var(--text-faint)"
                      style={{ marginLeft: 5, verticalAlign: -1 }}
                    />
                  ) : null}
                </div>
                <div className="listrow__sub">
                  {sound.categoryId ? (categoryNames.get(sound.categoryId) ?? 'Unknown') : 'Uncategorised'}
                  {sound.lastPlayed ? ` · ${formatRelative(sound.lastPlayed)}` : ''}
                </div>
              </div>

              <span className="listrow__cell">
                {sound.hotkey ? (
                  <span className="pad__key">{prettyAccelerator(sound.hotkey)}</span>
                ) : (
                  '—'
                )}
              </span>
              <span className="listrow__cell">{formatLength(sound.duration)}</span>
              <span className="listrow__cell">{sound.playCount || '—'}</span>

              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={(event) => {
                  event.stopPropagation()
                  const rect = event.currentTarget.getBoundingClientRect()
                  setMenu({ x: rect.left, y: rect.bottom + 4, sound })
                }}
                aria-label="More actions"
              >
                <MoreHorizontal />
              </button>
            </div>
          )
        })}
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
