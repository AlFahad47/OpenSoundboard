import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createDefaultLibrary, DEFAULT_HOTKEYS, DEFAULT_SETTINGS, type Library } from '../shared/types'

const FILE = () => path.join(app.getPath('userData'), 'library.json')
const BACKUP = () => path.join(app.getPath('userData'), 'library.backup.json')

let writeQueue: Promise<void> = Promise.resolve()

/** Fills in anything a older/partial library file is missing so upgrades never crash the UI. */
function migrate(raw: unknown): Library {
  const base = createDefaultLibrary()
  if (!raw || typeof raw !== 'object') return base
  const lib = raw as Partial<Library>

  const settings = {
    ...base.settings,
    ...(lib.settings ?? {}),
    globalHotkeys: { ...DEFAULT_HOTKEYS, ...(lib.settings?.globalHotkeys ?? {}) }
  }
  // A missing recordings dir points at the user's Music folder by default.
  if (!settings.recordingsDir) {
    settings.recordingsDir = path.join(app.getPath('music'), 'OpenSoundboard Recordings')
  }

  const sounds = Array.isArray(lib.sounds)
    ? lib.sounds.filter((s) => s && typeof s.path === 'string').map((s) => ({
        id: String(s.id ?? crypto.randomUUID()),
        path: s.path,
        name: s.name ?? path.basename(s.path, path.extname(s.path)),
        categoryId: s.categoryId ?? null,
        tags: Array.isArray(s.tags) ? s.tags : [],
        hotkey: s.hotkey ?? null,
        volume: numberOr(s.volume, 1),
        pitch: numberOr(s.pitch, 0),
        speed: numberOr(s.speed, 1),
        color: s.color ?? null,
        duration: numberOr(s.duration, 0),
        trimStart: numberOr(s.trimStart, 0),
        trimEnd: numberOr(s.trimEnd, 0),
        fadeIn: numberOr(s.fadeIn, 0),
        fadeOut: numberOr(s.fadeOut, 0),
        loop: Boolean(s.loop),
        favorite: Boolean(s.favorite),
        playCount: numberOr(s.playCount, 0),
        lastPlayed: s.lastPlayed ?? null,
        addedAt: numberOr(s.addedAt, Date.now()),
        missing: Boolean(s.missing),
        size: numberOr(s.size, 0)
      }))
    : []

  const categories = Array.isArray(lib.categories) && lib.categories.length ? lib.categories : base.categories

  return { version: 1, sounds, categories, settings: { ...DEFAULT_SETTINGS, ...settings } }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export async function loadLibrary(): Promise<Library> {
  for (const file of [FILE(), BACKUP()]) {
    try {
      if (!existsSync(file)) continue
      const text = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(text)
      // `null`, `[]` and other valid-JSON-but-wrong-shape values would sail
      // through migrate() and come back as an empty library, silently wiping a
      // user who still has a perfectly good backup. Treat them as corruption.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('library file is not an object')
      }
      return migrate(parsed)
    } catch (err) {
      console.error(`[store] could not read ${file}:`, err)
    }
  }
  return migrate(null)
}

/**
 * Writes are serialised and atomic: we render to a temp file, keep the previous
 * good copy as a backup, then swap. A crash mid-save can never truncate the library.
 */
export function saveLibrary(library: Library): Promise<void> {
  writeQueue = writeQueue
    .then(async () => {
      const file = FILE()
      const tmp = `${file}.tmp`
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(library, null, 2), 'utf8')
      if (existsSync(file)) {
        try {
          renameSync(file, BACKUP())
        } catch {
          /* backup is best-effort */
        }
      }
      await fs.rename(tmp, file)
    })
    .catch((err) => {
      console.error('[store] save failed:', err)
    })
  return writeQueue
}
