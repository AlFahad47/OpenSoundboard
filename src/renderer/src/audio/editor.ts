/** Offline DSP behind the sound editor. Every op is pure over Float32Array channels. */

export interface Clip {
  channels: Float32Array[]
  sampleRate: number
}

/**
 * copyToChannel is typed against a non-shared backing store, which plain
 * Float32Array does not narrow to. Every buffer here is locally allocated.
 */
export function fillBuffer(buffer: AudioBuffer, channels: Float32Array[]): void {
  channels.forEach((channel, index) =>
    buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index)
  )
}

export function cloneClip(clip: Clip): Clip {
  return { channels: clip.channels.map((c) => c.slice()), sampleRate: clip.sampleRate }
}

export function clipDuration(clip: Clip): number {
  return (clip.channels[0]?.length ?? 0) / clip.sampleRate
}

export function trim(clip: Clip, startSeconds: number, endSeconds: number): Clip {
  const total = clip.channels[0]?.length ?? 0
  const start = Math.max(0, Math.min(total, Math.floor(startSeconds * clip.sampleRate)))
  const end = Math.max(start + 1, Math.min(total, Math.floor(endSeconds * clip.sampleRate)))
  return {
    channels: clip.channels.map((c) => c.slice(start, end)),
    sampleRate: clip.sampleRate
  }
}

export function applyGain(clip: Clip, gain: number): Clip {
  return {
    channels: clip.channels.map((channel) => {
      const out = new Float32Array(channel.length)
      for (let i = 0; i < channel.length; i++) out[i] = channel[i] * gain
      return out
    }),
    sampleRate: clip.sampleRate
  }
}

export function peakOf(clip: Clip): number {
  let peak = 0
  for (const channel of clip.channels) {
    for (let i = 0; i < channel.length; i++) {
      const abs = channel[i] < 0 ? -channel[i] : channel[i]
      if (abs > peak) peak = abs
    }
  }
  return peak
}

export function normalize(clip: Clip, target = 0.98): Clip {
  const peak = peakOf(clip)
  if (peak < 1e-6) return cloneClip(clip)
  return applyGain(clip, target / peak)
}

/** Equal-power fade sounds smoother than a straight line on short clips. */
export function fade(clip: Clip, inSeconds: number, outSeconds: number): Clip {
  const length = clip.channels[0]?.length ?? 0
  const inSamples = Math.min(length, Math.floor(inSeconds * clip.sampleRate))
  const outSamples = Math.min(length - inSamples, Math.floor(outSeconds * clip.sampleRate))

  return {
    channels: clip.channels.map((channel) => {
      const out = channel.slice()
      for (let i = 0; i < inSamples; i++) {
        out[i] *= Math.sin((i / inSamples) * (Math.PI / 2))
      }
      for (let i = 0; i < outSamples; i++) {
        const index = length - outSamples + i
        out[index] *= Math.cos((i / outSamples) * (Math.PI / 2))
      }
      return out
    }),
    sampleRate: clip.sampleRate
  }
}

export function reverse(clip: Clip): Clip {
  return {
    channels: clip.channels.map((channel) => {
      const out = new Float32Array(channel.length)
      for (let i = 0; i < channel.length; i++) out[i] = channel[channel.length - 1 - i]
      return out
    }),
    sampleRate: clip.sampleRate
  }
}

export function toMono(clip: Clip): Clip {
  if (clip.channels.length === 1) return cloneClip(clip)
  const length = clip.channels[0].length
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const channel of clip.channels) sum += channel[i]
    out[i] = sum / clip.channels.length
  }
  return { channels: [out], sampleRate: clip.sampleRate }
}

/** Strips leading and trailing silence below `threshold` (linear, not dB). */
export function trimSilence(clip: Clip, threshold = 0.008, padSeconds = 0.02): Clip {
  const length = clip.channels[0]?.length ?? 0
  if (!length) return cloneClip(clip)

  const loudAt = (index: number): boolean => {
    for (const channel of clip.channels) {
      const abs = channel[index] < 0 ? -channel[index] : channel[index]
      if (abs > threshold) return true
    }
    return false
  }

  let start = 0
  while (start < length && !loudAt(start)) start++
  let end = length - 1
  while (end > start && !loudAt(end)) end--

  if (start >= end) return cloneClip(clip)

  const pad = Math.floor(padSeconds * clip.sampleRate)
  return trim(
    clip,
    Math.max(0, start - pad) / clip.sampleRate,
    Math.min(length, end + pad) / clip.sampleRate
  )
}

/**
 * Resamples for speed and pitch. Both are resampling changes — pitch and length
 * move together, which is what a soundboard wants.
 */
export async function resample(clip: Clip, rate: number, semitones: number): Promise<Clip> {
  const factor = Math.max(0.25, Math.min(4, rate)) * Math.pow(2, semitones / 12)
  if (Math.abs(factor - 1) < 1e-4) return cloneClip(clip)

  const length = clip.channels[0]?.length ?? 0
  const outLength = Math.max(1, Math.floor(length / factor))

  const offline = new OfflineAudioContext(clip.channels.length, outLength, clip.sampleRate)
  const buffer = offline.createBuffer(clip.channels.length, length, clip.sampleRate)
  fillBuffer(buffer, clip.channels)

  const source = offline.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = factor
  source.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  const channels: Float32Array[] = []
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    channels.push(rendered.getChannelData(ch).slice())
  }
  return { channels, sampleRate: rendered.sampleRate }
}

/** Simple one-pole shelving pair, enough for the editor's tone controls. */
export async function equalize(
  clip: Clip,
  bands: { low: number; mid: number; high: number }
): Promise<Clip> {
  if (!bands.low && !bands.mid && !bands.high) return cloneClip(clip)

  const length = clip.channels[0]?.length ?? 0
  const offline = new OfflineAudioContext(clip.channels.length, length, clip.sampleRate)
  const buffer = offline.createBuffer(clip.channels.length, length, clip.sampleRate)
  fillBuffer(buffer, clip.channels)

  const source = offline.createBufferSource()
  source.buffer = buffer

  const low = offline.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 250
  low.gain.value = bands.low

  const mid = offline.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 1400
  mid.Q.value = 0.9
  mid.gain.value = bands.mid

  const high = offline.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = 4800
  high.gain.value = bands.high

  source.connect(low)
  low.connect(mid)
  mid.connect(high)
  high.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  const channels: Float32Array[] = []
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    channels.push(rendered.getChannelData(ch).slice())
  }
  return { channels, sampleRate: rendered.sampleRate }
}
