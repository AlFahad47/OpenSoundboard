import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  findCableCapture,
  getDefaultEndpoint,
  listEndpoints,
  setDefaultEndpoint,
  type Endpoint
} from './audio-policy'

/**
 * Points Windows' default *communications* microphone at the virtual cable, so
 * Discord, games and anything else that follows the system default pick OpenSoundboard
 * up with no configuration of their own. This is the step that used to require
 * opening another app and hunting for "CABLE Output".
 *
 * The previous device is written to disk before we touch anything, and restored
 * when OpenSoundboard exits — leaving the default mic on a cable that nothing is
 * feeding would make the user silent in every call.
 */

interface SavedRoute {
  id: string
  name: string
  /** The cable we switched to, so we can tell if something else changed it since. */
  cableId: string
}

/**
 * Presence of this file is the single source of truth for "we changed the
 * user's microphone and owe them a restore". Using the file rather than an
 * in-memory flag means a crashed session is repaired on next launch, and that
 * a quit costs nothing when the feature was never switched on.
 */
const STATE_FILE = (): string => path.join(app.getPath('userData'), 'voice-routing.json')

async function readSaved(): Promise<SavedRoute | null> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE(), 'utf8')) as SavedRoute
  } catch {
    return null
  }
}

async function writeSaved(route: SavedRoute | null): Promise<void> {
  try {
    if (route) await fs.writeFile(STATE_FILE(), JSON.stringify(route), 'utf8')
    else await fs.rm(STATE_FILE(), { force: true })
  } catch (err) {
    console.error('[voice-routing] could not persist state:', err)
  }
}

export interface VoiceRoutingStatus {
  supported: boolean
  active: boolean
  /** Name of the cable currently receiving voice-app audio. */
  cableName: string | null
  /** What we will put back when OpenSoundboard exits. */
  restoreName: string | null
  /** Set when the cable capture endpoint could not be found. */
  error: string | null
}

export async function voiceRoutingStatus(): Promise<VoiceRoutingStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, active: false, cableName: null, restoreName: null, error: null }
  }

  const current = await getDefaultEndpoint('capture', 'communications')
  const saved = await readSaved()
  const cable = findCableCapture(await listEndpoints('capture'))

  return {
    supported: true,
    active: Boolean(current && cable && current.id === cable.id),
    cableName: cable?.name ?? null,
    restoreName: saved?.name ?? null,
    error: cable ? null : 'No virtual cable input was found.'
  }
}

export async function enableVoiceRouting(): Promise<VoiceRoutingStatus> {
  const captures = await listEndpoints('capture')
  const cable = findCableCapture(captures)
  if (!cable) {
    return {
      supported: true,
      active: false,
      cableName: null,
      restoreName: null,
      error: 'No virtual cable was found. Install the audio cable first.'
    }
  }

  const current = await getDefaultEndpoint('capture', 'communications')

  // Only record the previous device the first time, so repeated toggles do not
  // overwrite the real microphone with the cable itself.
  if (current && current.id !== cable.id) {
    await writeSaved({ id: current.id, name: current.name, cableId: cable.id })
  }

  const hresult = await setDefaultEndpoint(cable.id, 'communications')
  if (hresult !== 0) {
    return {
      supported: true,
      active: false,
      cableName: cable.name,
      restoreName: current?.name ?? null,
      error: `Windows refused the change (0x${(hresult >>> 0).toString(16)}).`
    }
  }

  return voiceRoutingStatus()
}

export async function disableVoiceRouting(): Promise<VoiceRoutingStatus> {
  const saved = await readSaved()
  if (saved) {
    await setDefaultEndpoint(saved.id, 'communications')
    await writeSaved(null)
  }
  return voiceRoutingStatus()
}

/**
 * Puts the microphone back. Called on quit, and on startup to recover from a
 * crash that left the default pointing at the cable.
 */
export async function restoreVoiceRouting(): Promise<void> {
  const saved = await readSaved()
  if (!saved) return

  const current = await getDefaultEndpoint('capture', 'communications')
  // If the user moved it somewhere else themselves, leave their choice alone.
  if (current && current.id !== saved.cableId) {
    await writeSaved(null)
    return
  }

  await setDefaultEndpoint(saved.id, 'communications')
  await writeSaved(null)
}

/** Cheap synchronous check so quitting is instant when we owe nothing. */
export function needsRestore(): boolean {
  try {
    return existsSync(STATE_FILE())
  } catch {
    return false
  }
}

/** Re-applies the routing at startup, or repairs what a crashed session left behind. */
export async function reapplyVoiceRouting(enabled: boolean): Promise<void> {
  if (process.platform !== 'win32') return
  if (enabled) await enableVoiceRouting()
  else await restoreVoiceRouting()
}

export type { Endpoint }
