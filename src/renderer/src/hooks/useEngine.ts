import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { engine, type EngineSnapshot, type Levels } from '../audio/engine'

export function useEngine(): EngineSnapshot {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    engine.getSnapshot,
    engine.getSnapshot
  )
}

/**
 * Meters and the scrub head update every frame, which is far too fast for
 * React state. These hooks keep the animation loop out of the render path and
 * only re-render when the rounded value actually changes.
 */
export function useLevels(active: boolean): Levels {
  const [levels, setLevels] = useState<Levels>({ monitor: 0, broadcast: 0, mic: 0 })
  const previous = useRef(levels)

  useEffect(() => {
    if (!active) {
      setLevels({ monitor: 0, broadcast: 0, mic: 0 })
      return
    }
    let frame = 0
    const tick = (): void => {
      const next = engine.levels()
      const prev = previous.current
      // 1% quantisation: below that nothing visible changes.
      if (
        Math.abs(next.monitor - prev.monitor) > 0.01 ||
        Math.abs(next.broadcast - prev.broadcast) > 0.01 ||
        Math.abs(next.mic - prev.mic) > 0.01
      ) {
        previous.current = next
        setLevels(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return levels
}

export type MicHealth = 'off' | 'listening' | 'ok' | 'silent'

/**
 * Watches the microphone level over time.
 *
 * A correctly wired passthrough that receives no audio looks identical to a
 * broken app from the outside, so this distinguishes the two: after a grace
 * period with no signal at all we report "silent", which the UI turns into
 * actionable guidance (Windows privacy, a hardware mute switch, wrong device).
 */
export function useMicHealth(enabled: boolean, graceMs = 6000): MicHealth {
  const [health, setHealth] = useState<MicHealth>('off')

  useEffect(() => {
    if (!enabled) {
      setHealth('off')
      return
    }

    setHealth('listening')
    const startedAt = performance.now()
    let heard = false

    const timer = setInterval(() => {
      // Well below speech, but above a truly dead capture path.
      if (engine.levels().mic > 0.012) heard = true
      if (heard) setHealth('ok')
      else if (performance.now() - startedAt > graceMs) setHealth('silent')
    }, 250)

    return () => clearInterval(timer)
  }, [enabled, graceMs])

  return health
}

export function usePlaybackPosition(active: boolean): number {
  const [position, setPosition] = useState(0)
  const previous = useRef(0)

  useEffect(() => {
    if (!active) {
      setPosition(0)
      previous.current = 0
      return
    }
    let frame = 0
    const tick = (): void => {
      const next = engine.position()
      if (Math.abs(next - previous.current) > 0.02) {
        previous.current = next
        setPosition(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return position
}
