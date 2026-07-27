import { useCallback, useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'
import { useEngine } from './useEngine'

export interface DeviceLists {
  outputs: MediaDeviceInfo[]
  inputs: MediaDeviceInfo[]
  /** True once labels are populated, which needs one granted getUserMedia. */
  labelled: boolean
  refresh: () => Promise<void>
}

/**
 * Devices that contain "virtual" but are not loopback cables — routing sound to
 * these would send it nowhere useful. NVIDIA's device backs HDMI/stream audio,
 * Voicemod and DroidCam are capture-side effects, not cables.
 */
const NOT_A_CABLE = /nvidia|droidcam|voicemod|realtek|high definition audio|speakers \(am[d]?|intel\b/i

/**
 * Higher score = more likely to be the endpoint that feeds another app's
 * microphone. Ranked rather than boolean because a machine can easily have
 * several virtual devices and only one of them is the right target.
 */
const CABLE_RULES: { pattern: RegExp; score: number }[] = [
  { pattern: /cable input/i, score: 100 }, // VB-CABLE's playback endpoint
  { pattern: /vb-?[ ]?audio.*(virtual )?cable/i, score: 90 },
  { pattern: /voicemeeter (input|aux input|vaio|aux)/i, score: 70 },
  { pattern: /virtual cable|\bvac\b/i, score: 60 },
  { pattern: /blackhole|^line 1/i, score: 50 },
  { pattern: /vb-?[ ]?audio/i, score: 40 },
  { pattern: /virtual audio/i, score: 15 }
]

export function cableScore(label: string): number {
  if (!label || NOT_A_CABLE.test(label)) return 0
  let best = 0
  for (const rule of CABLE_RULES) {
    if (rule.pattern.test(label) && rule.score > best) best = rule.score
  }
  return best
}

/** Marks a device with a ★ in the pickers. */
export function looksVirtual(label: string): boolean {
  return cableScore(label) > 0
}

/** The single best broadcast target on this machine, if there is one. */
export function bestCable(outputs: MediaDeviceInfo[]): MediaDeviceInfo | null {
  let winner: MediaDeviceInfo | null = null
  let best = 0
  for (const device of outputs) {
    const score = cableScore(device.label)
    if (score > best) {
      best = score
      winner = device
    }
  }
  return winner
}

/**
 * Picks the cable for the user once one exists. Without this they still have to
 * understand which of a dozen output devices is the right one.
 */
export function useAutoSelectCable(outputs: MediaDeviceInfo[]): void {
  const broadcastDeviceId = useStore((s) => s.settings.broadcastDeviceId)
  const updateSettings = useStore((s) => s.updateSettings)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (broadcastDeviceId) return
    const cable = bestCable(outputs)
    if (!cable) return
    updateSettings({ broadcastDeviceId: cable.deviceId })
    toast(`Broadcasting through ${cable.label}`, 'success')
  }, [outputs, broadcastDeviceId, updateSettings, toast])
}

export function useDevices(): DeviceLists {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const snapshot = useEngine()

  const refresh = useCallback(async () => {
    const lists = await engine.listDevices()
    setOutputs(lists.outputs)
    setInputs(lists.inputs)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, snapshot.deviceEpoch])

  return {
    outputs,
    inputs,
    labelled: outputs.some((device) => device.label.length > 0),
    refresh
  }
}
