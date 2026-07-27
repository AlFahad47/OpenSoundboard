import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  Category,
  ImportedFile,
  Library,
  PadSize,
  Settings,
  SortKey,
  Sound,
  ViewMode
} from '@shared/types'
import { DEFAULT_SETTINGS, createDefaultLibrary } from '@shared/types'
import { engine } from '../audio/engine'
import { decodeFile, forget, warm } from '../audio/decoder'

export type Panel = 'library' | 'recorder' | 'settings'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

const PAD_COLORS = [
  '#7c5cff',
  '#f06595',
  '#4dabf7',
  '#51cf66',
  '#ffd43b',
  '#ff922b',
  '#22d3ee',
  '#e599f7'
]

/** Stable colour per sound so pads look intentional without the user picking one. */
export function autoColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PAD_COLORS[hash % PAD_COLORS.length]
}

export function colorOf(sound: Sound): string {
  return sound.color ?? autoColor(sound.id)
}

interface State {
  loaded: boolean
  sounds: Sound[]
  categories: Category[]
  settings: Settings

  panel: Panel
  activeCategory: string | 'all' | 'favorites' | 'recent'
  search: string
  selection: string[]
  quickSearchOpen: boolean
  editorSoundId: string | null
  onboardingOpen: boolean
  hotkeyConflicts: string[]
  toasts: Toast[]

  load: () => Promise<void>
  persist: () => void

  addFiles: (files: ImportedFile[], categoryId?: string | null) => Promise<number>
  removeSounds: (ids: string[]) => void
  updateSound: (id: string, patch: Partial<Sound>) => void
  updateSounds: (ids: string[], patch: Partial<Sound>) => void
  moveSound: (id: string, targetId: string) => void
  verifyFiles: () => Promise<void>

  addCategory: (name: string) => string
  updateCategory: (id: string, patch: Partial<Category>) => void
  removeCategory: (id: string, deleteSounds: boolean) => void

  updateSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void

  setPanel: (panel: Panel) => void
  setActiveCategory: (id: State['activeCategory']) => void
  setSearch: (value: string) => void
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string, additive: boolean) => void
  setQuickSearch: (open: boolean) => void
  setEditorSound: (id: string | null) => void
  setOnboarding: (open: boolean) => void
  setView: (view: ViewMode) => void
  setPadSize: (size: PadSize) => void
  setSort: (sort: SortKey) => void

  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void

  playSound: (id: string, options?: { preview?: boolean }) => Promise<void>
  stopSound: (id: string) => void
  stopAll: () => void
  playRandom: () => Promise<void>
  playNext: (direction: 1 | -1) => Promise<void>
  nudgeVolume: (delta: number) => void
  syncHotkeys: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let toastSeq = 1

function newSound(file: ImportedFile, categoryId: string | null): Sound {
  return {
    id: crypto.randomUUID(),
    path: file.path,
    name: file.name,
    categoryId,
    tags: [],
    hotkey: null,
    volume: 1,
    pitch: 0,
    speed: 1,
    color: null,
    duration: 0,
    trimStart: 0,
    trimEnd: 0,
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
    favorite: false,
    playCount: 0,
    lastPlayed: null,
    addedAt: Date.now(),
    missing: false,
    size: file.size
  }
}

