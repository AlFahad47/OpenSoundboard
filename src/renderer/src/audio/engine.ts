import type { Settings, Sound } from '@shared/types'
import { cachedAudio, decodeFile, type DecodedAudio } from './decoder'

/**
 * Dual-output playback engine.
 *
 * Two independent AudioContexts run in parallel:
 *   monitor    -> the user's own headphones/speakers
 *   broadcast  -> the virtual cable other people hear
 *
 * Each sound is started on both at the same wall-clock instant, so what you
 * hear and what the room hears stay in step. The microphone is mixed into the
 * broadcast bus only (optionally monitored) and ducks while a sound plays.
 */

export type BusId = 'monitor' | 'broadcast'

interface Bus {
  id: BusId
  ctx: AudioContext
  /** Sound bed for this bus. */
  sfx: GainNode
  /** Post-duck microphone level. */
  mic: GainNode
  /** Ducking envelope, driven when sounds start and stop. */
  duck: GainNode
  /** Everything merges here before metering. */
  sum: GainNode
  analyser: AnalyserNode
  micSource: MediaStreamAudioSourceNode | null
  deviceId: string
  /** Only used when AudioContext.setSinkId is unavailable. */
  element: HTMLAudioElement | null
  streamDest: MediaStreamAudioDestinationNode | null
}

interface VoicePart {
  bus: Bus
  source: AudioBufferSourceNode
  gain: GainNode
}

export interface Voice {
  voiceId: number
  soundId: string
  parts: VoicePart[]
  /** Monitor-context time at which position 0 of the segment was heard. */
  clockStart: number
  /** Seconds into the segment where this pass began. */
  offset: number
  rate: number
  loop: boolean
  segStart: number
  segEnd: number
  duration: number
  preview: boolean
  paused: boolean
  pausedAt: number
  gain: number
  fadeOut: number
}

export interface EngineSnapshot {
  ready: boolean
  playing: string[]
  currentVoiceId: number | null
  currentSoundId: string | null
  paused: boolean
  micActive: boolean
  micError: string | null
  broadcastReady: boolean
  broadcastError: string | null
  /** Grows every time devices are re-enumerated so the UI can re-read them. */
  deviceEpoch: number
}

export interface Levels {
  monitor: number
  broadcast: number
  mic: number
}

type Listener = () => void

const SILENCE = 0.0001

class AudioEngine {
  private monitor: Bus | null = null
  private broadcast: Bus | null = null
  private micStream: MediaStream | null = null
  private micAnalyser: AnalyserNode | null = null

  private voices = new Map<number, Voice>()
  private nextVoiceId = 1
  private settings: Settings | null = null

  /**
   * Device ids actually wired into the graph. These must be tracked separately
   * from `settings`, because updateSettings() replaces the whole settings object
   * (new ids included) before setDevices() runs — comparing against settings
   * would make every device change look like a no-op and silently skip the
   * rebuild, leaving the broadcast bus closed.
   */
  private appliedMonitorId: string | null = null
  private appliedBroadcastId: string | null = null
  private appliedMicId: string | null = null

  private listeners = new Set<Listener>()
  private snapshot: EngineSnapshot = {
    ready: false,
    playing: [],
    currentVoiceId: null,
    currentSoundId: null,
    paused: false,
    micActive: false,
    micError: null,
    broadcastReady: false,
    broadcastError: null,
    deviceEpoch: 0
  }

  private meterBuf = new Float32Array(1024)
  private onSoundEnded: ((soundId: string) => void) | null = null

  // ---------------------------------------------------------------- lifecycle

  async init(settings: Settings): Promise<void> {
    this.settings = settings
    this.monitor = await this.createBus('monitor', settings.monitorDeviceId)
    this.appliedMonitorId = settings.monitorDeviceId
    await this.rebuildBroadcast(settings.broadcastDeviceId)
    this.appliedBroadcastId = settings.broadcastDeviceId
    this.appliedMicId = settings.micDeviceId
    await this.applyMic()
    this.applyLevels()
    this.patch({ ready: Boolean(this.monitor) })

    navigator.mediaDevices?.addEventListener('devicechange', this.handleDeviceChange)
  }

