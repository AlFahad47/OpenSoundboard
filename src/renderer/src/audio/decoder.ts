/**
 * File -> PCM decoding with a memory-budgeted LRU cache.
 *
 * A large library cannot live in RAM all at once (10s of stereo 48k audio is
 * ~3.8 MB), so decoded clips are evicted least-recently-used once the budget is
 * hit. Waveform peaks are kept separately and forever: they are ~7 KB each.
 *
 * One AudioBuffer per sound is shared by every output context. AudioBuffers are
 * not bound to the context that created them, so both the monitor and broadcast
 * graphs can point source nodes at the same PCM.
 */

export interface DecodedAudio {
  buffer: AudioBuffer
  sampleRate: number
  duration: number
  /** Absolute peak sample, used for normalisation. */
  peak: number
  bytes: number
}

/** Interleaved min/max pairs, one pair per waveform bucket. */
export type WaveformPeaks = Float32Array

const PEAK_BUCKETS = 900
const DEFAULT_BUDGET = 320 * 1024 * 1024

let decodeCtx: AudioContext | null = null
const cache = new Map<string, DecodedAudio>()
const peaks = new Map<string, WaveformPeaks>()
const inflight = new Map<string, Promise<DecodedAudio | null>>()
let budget = DEFAULT_BUDGET
let used = 0

export function decodeContext(): AudioContext {
  if (!decodeCtx) {
    // A dedicated context keeps decode work off the playback graphs.
    decodeCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' })
    // Nothing is ever connected to it, so leave it suspended.
    decodeCtx.suspend().catch(() => {})
  }
  return decodeCtx
}

export function setCacheBudget(bytes: number): void {
  budget = Math.max(32 * 1024 * 1024, bytes)
  evict()
}

function evict(): void {
  // Map preserves insertion order and we re-insert on access, so the front is oldest.
  for (const [key, entry] of cache) {
    if (used <= budget) break
    cache.delete(key)
    used -= entry.bytes
  }
}

export function channelsOf(decoded: DecodedAudio): Float32Array[] {
  const out: Float32Array[] = []
  for (let ch = 0; ch < decoded.buffer.numberOfChannels; ch++) {
    out.push(decoded.buffer.getChannelData(ch))
  }
  return out
}

function computePeaks(channels: Float32Array[], buckets = PEAK_BUCKETS): WaveformPeaks {
  const length = channels[0]?.length ?? 0
  const out = new Float32Array(buckets * 2)
  if (!length) return out

  const step = length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step)
    const end = Math.max(start + 1, Math.min(length, Math.floor((b + 1) * step)))
    let min = 0
    let max = 0
    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch]
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < min) min = v
        else if (v > max) max = v
      }
    }
    out[b * 2] = min
    out[b * 2 + 1] = max
  }
  return out
}

export function cachedPeaks(key: string): WaveformPeaks | null {
  return peaks.get(key) ?? null
}

/**
 * Pads render from whatever peaks already exist rather than triggering a decode
 * each. This lets them light up as background warming produces the data.
 */
const peakListeners = new Set<(key: string) => void>()

export function subscribePeaks(listener: (key: string) => void): () => void {
  peakListeners.add(listener)
  return () => peakListeners.delete(listener)
}

function announcePeaks(key: string): void {
  for (const listener of peakListeners) listener(key)
}

export function cachedAudio(key: string): DecodedAudio | null {
  const entry = cache.get(key)
  if (entry) {
    cache.delete(key)
    cache.set(key, entry)
  }
  return entry ?? null
}

export async function decodeFile(key: string, path: string): Promise<DecodedAudio | null> {
  const hit = cachedAudio(key)
  if (hit) return hit

  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async (): Promise<DecodedAudio | null> => {
    try {
      const raw = await window.soundboard.files.read(path)
      if (!raw) return null

      // decodeAudioData detaches the buffer it is handed, so give it one we own.
      const arrayBuffer = raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength
      ) as ArrayBuffer

      const buffer = await decodeContext().decodeAudioData(arrayBuffer)

      let peak = 0
      const channels: Float32Array[] = []
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch)
        for (let i = 0; i < data.length; i++) {
          const abs = data[i] < 0 ? -data[i] : data[i]
          if (abs > peak) peak = abs
        }
        channels.push(data)
      }

      const bytes = buffer.length * buffer.numberOfChannels * 4
      const decoded: DecodedAudio = {
        buffer,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        peak,
        bytes
      }

      if (!peaks.has(key)) {
        peaks.set(key, computePeaks(channels))
        announcePeaks(key)
      }

      cache.set(key, decoded)
      used += bytes
      evict()
      return decoded
    } catch (err) {
      console.warn('[decoder] failed to decode', path, err)
      return null
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, task)
  return task
}

export function peaksFromChannels(channels: Float32Array[], buckets = PEAK_BUCKETS): WaveformPeaks {
  return computePeaks(channels, buckets)
}

export function forget(key: string): void {
  const entry = cache.get(key)
  if (entry) {
    used -= entry.bytes
    cache.delete(key)
  }
  peaks.delete(key)
}

export function cacheStats(): { entries: number; used: number; budget: number } {
  return { entries: cache.size, used, budget }
}

/** Background decode so hotkeyed sounds fire without waiting on disk. */
export async function warm(items: { key: string; path: string }[]): Promise<void> {
  for (const item of items) {
    if (cache.has(item.key)) continue
    if (used > budget * 0.75) break
    await decodeFile(item.key, item.path)
    // Yield so warming never competes with playback or the UI.
    await new Promise((resolve) => setTimeout(resolve, 12))
  }
}