export const useStore = create<State>((set, get) => ({
  loaded: false,
  sounds: [],
  categories: [],
  settings: DEFAULT_SETTINGS,

  panel: 'library',
  activeCategory: 'all',
  search: '',
  selection: [],
  quickSearchOpen: false,
  editorSoundId: null,
  onboardingOpen: false,
  hotkeyConflicts: [],
  toasts: [],

  // ------------------------------------------------------------- persistence

  load: async () => {
    const library = await window.soundboard.library.load()
    set({
      sounds: library.sounds,
      categories: library.categories,
      settings: library.settings,
      loaded: true,
      onboardingOpen: !library.settings.onboarded
    })

    await engine.init(library.settings)
    await get().syncHotkeys()
    void get().verifyFiles()

    // Warm the sounds most likely to be triggered without warning.
    const priority = [...library.sounds]
      .filter((s) => !s.missing)
      .sort((a, b) => {
        const aScore = (a.hotkey ? 100 : 0) + (a.favorite ? 40 : 0) + a.playCount
        const bScore = (b.hotkey ? 100 : 0) + (b.favorite ? 40 : 0) + b.playCount
        return bScore - aScore
      })
      .slice(0, 200)
      .map((s) => ({ key: s.id, path: s.path }))
    void warm(priority)
  },

  persist: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { sounds, categories, settings } = get()
      const library: Library = { version: 1, sounds, categories, settings }
      void window.soundboard.library.save(library)
    }, 350)
  },

  // ------------------------------------------------------------------ sounds

  addFiles: async (files, categoryId) => {
    const existing = new Set(get().sounds.map((s) => s.path.toLowerCase()))
    const fresh = files.filter((file) => !existing.has(file.path.toLowerCase()))
    if (!fresh.length) {
      if (files.length) get().toast('Those sounds are already in your library', 'info')
      return 0
    }

    const target =
      categoryId !== undefined
        ? categoryId
        : typeof get().activeCategory === 'string' &&
            !['all', 'favorites', 'recent'].includes(get().activeCategory)
          ? (get().activeCategory as string)
          : null

    const added = fresh.map((file) => newSound(file, target))
    set((state) => ({ sounds: [...state.sounds, ...added] }))
    get().persist()

    // Duration comes from decoding, so fill it in as each file lands.
    void (async () => {
      for (const sound of added) {
        const decoded = await decodeFile(sound.id, sound.path)
        if (decoded) get().updateSound(sound.id, { duration: decoded.duration })
      }
    })()

    const skipped = files.length - fresh.length
    get().toast(
      `Added ${added.length} sound${added.length === 1 ? '' : 's'}` +
        (skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''),
      'success'
    )
    return added.length
  },

  removeSounds: (ids) => {
    const set_ = new Set(ids)
    for (const id of ids) {
      engine.stopSound(id, true)
      forget(id)
    }
    set((state) => ({
      sounds: state.sounds.filter((s) => !set_.has(s.id)),
      selection: state.selection.filter((id) => !set_.has(id)),
      editorSoundId: state.editorSoundId && set_.has(state.editorSoundId) ? null : state.editorSoundId
    }))
    get().persist()
    void get().syncHotkeys()
    get().toast(`Removed ${ids.length} sound${ids.length === 1 ? '' : 's'}`, 'info')
  },

  updateSound: (id, patch) => {
    set((state) => ({
      sounds: state.sounds.map((s) => (s.id === id ? { ...s, ...patch } : s))
    }))
    get().persist()
    if ('volume' in patch && typeof patch.volume === 'number') {
      engine.setVoiceGain(id, patch.volume)
    }
    if ('hotkey' in patch) void get().syncHotkeys()
  },

  updateSounds: (ids, patch) => {
    const set_ = new Set(ids)
    set((state) => ({
      sounds: state.sounds.map((s) => (set_.has(s.id) ? { ...s, ...patch } : s))
    }))
    get().persist()
    if ('hotkey' in patch) void get().syncHotkeys()
  },

  moveSound: (id, targetId) => {
    if (id === targetId) return
    set((state) => {
      const sounds = [...state.sounds]
      const from = sounds.findIndex((s) => s.id === id)
      const to = sounds.findIndex((s) => s.id === targetId)
      if (from < 0 || to < 0) return state
      const [moved] = sounds.splice(from, 1)
      sounds.splice(to, 0, moved)
      return { sounds }
    })
    get().persist()
  },

  verifyFiles: async () => {
    const sounds = get().sounds
    const updates: { id: string; missing: boolean }[] = []
    for (const sound of sounds) {
      const exists = await window.soundboard.files.exists(sound.path)
      if (exists === !sound.missing) continue
      updates.push({ id: sound.id, missing: !exists })
    }
    if (!updates.length) return

    const map = new Map(updates.map((u) => [u.id, u.missing]))
    set((state) => ({
      sounds: state.sounds.map((s) => (map.has(s.id) ? { ...s, missing: map.get(s.id)! } : s))
    }))
    get().persist()

    const broken = updates.filter((u) => u.missing).length
    if (broken) get().toast(`${broken} sound file${broken === 1 ? '' : 's'} could not be found`, 'error')
  },

  // -------------------------------------------------------------- categories

  addCategory: (name) => {
    const id = `cat-${crypto.randomUUID().slice(0, 8)}`
    const order = get().categories.length
    const category: Category = {
      id,
      name: name.trim() || 'New category',
      color: PAD_COLORS[order % PAD_COLORS.length],
      icon: 'Folder',
      order
    }
    set((state) => ({ categories: [...state.categories, category] }))
    get().persist()
    return id
  },

  updateCategory: (id, patch) => {
    set((state) => ({
      categories: state.categories.map((c) => (c.id === id ? { ...c, ...patch } : c))
    }))
    get().persist()
  },

  removeCategory: (id, deleteSounds) => {
    if (deleteSounds) {
      const ids = get().sounds.filter((s) => s.categoryId === id).map((s) => s.id)
      if (ids.length) get().removeSounds(ids)
    }
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      sounds: state.sounds.map((s) => (s.categoryId === id ? { ...s, categoryId: null } : s)),
      activeCategory: state.activeCategory === id ? 'all' : state.activeCategory
    }))
    get().persist()
  },

  // ---------------------------------------------------------------- settings

  updateSettings: (patch) => {
    const previous = get().settings
    const settings = { ...previous, ...patch }
    set({ settings })
    get().persist()

    engine.updateSettings(settings)

    if (
      patch.monitorDeviceId !== undefined ||
      patch.broadcastDeviceId !== undefined ||
      patch.micDeviceId !== undefined
    ) {
      void engine.setDevices({
        monitorDeviceId: settings.monitorDeviceId,
        broadcastDeviceId: settings.broadcastDeviceId,
        micDeviceId: settings.micDeviceId
      })
    }

    if (patch.hotkeysEnabled !== undefined || patch.globalHotkeys !== undefined) {
      void get().syncHotkeys()
    }

    if (patch.launchOnStartup !== undefined) {
      void window.soundboard.app.setStartup(patch.launchOnStartup)
    }
  },

  resetSettings: () => {
    // recordingsDir has no meaningful default in shared code — only the main
    // process knows the user's Music folder — so carry the resolved one across
    // rather than resetting it to "" and breaking every future recording.
    const { recordingsDir } = get().settings
    const settings = {
      ...createDefaultLibrary().settings,
      recordingsDir,
      onboarded: true
    }
    set({ settings })
    get().persist()
    engine.updateSettings(settings)
    void engine.setDevices(settings)
    void get().syncHotkeys()
    get().toast('Settings restored to defaults', 'success')
  },

  // ---------------------------------------------------------------------- ui

  setPanel: (panel) => set({ panel }),
  setActiveCategory: (activeCategory) => set({ activeCategory, selection: [] }),
  setSearch: (search) => set({ search }),
  setSelection: (selection) => set({ selection }),
  toggleSelection: (id, additive) =>
    set((state) => {
      if (!additive) return { selection: [id] }
      return state.selection.includes(id)
        ? { selection: state.selection.filter((s) => s !== id) }
        : { selection: [...state.selection, id] }
    }),
  setQuickSearch: (quickSearchOpen) => set({ quickSearchOpen }),
  setEditorSound: (editorSoundId) => set({ editorSoundId }),
  setOnboarding: (onboardingOpen) => set({ onboardingOpen }),
  setView: (view) => get().updateSettings({ view }),
  setPadSize: (padSize) => get().updateSettings({ padSize }),
  setSort: (sort) => get().updateSettings({ sort }),

  toast: (message, tone = 'info') => {
    const id = toastSeq++
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  // ---------------------------------------------------------------- playback

  playSound: async (id, options) => {
    const sound = get().sounds.find((s) => s.id === id)
    if (!sound) return
    if (sound.missing) {
      get().toast(`"${sound.name}" is missing from disk`, 'error')
      return
    }

    const voiceId = await engine.play(sound, options)
    if (voiceId === null) {
      get().toast(`Could not play "${sound.name}"`, 'error')
      return
    }

    if (!options?.preview) {
      set((state) => ({
        sounds: state.sounds.map((s) =>
          s.id === id ? { ...s, playCount: s.playCount + 1, lastPlayed: Date.now() } : s
        )
      }))
      get().persist()
    }
  },

  stopSound: (id) => engine.stopSound(id),
  stopAll: () => engine.stopAll(),

  playRandom: async () => {
    const pool = visibleSounds(get()).filter((s) => !s.missing)
    if (!pool.length) return
    const pick = pool[Math.floor(Math.random() * pool.length)]
    await get().playSound(pick.id)
  },

  playNext: async (direction) => {
    const pool = visibleSounds(get()).filter((s) => !s.missing)
    if (!pool.length) return
    const currentId = engine.getSnapshot().currentSoundId
    const index = currentId ? pool.findIndex((s) => s.id === currentId) : -1
    const next = pool[(index + direction + pool.length * 2) % pool.length]
    await get().playSound(next.id)
  },

  nudgeVolume: (delta) => {
    const next = Math.max(0, Math.min(1.5, get().settings.masterVolume + delta))
    get().updateSettings({ masterVolume: Number(next.toFixed(2)) })
  },

  syncHotkeys: async () => {
    const { settings, sounds } = get()
    if (!settings.hotkeysEnabled) {
      await window.soundboard.hotkeys.register([])
      set({ hotkeyConflicts: [] })
      return
    }

    const bindings: { id: string; accelerator: string }[] = []
    for (const [action, accelerator] of Object.entries(settings.globalHotkeys)) {
      if (accelerator) bindings.push({ id: `global:${action}`, accelerator })
    }
    for (const sound of sounds) {
      if (sound.hotkey) bindings.push({ id: `sound:${sound.id}`, accelerator: sound.hotkey })
    }

    const failed = await window.soundboard.hotkeys.register(bindings)
    set({ hotkeyConflicts: failed })
  }
}))

// ------------------------------------------------------------------ selectors

export function visibleSounds(state: State): Sound[] {
  const needle = state.search.trim().toLowerCase()
  let list = state.sounds

  if (state.activeCategory === 'favorites') list = list.filter((s) => s.favorite)
  else if (state.activeCategory === 'recent') {
    list = [...list].filter((s) => s.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  } else if (state.activeCategory === '__none') {
    list = list.filter((s) => !s.categoryId)
  } else if (state.activeCategory !== 'all') {
    list = list.filter((s) => s.categoryId === state.activeCategory)
  }

  if (needle) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
  }

  if (state.activeCategory === 'recent') return list

  switch (state.settings.sort) {
    case 'name':
      return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    case 'recent':
      return [...list].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    case 'plays':
      return [...list].sort((a, b) => b.playCount - a.playCount)
    case 'duration':
      return [...list].sort((a, b) => a.duration - b.duration)
    case 'added':
      return [...list].sort((a, b) => b.addedAt - a.addedAt)
    default:
      return list
  }
}

/**
 * visibleSounds builds a fresh array every call, so the shallow comparator is
 * what keeps this from re-rendering on every unrelated store write.
 */
export function useVisibleSounds(): Sound[] {
  return useStore(useShallow(visibleSounds))
}
