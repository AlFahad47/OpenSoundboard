import { decodeContext } from './decoder'
import { encodeWav } from './wav'

/**
 * Capture for the recorder tab.
 *
 * "System" capture goes through getDisplayMedia, which the main process answers
 * with Windows loopback audio — that is the "record what you hear" path. The
 * video track it insists on handing us is dropped immediately.
 */

export type RecordSource = 'mic' | 'system' | 'both'
export type RecordFormat = 'wav' | 'webm'

export interface RecordingResult {
  data: Uint8Array
  extension: string
  duration: number
}

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export class Recorder {
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private streams: MediaStream[] = []
  private mixCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private meterBuf = new Float32Array(1024)
  private startedAt = 0
  private pausedFor = 0
  private pausedAt = 0

  get active(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive'
  }

  get paused(): boolean {
    return this.recorder?.state === 'paused'
  }

  /** Seconds of audio captured so far, excluding paused time. */
  elapsed(): number {
    if (!this.startedAt) return 0
    const now = performance.now()
    const pausedNow = this.pausedAt ? now - this.pausedAt : 0
    return (now - this.startedAt - this.pausedFor - pausedNow) / 1000
  }

  level(): number {
    if (!this.analyser) return 0
    const size = this.analyser.fftSize
    if (this.meterBuf.length < size) this.meterBuf = new Float32Array(size)
    const view = this.meterBuf.subarray(0, size)
    this.analyser.getFloatTimeDomainData(view)
    let sum = 0
    for (let i = 0; i < size; i++) sum += view[i] * view[i]
    return Math.min(1, Math.sqrt(sum / size) * 2.6)
  }

  private async captureMic(deviceId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
  }

  private async captureSystem(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    })
    // We only ever wanted the audio; stop the screen track so nothing is captured visually.
    stream.getVideoTracks().forEach((track) => {
      track.stop()
      stream.removeTrack(track)
    })
    if (!stream.getAudioTracks().length) {
      throw new Error('Windows did not provide a loopback audio track.')
    }
    return stream
  }

  async start(source: RecordSource, micDeviceId: string): Promise<void> {
    if (this.active) throw new Error('Already recording')

    this.chunks = []
    this.streams = []
    this.pausedFor = 0
    this.pausedAt = 0

    let target: MediaStream

    if (source === 'mic') {
      target = await this.captureMic(micDeviceId)
      this.streams.push(target)
    } else if (source === 'system') {
      target = await this.captureSystem()
      this.streams.push(target)
    } else {
      const mic = await this.captureMic(micDeviceId)
      const system = await this.captureSystem()
      this.streams.push(mic, system)

      const ctx = new AudioContext()
      this.mixCtx = ctx
      const dest = ctx.createMediaStreamDestination()
      ctx.createMediaStreamSource(mic).connect(dest)
      ctx.createMediaStreamSource(system).connect(dest)
      target = dest.stream
    }

    // Meter whatever we ended up recording.
    const meterCtx = this.mixCtx ?? new AudioContext()
    if (!this.mixCtx) this.mixCtx = meterCtx
    const analyser = meterCtx.createAnalyser()
    analyser.fftSize = 1024
    meterCtx.createMediaStreamSource(target).connect(analyser)
    this.analyser = analyser

    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(target, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 192_000
    })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(250)
    this.startedAt = performance.now()
  }

  pause(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.pause()
      this.pausedAt = performance.now()
    }
  }

  resume(): void {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume()
      this.pausedFor += performance.now() - this.pausedAt
      this.pausedAt = 0
    }
  }

  cancel(): void {
    try {
      this.recorder?.stop()
    } catch {
      /* already stopped */
    }
    this.cleanup()
  }

  async stop(format: RecordFormat = 'wav'): Promise<RecordingResult | null> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return null

    const duration = this.elapsed()

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.stop()
    })

    this.cleanup()

    if (!blob.size) return null

    if (format === 'webm') {
      const raw = new Uint8Array(await blob.arrayBuffer())
      const extension = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm'
      return { data: raw, extension, duration }
    }

    // WAV keeps the file usable in every other app the user might open it with.
    const arrayBuffer = await blob.arrayBuffer()
    const decoded = await decodeContext().decodeAudioData(arrayBuffer)
    const channels: Float32Array[] = []
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      channels.push(decoded.getChannelData(ch).slice())
    }
    return {
      data: encodeWav({ channels, sampleRate: decoded.sampleRate }),
      extension: 'wav',
      duration: decoded.duration
    }
  }

  private cleanup(): void {
    for (const stream of this.streams) stream.getTracks().forEach((track) => track.stop())
    this.streams = []
    this.recorder = null
    this.analyser = null
    this.mixCtx?.close().catch(() => {})
    this.mixCtx = null
    this.startedAt = 0
  }
}

export const recorder = new Recorder()
