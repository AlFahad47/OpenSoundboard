/** Minimal 16-bit PCM WAV writer. Used for edited clips and recordings. */

export interface PcmSource {
  channels: Float32Array[]
  sampleRate: number
}

export function encodeWav(source: PcmSource): Uint8Array {
  const numChannels = Math.max(1, source.channels.length)
  const numFrames = source.channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, source.sampleRate, true)
  view.setUint32(28, source.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = source.channels[ch]?.[frame] ?? 0
      // Clamp before scaling so overs wrap to full scale instead of folding over.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch).slice())
  }
  return encodeWav({ channels, sampleRate: buffer.sampleRate })
}
