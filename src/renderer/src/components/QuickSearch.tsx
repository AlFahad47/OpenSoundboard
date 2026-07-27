import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { colorOf, useStore } from '../state/store'
import { formatLength, prettyAccelerator } from '../lib/format'

/**
 * The hotkey-driven launcher. Opens over everything, filters as you type and
 * fires the highlighted sound on Enter — the fastest path to a sound mid-call.
 */
export function QuickSearch(): ReactNode {
  const open = useStore((s) => s.quickSearchOpen)
  const setOpen = useStore((s) => s.setQuickSearch)
  const sounds = useStore((s) => s.sounds)
  const playSound = useStore((s) => s.playSound)

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const pool = sounds.filter((sound) => !sound.missing)
    if (!needle) {
      return [...pool]
        .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.playCount - a.playCount)
        .slice(0, 40)
    }
    return pool
      .map((sound) => {
        const name = sound.name.toLowerCase()
        // Prefix beats word-start beats substring beats tag.
        let score = -1
        if (name.startsWith(needle)) score = 0
        else if (name.includes(` ${needle}`)) score = 1
        else if (name.includes(needle)) score = 2
        else if (sound.tags.some((tag) => tag.includes(needle))) score = 3
        return { sound, score }
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score || b.sound.playCount - a.sound.playCount)
      .slice(0, 40)
      .map((entry) => entry.sound)
  }, [query, sounds])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      // The window may still be coming to the front when the hotkey fires.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const commit = (soundId?: string): void => {
    const target = soundId ?? results[index]?.id
    if (target) void playSound(target)
    setOpen(false)
  }

  return (
    <div className="quick" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="quick__panel">
        <div className="quick__input">
          <Search size={17} style={{ color: 'var(--text-faint)' }} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Play a sound…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((i) => Math.min(results.length - 1, i + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              }
            }}
          />
        </div>

        <div className="quick__results" ref={listRef}>
          {results.length ? (
            results.map((sound, i) => (
              <button
                key={sound.id}
                className="quick__row"
                data-on={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => commit(sound.id)}
              >
                <span className="quick__dot" style={{ background: colorOf(sound) }} />
                <span className="quick__name">{sound.name}</span>
                {sound.hotkey ? (
                  <span className="pad__key">{prettyAccelerator(sound.hotkey)}</span>
                ) : null}
                <span className="text-faint mono" style={{ fontSize: 11 }}>
                  {sound.duration ? formatLength(sound.duration) : ''}
                </span>
              </button>
            ))
          ) : (
            <div style={{ padding: '26px 12px', textAlign: 'center', color: 'var(--text-faint)' }}>
              No sounds match “{query}”
            </div>
          )}
        </div>

        <div className="quick__hint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> play
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