  private handleDeviceChange = (): void => {
    this.patch({ deviceEpoch: this.snapshot.deviceEpoch + 1 })
  }

  destroy(): void {
    navigator.mediaDevices?.removeEventListener('devicechange', this.handleDeviceChange)
    this.stopAll(true)
    this.releaseMic()
    for (const bus of [this.monitor, this.broadcast]) {
      if (!bus) continue
      bus.element?.pause()
      bus.element?.remove()
      bus.ctx.close().catch(() => {})
    }
    this.monitor = null
    this.broadcast = null
  }

  // ------------------------------------------------------------------- buses

  private async createBus(id: BusId, deviceId: string): Promise<Bus | null> {
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      const sum = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.55

      const sfx = ctx.createGain()
      const duck = ctx.createGain()
      const mic = ctx.createGain()

      sfx.connect(sum)
      duck.connect(mic)
      mic.connect(sum)
      sum.connect(analyser)

      const bus: Bus = {
        id,
        ctx,
        sfx,
        mic,
        duck,
        sum,
        analyser,
        micSource: null,
        deviceId,
        element: null,
        streamDest: null
      }

      await this.routeBus(bus, deviceId)
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      return bus
    } catch (err) {
      console.error(`[engine] could not create ${id} bus:`, err)
      return null
    }
  }

  /**
   * Points a bus at a specific output device. Prefers AudioContext.setSinkId;
   * falls back to piping through a hidden <audio> element, which every
   * Chromium build supports.
   */
  private async routeBus(bus: Bus, deviceId: string): Promise<void> {
    bus.analyser.disconnect()
    bus.element?.pause()
    bus.streamDest = null

    const wantsDefault = !deviceId || deviceId === 'default'

    if (!wantsDefault && typeof (bus.ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function') {
      try {
        await (bus.ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId)
        bus.analyser.connect(bus.ctx.destination)
        bus.deviceId = deviceId
        if (bus.element) {
          bus.element.pause()
          bus.element.srcObject = null
        }
        return
      } catch (err) {
        console.warn('[engine] setSinkId rejected, using element routing:', err)
      }
    }

    if (wantsDefault) {
      bus.analyser.connect(bus.ctx.destination)
      bus.deviceId = 'default'
      if (bus.element) {
        bus.element.pause()
        bus.element.srcObject = null
      }
      return
    }

    const dest = bus.ctx.createMediaStreamDestination()
    bus.analyser.connect(dest)
    bus.streamDest = dest

    let element = bus.element
    if (!element) {
      element = document.createElement('audio')
      element.autoplay = true
      element.style.display = 'none'
      document.body.appendChild(element)
      bus.element = element
    }
    element.srcObject = dest.stream
    const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (typeof withSink.setSinkId === 'function') {
      await withSink.setSinkId(deviceId)
    }
    await element.play().catch((err) => console.warn('[engine] sink element play failed:', err))
    bus.deviceId = deviceId
  }

  private async rebuildBroadcast(deviceId: string): Promise<void> {
    if (!deviceId) {
      // No cable chosen yet — the app still works as a local soundboard.
      if (this.broadcast) {
        this.broadcast.ctx.close().catch(() => {})
        this.broadcast.element?.remove()
        this.broadcast = null
      }
      this.patch({ broadcastReady: false, broadcastError: null })
      return
    }

    if (this.broadcast) {
      try {
        await this.routeBus(this.broadcast, deviceId)
        this.patch({ broadcastReady: true, broadcastError: null })
        return
      } catch (err) {
        console.warn('[engine] re-route failed, recreating bus:', err)
        this.broadcast.ctx.close().catch(() => {})
        this.broadcast.element?.remove()
        this.broadcast = null
      }
    }

    this.broadcast = await this.createBus('broadcast', deviceId)
    this.patch({
      broadcastReady: Boolean(this.broadcast),
      broadcastError: this.broadcast ? null : 'Could not open the output device.'
    })
    if (this.broadcast) {
      // Must go through wireMicBuses, not attachMicTo: the latter only patches
      // audio, leaving the meter's analyser bound to the old (or no) bus, so
      // the mic level would read zero forever even with passthrough working.
      this.wireMicBuses()
      // wireMicBuses bails early before the mic stream exists, so make sure the
      // new bus still gets its gains.
      this.applyLevels()
    }
  }

  // ------------------------------------------------------------------ devices

  async setDevices(next: {
    monitorDeviceId?: string
    broadcastDeviceId?: string
    micDeviceId?: string
  }): Promise<void> {
    if (!this.settings) return

    if (next.monitorDeviceId !== undefined && next.monitorDeviceId !== this.appliedMonitorId) {
      this.settings.monitorDeviceId = next.monitorDeviceId
      this.appliedMonitorId = next.monitorDeviceId
      if (this.monitor) await this.routeBus(this.monitor, next.monitorDeviceId)
    }

    if (next.broadcastDeviceId !== undefined && next.broadcastDeviceId !== this.appliedBroadcastId) {
      this.settings.broadcastDeviceId = next.broadcastDeviceId
      this.appliedBroadcastId = next.broadcastDeviceId
      await this.rebuildBroadcast(next.broadcastDeviceId)
    }

    if (next.micDeviceId !== undefined && next.micDeviceId !== this.appliedMicId) {
      this.settings.micDeviceId = next.micDeviceId
      this.appliedMicId = next.micDeviceId
      await this.applyMic(true)
    }
  }

  /** Device labels stay blank until the user has granted mic access once. */
  async listDevices(): Promise<{ outputs: MediaDeviceInfo[]; inputs: MediaDeviceInfo[] }> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return {
        outputs: devices.filter((d) => d.kind === 'audiooutput'),
        inputs: devices.filter((d) => d.kind === 'audioinput')
      }
    } catch {
      return { outputs: [], inputs: [] }
    }
  }

  // ---------------------------------------------------------------------- mic

  private releaseMic(): void {
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
    this.micAnalyser = null
    for (const bus of [this.monitor, this.broadcast]) {
      if (bus?.micSource) {
        bus.micSource.disconnect()
        bus.micSource = null
      }
    }
  }

  private attachMicTo(bus: Bus): void {
    if (!this.micStream) return
    if (bus.micSource) {
      bus.micSource.disconnect()
      bus.micSource = null
    }
    try {
      const source = bus.ctx.createMediaStreamSource(this.micStream)
      source.connect(bus.duck)
      bus.micSource = source
    } catch (err) {
      console.warn('[engine] mic attach failed for', bus.id, err)
    }
  }

  async applyMic(force = false): Promise<void> {
    const settings = this.settings
    if (!settings) return

    const wanted = settings.micPassthrough || settings.micMonitor
    if (!wanted) {
      this.releaseMic()
      this.patch({ micActive: false, micError: null })
      return
    }

    if (this.micStream && !force) {
      this.wireMicBuses()
      this.patch({ micActive: true, micError: null })
      return
    }

    this.releaseMic()
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          ...(settings.micDeviceId && settings.micDeviceId !== 'default'
            ? { deviceId: { exact: settings.micDeviceId } }
            : {}),
          // Raw signal: processing would chew up the sounds we mix alongside it.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints)
      this.wireMicBuses()
      this.patch({ micActive: true, micError: null })
    } catch (err) {
      console.warn('[engine] microphone unavailable:', err)
      this.patch({ micActive: false, micError: (err as Error)?.message ?? 'Microphone unavailable' })
    }
  }

  private wireMicBuses(): void {
    const settings = this.settings
    if (!settings || !this.micStream) return

    if (settings.micPassthrough && this.broadcast) this.attachMicTo(this.broadcast)
    else if (this.broadcast?.micSource) {
      this.broadcast.micSource.disconnect()
      this.broadcast.micSource = null
    }

    if (settings.micMonitor && this.monitor) this.attachMicTo(this.monitor)
    else if (this.monitor?.micSource) {
      this.monitor.micSource.disconnect()
      this.monitor.micSource = null
    }

    // Meter off the broadcast side when available so the bar shows what others get.
    this.micAnalyser?.disconnect()
    this.micAnalyser = null

    const meterBus = this.broadcast ?? this.monitor
    if (meterBus?.micSource) {
      const analyser = meterBus.ctx.createAnalyser()
      analyser.fftSize = 1024
      meterBus.micSource.connect(analyser)
      this.micAnalyser = analyser
    } else if (this.micStream && meterBus) {
      // Passthrough is off, but the user still needs to see whether their
      // microphone works — meter it without routing it anywhere.
      try {
        const source = meterBus.ctx.createMediaStreamSource(this.micStream)
        const analyser = meterBus.ctx.createAnalyser()
        analyser.fftSize = 1024
        source.connect(analyser)
        this.micAnalyser = analyser
      } catch {
        /* metering is best-effort */
      }
    }
    this.applyLevels()
  }

  // ------------------------------------------------------------------- levels

  updateSettings(settings: Settings): void {
    const previous = this.settings
    this.settings = settings
    this.applyLevels()

    if (
      previous &&
      (previous.micPassthrough !== settings.micPassthrough ||
        previous.micMonitor !== settings.micMonitor)
    ) {
      void this.applyMic()
    }
  }

  private applyLevels(): void {
    const settings = this.settings
    if (!settings) return
    const now = (bus: Bus) => bus.ctx.currentTime

    if (this.monitor) {
      const target = settings.masterVolume * settings.monitorVolume
      this.monitor.sfx.gain.setTargetAtTime(target, now(this.monitor), 0.01)
      this.monitor.mic.gain.setTargetAtTime(
        settings.micMonitor ? settings.micVolume : 0,
        now(this.monitor),
        0.01
      )
    }

    if (this.broadcast) {
      const target = settings.masterVolume * settings.broadcastVolume
      this.broadcast.sfx.gain.setTargetAtTime(target, now(this.broadcast), 0.01)
      this.broadcast.mic.gain.setTargetAtTime(
        settings.micPassthrough ? settings.micVolume : 0,
        now(this.broadcast),
        0.01
      )
    }
  }

  private applyDuck(active: boolean): void {
    const settings = this.settings
    if (!settings) return

    for (const bus of [this.monitor, this.broadcast]) {
      if (!bus) continue
      const target = active && settings.ducking ? Math.max(0, 1 - settings.duckAmount) : 1
      const time = active ? settings.duckAttack : settings.duckRelease
      bus.duck.gain.cancelScheduledValues(bus.ctx.currentTime)
      bus.duck.gain.setTargetAtTime(target, bus.ctx.currentTime, Math.max(0.01, time / 1000 / 3))
    }
  }

  levels(): Levels {
    const read = (analyser: AnalyserNode | null | undefined): number => {
      if (!analyser) return 0
      const size = analyser.fftSize
      if (this.meterBuf.length < size) this.meterBuf = new Float32Array(size)
      const view = this.meterBuf.subarray(0, size)
      analyser.getFloatTimeDomainData(view)
      let sum = 0
      for (let i = 0; i < size; i++) sum += view[i] * view[i]
      // RMS mapped onto a perceptual curve so quiet signals still move the meter.
      return Math.min(1, Math.sqrt(sum / size) * 2.6)
    }
    return {
      monitor: read(this.monitor?.analyser),
      broadcast: read(this.broadcast?.analyser),
      mic: read(this.micAnalyser)
    }
  }

  // ----------------------------------------------------------------- playback

  onEnded(handler: (soundId: string) => void): void {
    this.onSoundEnded = handler
  }

  private effectiveGain(sound: Sound, decoded: DecodedAudio): number {
    const settings = this.settings
    let gain = Math.max(0, sound.volume)
    if (settings?.normalize && decoded.peak > SILENCE) {
      gain *= Math.min(4, settings.normalizeTarget / decoded.peak)
    }
    return gain
  }

  async play(
    sound: Sound,
    options: { preview?: boolean; restart?: boolean; seek?: number } = {}
  ): Promise<number | null> {
    if (!this.monitor) return null
    const settings = this.settings
    if (!settings) return null

    const decoded = cachedAudio(sound.id) ?? (await decodeFile(sound.id, sound.path))
    if (!decoded) return null

    if (settings.exclusivePlayback && !options.preview) this.stopAll()
    else if (options.restart !== false) this.stopSound(sound.id)

    const segStart = Math.max(0, Math.min(sound.trimStart, decoded.duration))
    const segEnd =
      sound.trimEnd > segStart ? Math.min(sound.trimEnd, decoded.duration) : decoded.duration
    const segLength = Math.max(0.01, segEnd - segStart)
    const offset = Math.max(0, Math.min(options.seek ?? 0, segLength - 0.01))

    const preview = Boolean(options.preview) && settings.previewOnMonitor
    const targets: Bus[] = preview
      ? [this.monitor]
      : ([this.monitor, this.broadcast].filter(Boolean) as Bus[])
    if (!targets.length) return null

    const gain = this.effectiveGain(sound, decoded)
    const rate = Math.max(0.25, Math.min(4, sound.speed || 1))
    const detune = Math.max(-2400, Math.min(2400, (sound.pitch || 0) * 100))

    // Schedule slightly ahead so both contexts start the same audio frame.
    const lead = 0.03
    const voiceId = this.nextVoiceId++
    const parts: VoicePart[] = []

    for (const bus of targets) {
      const source = bus.ctx.createBufferSource()
      source.buffer = decoded.buffer
      source.playbackRate.value = rate
      try {
        source.detune.value = detune
      } catch {
        /* detune is optional in some builds */
      }
      if (sound.loop) {
        source.loop = true
        source.loopStart = segStart
        source.loopEnd = segEnd
      }

      const voiceGain = bus.ctx.createGain()
      const startAt = bus.ctx.currentTime + lead

      if (sound.fadeIn > 0) {
        voiceGain.gain.setValueAtTime(SILENCE, startAt)
        voiceGain.gain.exponentialRampToValueAtTime(
          Math.max(SILENCE, gain),
          startAt + sound.fadeIn
        )
      } else {
        voiceGain.gain.setValueAtTime(gain, startAt)
      }

      if (sound.fadeOut > 0 && !sound.loop) {
        const playSeconds = (segLength - offset) / rate
        const fadeStart = startAt + Math.max(0, playSeconds - sound.fadeOut)
        voiceGain.gain.setValueAtTime(gain, fadeStart)
        voiceGain.gain.exponentialRampToValueAtTime(SILENCE, fadeStart + sound.fadeOut)
      }

      source.connect(voiceGain)
      voiceGain.connect(bus.sfx)

      if (sound.loop) {
        source.start(startAt, segStart + offset)
      } else {
        source.start(startAt, segStart + offset, Math.max(0.01, segLength - offset))
      }

      parts.push({ bus, source, gain: voiceGain })
    }

    const voice: Voice = {
      voiceId,
      soundId: sound.id,
      parts,
      clockStart: this.monitor.ctx.currentTime + lead,
      offset,
      rate,
      loop: sound.loop,
      segStart,
      segEnd,
      duration: segLength,
      preview,
      paused: false,
      pausedAt: 0,
      gain,
      fadeOut: settings.stopFade
    }

    // The monitor part owns end-of-life; broadcast follows the same schedule.
    parts[0].source.onended = () => this.retire(voiceId)

    this.voices.set(voiceId, voice)
    this.applyDuck(true)
    this.publish()
    return voiceId
  }

  /**
   * Drops a voice from the active set and tears its nodes down.
   *
   * `teardownAfter` exists because disconnecting a node severs it from the graph
   * instantly, which silences any fade still in flight. When a stop fade has
   * been scheduled we keep the nodes connected until it has actually played out;
   * the bookkeeping (map, duck, listeners) still happens immediately so the UI
   * reacts on the keypress rather than `stopFade` milliseconds later.
   */
  private retire(voiceId: number, teardownAfter = 0): void {
    const voice = this.voices.get(voiceId)
    if (!voice) return
    this.voices.delete(voiceId)

    const teardown = (): void => {
      for (const part of voice.parts) {
        try {
          part.source.disconnect()
          part.gain.disconnect()
        } catch {
          /* already torn down */
        }
      }
    }

    if (teardownAfter > 0) window.setTimeout(teardown, teardownAfter * 1000 + 60)
    else teardown()

    if (!this.voices.size) this.applyDuck(false)
    this.onSoundEnded?.(voice.soundId)
    this.publish()
  }

  /** Returns the fade length actually scheduled, in seconds. */
  private fadeOutVoice(voice: Voice, immediate: boolean): number {
    const fade = immediate ? 0 : Math.max(0, voice.fadeOut) / 1000
    for (const part of voice.parts) {
      const now = part.bus.ctx.currentTime
      try {
        if (fade > 0) {
          part.gain.gain.cancelScheduledValues(now)
          part.gain.gain.setValueAtTime(Math.max(SILENCE, part.gain.gain.value), now)
          part.gain.gain.exponentialRampToValueAtTime(SILENCE, now + fade)
          part.source.stop(now + fade + 0.01)
        } else {
          part.source.stop()
        }
      } catch {
        /* a source that already ended throws, which is fine */
      }
    }
    return fade
  }

  stopSound(soundId: string, immediate = false): void {
    for (const voice of [...this.voices.values()]) {
      if (voice.soundId === soundId) {
        // Detach the handler so retire runs once, right now, not after the fade.
        voice.parts[0].source.onended = null
        this.retire(voice.voiceId, this.fadeOutVoice(voice, immediate))
      }
    }
  }

  stopVoice(voiceId: number, immediate = false): void {
    const voice = this.voices.get(voiceId)
    if (!voice) return
    voice.parts[0].source.onended = null
    this.retire(voiceId, this.fadeOutVoice(voice, immediate))
  }

  stopAll(immediate = false): void {
    for (const voice of [...this.voices.values()]) {
      voice.parts[0].source.onended = null
      this.retire(voice.voiceId, this.fadeOutVoice(voice, immediate))
    }
    this.applyDuck(false)
  }

  /** Suspending the contexts freezes playback without losing the graph. */
  async pause(): Promise<void> {
    if (!this.voices.size) return
    for (const bus of [this.monitor, this.broadcast]) {
      if (bus && bus.ctx.state === 'running') await bus.ctx.suspend().catch(() => {})
    }
    this.patch({ paused: true })
  }

  async resume(): Promise<void> {
    for (const bus of [this.monitor, this.broadcast]) {
      if (bus && bus.ctx.state === 'suspended') await bus.ctx.resume().catch(() => {})
    }
    this.patch({ paused: false })
  }

  async togglePause(): Promise<void> {
    if (this.snapshot.paused) await this.resume()
    else await this.pause()
  }

  /** Buffer sources cannot seek, so we restart the newest voice at the new offset. */
  async seek(sound: Sound, seconds: number): Promise<void> {
    const voice = this.current()
    const preview = voice?.preview ?? false
    this.stopSound(sound.id, true)
    if (this.snapshot.paused) await this.resume()
    await this.play(sound, { seek: seconds, preview })
  }

  current(): Voice | null {
    let latest: Voice | null = null
    for (const voice of this.voices.values()) {
      if (!latest || voice.voiceId > latest.voiceId) latest = voice
    }
    return latest
  }

  /** Seconds into the trimmed segment, wrapped for looping voices. */
  position(voiceId?: number): number {
    const voice = voiceId ? this.voices.get(voiceId) : this.current()
    if (!voice || !this.monitor) return 0
    const elapsed = (this.monitor.ctx.currentTime - voice.clockStart) * voice.rate
    const raw = voice.offset + Math.max(0, elapsed)
    if (voice.loop && voice.duration > 0) return raw % voice.duration
    return Math.min(raw, voice.duration)
  }

  isPlaying(soundId: string): boolean {
    for (const voice of this.voices.values()) if (voice.soundId === soundId) return true
    return false
  }

  activeSoundIds(): string[] {
    return [...new Set([...this.voices.values()].map((v) => v.soundId))]
  }

  /** Live volume change for a sound that is already playing. */
  setVoiceGain(soundId: string, gain: number): void {
    for (const voice of this.voices.values()) {
      if (voice.soundId !== soundId) continue
      voice.gain = gain
      for (const part of voice.parts) {
        part.gain.gain.setTargetAtTime(gain, part.bus.ctx.currentTime, 0.02)
      }
    }
  }

  // ------------------------------------------------------------------- events

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  private patch(next: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  private publish(): void {
    const current = this.current()
    this.patch({
      playing: this.activeSoundIds(),
      currentVoiceId: current?.voiceId ?? null,
      currentSoundId: current?.soundId ?? null,
      paused: this.voices.size ? this.snapshot.paused : false
    })
  }
}

export const engine = new AudioEngine()
