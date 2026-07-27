import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Loader2, Music4, Upload } from 'lucide-react'
import { colorOf, useStore, useVisibleSounds } from './state/store'
import { engine } from './audio/engine'
import { recorder } from './audio/recorder'
import { useEngine } from './hooks/useEngine'
import { useAutoSelectCable, useDevices } from './hooks/useDevices'
import { useTheme } from './hooks/useTheme'
import { SideRail } from './components/SideRail'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { SoundGrid } from './components/SoundGrid'
import { SoundList } from './components/SoundList'
import { Inspector } from './components/Inspector'
import { PlayerBar } from './components/PlayerBar'
import { QuickSearch } from './components/QuickSearch'
import { SettingsPanel } from './components/SettingsPanel'
import { RecorderPanel } from './components/RecorderPanel'
import { EditorModal } from './components/EditorModal'
import { Onboarding } from './components/Onboarding'
import { Toasts } from './components/Toasts'

export function App(): ReactNode {
  const loaded = useStore((s) => s.loaded)
  const load = useStore((s) => s.load)
  const panel = useStore((s) => s.panel)
  const settings = useStore((s) => s.settings)
  const sounds = useStore((s) => s.sounds)
  const selection = useStore((s) => s.selection)
  const editorSoundId = useStore((s) => s.editorSoundId)
  const onboardingOpen = useStore((s) => s.onboardingOpen)
  const visible = useVisibleSounds()
  const snapshot = useEngine()

  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    void load()
  }, [load])

  // Accent colour is a single custom property the whole sheet reads from.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent)
  }, [settings.accent])

  useTheme(settings.theme, settings.accent)
  useGlobalHotkeys()
  useTrayCommands()
  useRemoteBridge()
  useLocalShortcuts()
  useFileDrop(setDropping, dragDepth)
  useAutoSelectCable(useDevices().outputs)

  const selected = selection.length ? sounds.find((s) => s.id === selection[0]) : null
  const editorSound = editorSoundId ? sounds.find((s) => s.id === editorSoundId) : null

  if (!loaded) {
    return (
      <div className="app">
        <TitleBar />
        <div className="empty" style={{ height: '100%' }}>
          <Loader2 className="spin" size={22} />
          <span className="empty__text">Loading your library…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />

      <div className="body">
        <Sidebar />

        <main className="stage panelcard">
          {panel === 'library' ? (
            <>
              <Toolbar />
              <div className="stage__scroll">
                {visible.length ? (
                  settings.view === 'grid' ? (
                    <SoundGrid
                      sounds={visible}
                      playing={snapshot.playing}
                      currentSoundId={snapshot.currentSoundId}
                    />
                  ) : (
                    <SoundList sounds={visible} playing={snapshot.playing} />
                  )
                ) : (
                  <EmptyState hasLibrary={sounds.length > 0} />
                )}

                {dropping ? (
                  <div className="dropzone">
                    <div className="dropzone__inner">
                      <Upload />
                      Drop audio files or folders to add them
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : panel === 'recorder' ? (
            <RecorderPanel />
          ) : (
            <SettingsPanel />
          )}
        </main>

        {panel === 'library' && selected ? (
          <Inspector sound={selected} playing={snapshot.playing.includes(selected.id)} />
        ) : panel === 'library' && settings.showRail ? (
          <SideRail />
        ) : null}
      </div>

      <PlayerBar />

      <QuickSearch />
      <Toasts />
      {editorSound ? (
        <EditorModal sound={editorSound} onClose={() => useStore.getState().setEditorSound(null)} />
      ) : null}
      {onboardingOpen ? (
        <Onboarding onClose={() => useStore.getState().setOnboarding(false)} />
      ) : null}
    </div>
  )
}

function EmptyState({ hasLibrary }: { hasLibrary: boolean }): ReactNode {
  const search = useStore((s) => s.search)
  const addFiles = useStore((s) => s.addFiles)

  if (search) {
    return (
      <div className="empty">
        <span className="empty__mark">
          <Music4 />
        </span>
        <span className="empty__title">No sounds match “{search}”</span>
        <span className="empty__text">Try a different word, or clear the search to see everything.</span>
      </div>
    )
  }

  return (
    <div className="empty">
      <span className="empty__mark">
        <Music4 />
      </span>
      <span className="empty__title">{hasLibrary ? 'Nothing here yet' : 'Your board is empty'}</span>
      <span className="empty__text">
        {hasLibrary
          ? 'This category has no sounds. Drag some in from another category, or add new files.'
          : 'Drag audio files anywhere in this window, or use the buttons below. MP3, WAV, OGG, FLAC, Opus and M4A all work.'}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn--primary"
          onClick={async () => {
            const files = await window.soundboard.files.pick()
            if (files.length) await addFiles(files)
          }}
        >
          <Upload />
          Add sounds
        </button>
        <button
          className="btn"
          onClick={async () => {
            const folder = await window.soundboard.files.pickFolder()
            if (!folder) return
            const files = await window.soundboard.files.scanFolder(folder)
            if (files.length) await addFiles(files)
          }}
        >
          <FolderOpen />
          Import a folder
        </button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------- wiring

/** Routes accelerators fired by the main process to store actions. */
function useGlobalHotkeys(): void {
  useEffect(() => {
    return window.soundboard.hotkeys.onFired(({ id }) => {
      const store = useStore.getState()

      if (id.startsWith('sound:')) {
        const soundId = id.slice(6)
        if (engine.isPlaying(soundId) && store.settings.holdToPlay) store.stopSound(soundId)
        else void store.playSound(soundId)
        return
      }

      const action = id.slice(7)
      switch (action) {
        case 'stopAll':
          store.stopAll()
          break
        case 'playPause':
          void engine.togglePause()
          break
        case 'next':
          void store.playNext(1)
          break
        case 'previous':
          void store.playNext(-1)
          break
        case 'volumeUp':
          store.nudgeVolume(0.05)
          break
        case 'volumeDown':
          store.nudgeVolume(-0.05)
          break
        case 'random':
          void store.playRandom()
          break
        case 'quickSearch':
          store.setQuickSearch(!store.quickSearchOpen)
          break
        case 'toggleMic':
          store.updateSettings({ micPassthrough: !store.settings.micPassthrough })
          store.toast(
            store.settings.micPassthrough ? 'Microphone muted' : 'Microphone live',
            'info'
          )
          break
        case 'startRecording':
          store.setPanel('recorder')
          break
        case 'toggleWindow':
          break
        default:
          break
      }
    })
  }, [])
}

function useTrayCommands(): void {
  useEffect(() => {
    return window.soundboard.app.onTrayCommand((command) => {
      const store = useStore.getState()
      if (command === 'stopAll') store.stopAll()
      else if (command === 'random') void store.playRandom()
      else if (command === 'toggleMic')
        store.updateSettings({ micPassthrough: !store.settings.micPassthrough })
    })
  }, [])
}

/** Keeps the phone remote's view in sync and executes what it sends back. */
function useRemoteBridge(): void {
  const snapshot = useEngine()
  const sounds = useStore((s) => s.sounds)
  const categories = useStore((s) => s.categories)
  const masterVolume = useStore((s) => s.settings.masterVolume)
  const remoteEnabled = useStore((s) => s.settings.remoteEnabled)

  const push = useCallback(() => {
    if (!remoteEnabled) return
    window.soundboard.remote.pushState({
      sounds: sounds
        .filter((sound) => !sound.missing)
        .map((sound) => ({
          id: sound.id,
          name: sound.name,
          color: colorOf(sound),
          categoryId: sound.categoryId
        })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      playing: snapshot.currentSoundId,
      paused: snapshot.paused,
      volume: masterVolume
    })
  }, [remoteEnabled, sounds, categories, snapshot.currentSoundId, snapshot.paused, masterVolume])

  useEffect(() => {
    push()
  }, [push])

  useEffect(() => {
    return window.soundboard.remote.onCommand((command) => {
      const store = useStore.getState()
      switch (command.type) {
        case 'play':
          void store.playSound(command.id)
          break
        case 'stop':
          store.stopAll()
          break
        case 'pause':
          void engine.togglePause()
          break
        case 'resume':
          void engine.resume()
          break
        case 'volume':
          store.updateSettings({ masterVolume: command.value })
          break
        case 'random':
          void store.playRandom()
          break
        case 'sync':
          push()
          break
      }
    })
  }, [push])

  // Restore the server on launch when the user left it enabled.
  useEffect(() => {
    if (!remoteEnabled) return
    const { remotePort, remotePin } = useStore.getState().settings
    void window.soundboard.remote.status().then((status) => {
      if (!status.running) void window.soundboard.remote.start(remotePort, remotePin)
    })
  }, [remoteEnabled])
}

/** In-window shortcuts. These only fire when OpenSoundboard has focus. */
function useLocalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true

      const store = useStore.getState()

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        store.setQuickSearch(true)
        return
      }

      if (typing) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        if (store.panel !== 'library') return
        event.preventDefault()
        store.setSelection(useStore.getState().sounds.map((s) => s.id))
        return
      }

      if (event.key === 'Delete' && store.selection.length) {
        event.preventDefault()
        store.removeSounds(store.selection)
        return
      }

      if (event.key === 'Escape') {
        if (store.selection.length) store.setSelection([])
        else if (store.search) store.setSearch('')
        return
      }

      if (event.key === ' ' && store.panel === 'library') {
        event.preventDefault()
        if (engine.getSnapshot().playing.length) void engine.togglePause()
        else void store.playRandom()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** Drag files or folders anywhere onto the window to import them. */
function useFileDrop(
  setDropping: (value: boolean) => void,
  depth: React.MutableRefObject<number>
): void {
  useEffect(() => {
    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth.current += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDragLeave = (): void => {
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDropping(false)
    }
    const onDrop = async (event: DragEvent): Promise<void> => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      depth.current = 0
      setDropping(false)

      // Chromium hides real paths on File objects; the preload recovers them.
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.soundboard.files.pathForFile(file))
        .filter(Boolean)
      if (!paths.length) return

      const store = useStore.getState()
      const resolved = await window.soundboard.files.resolveDropped(paths)
      if (!resolved.length) {
        store.toast('No supported audio files in that drop', 'error')
        return
      }
      await store.addFiles(resolved)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [setDropping, depth])
}

// Stop an in-flight recording if the window goes away.
window.addEventListener('beforeunload', () => {
  if (recorder.active) recorder.cancel()
  engine.destroy()
})
