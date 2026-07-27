import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cachedPeaks, decodeFile, type WaveformPeaks } from '../audio/decoder'
import { cssVar, useThemeVersion } from '../hooks/useTheme'

interface Props {
  soundId: string
  path: string
  color: string
  /** 0..1 playhead position. Negative hides the head. */
  progress?: number
  height?: number
  /** Normalised trim window drawn as dimmed regions outside the selection. */
  trim?: { start: number; end: number } | null
  onSeek?: (ratio: number) => void
  onScrubStart?: () => void
  className?: string
}

export function Waveform({
  soundId,
  path,
  color,
  progress = -1,
  height = 64,
  trim = null,
  onSeek,
  onScrubStart,
  className
}: Props): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(() => cachedPeaks(soundId))
  const [hover, setHover] = useState(-1)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    let cancelled = false
    const cached = cachedPeaks(soundId)
    if (cached) {
      setPeaks(cached)
      return
    }
    setPeaks(null)
    void decodeFile(soundId, path).then(() => {
      if (!cancelled) setPeaks(cachedPeaks(soundId))
    })
    return () => {
      cancelled = true
    }
  }, [soundId, path])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    if (!width) return

    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const mid = height / 2

    // Canvas cannot read custom properties, so resolve them per paint. This
    // also makes the waveform follow a theme switch without extra plumbing.
    const idleColor = cssVar('--wave-idle', 'rgba(255,255,255,0.22)')
    const muteColor = cssVar('--wave-mute', 'rgba(255,255,255,0.07)')

    if (!peaks) {
      // Placeholder bars while the file decodes.
      ctx.fillStyle = muteColor
      for (let x = 0; x < width; x += 3) {
        const h = 2 + Math.abs(Math.sin(x * 0.09)) * (height * 0.22)
        ctx.fillRect(x, mid - h / 2, 2, h)
      }
      return
    }

    const buckets = peaks.length / 2
    const barWidth = 2
    const gap = 1
    const columns = Math.max(1, Math.floor(width / (barWidth + gap)))
    const played = progress >= 0 ? progress * width : -1

    const inTrim = (ratio: number): boolean => !trim || (ratio >= trim.start && ratio <= trim.end)

    for (let i = 0; i < columns; i++) {
      const x = i * (barWidth + gap)
      const ratio = i / columns
      const bucket = Math.min(buckets - 1, Math.floor(ratio * buckets))
      const min = peaks[bucket * 2]
      const max = peaks[bucket * 2 + 1]
      const amplitude = Math.max(Math.abs(min), Math.abs(max))
      const barHeight = Math.max(2, amplitude * (height - 6))

      const isPlayed = played >= 0 && x <= played
      const active = inTrim(ratio)

      if (isPlayed && active) ctx.fillStyle = color
      else if (active) ctx.fillStyle = idleColor
      else ctx.fillStyle = muteColor

      ctx.fillRect(x, mid - barHeight / 2, barWidth, barHeight)
    }

    if (played >= 0) {
      ctx.fillStyle = color
      ctx.fillRect(played, 0, 1.5, height)
    }

    if (hover >= 0 && onSeek) {
      ctx.fillStyle = cssVar('--text-dim', 'rgba(255,255,255,0.35)')
      ctx.fillRect(hover * width, 0, 1, height)
    }
  }, [peaks, progress, height, color, trim, hover, onSeek, themeVersion])

  const ratioFrom = (event: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  }

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'wave'}
      style={{ height, cursor: onSeek ? 'pointer' : 'default' }}
      onMouseMove={(event) => onSeek && setHover(ratioFrom(event))}
      onMouseLeave={() => setHover(-1)}
      onMouseDown={(event) => {
        if (!onSeek) return
        onScrubStart?.()
        onSeek(ratioFrom(event))
      }}
    />
  )
}
