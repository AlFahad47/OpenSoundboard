import { useRef, type ReactNode } from 'react'
import {
  ArrowDownWideNarrow,
  FilePlus2,
  FolderPlus,
  Grid2x2,
  LayoutList,
  Loader2,
  Search,
  X
} from 'lucide-react'
import { useStore, useVisibleSounds } from '../state/store'
import type { SortKey } from '@shared/types'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'custom', label: 'Manual order' },
  { key: 'name', label: 'Name' },
  { key: 'added', label: 'Recently added' },
  { key: 'recent', label: 'Recently played' },
  { key: 'plays', label: 'Most played' },
  { key: 'duration', label: 'Duration' }
]

export function Toolbar(): ReactNode {
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const view = useStore((s) => s.settings.view)
  const padSize = useStore((s) => s.settings.padSize)
  const sort = useStore((s) => s.settings.sort)
  const setView = useStore((s) => s.setView)
  const setPadSize = useStore((s) => s.setPadSize)
  const setSort = useStore((s) => s.setSort)
  const addFiles = useStore((s) => s.addFiles)
  const toast = useStore((s) => s.toast)
  const visible = useVisibleSounds()
  const total = useStore((s) => s.sounds.length)
  const busy = useRef(false)

  const importFiles = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    try {
      const files = await window.soundboard.files.pick()
      if (files.length) await addFiles(files)
    } finally {
      busy.current = false
    }
  }

  const importFolder = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    try {
      const folder = await window.soundboard.files.pickFolder()
      if (!folder) return
      toast('Scanning folder…', 'info')
      const files = await window.soundboard.files.scanFolder(folder)
      if (!files.length) {
        toast('No audio files found in that folder', 'error')
        return
      }
      await addFiles(files)
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="toolbar">
      <div className="search">
        <Search className="search__icon" />
        <input
          value={search}
          placeholder={`Search ${total} sound${total === 1 ? '' : 's'}…`}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setSearch('')}
        />
        {search ? (
          <button className="search__clear" onClick={() => setSearch('')} aria-label="Clear search">
            <X size={13} />
          </button>
        ) : null}
      </div>

      {search ? (
        <span className="text-faint" style={{ fontSize: 11.5 }}>
          {visible.length} match{visible.length === 1 ? '' : 'es'}
        </span>
      ) : null}

      <div style={{ flex: 1 }} />

      <div className="seg seg--sort" title="Sort order">
        <ArrowDownWideNarrow size={14} style={{ color: 'var(--text-faint)', margin: '0 4px' }} />
        <select
          className="input"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          style={{ height: 26, border: 'none', background: 'transparent', fontSize: 12, width: 124 }}
        >
          {SORTS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {view === 'grid' ? (
        <div className="seg seg--size" title="Pad size">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <button
              key={size}
              data-on={padSize === size}
              onClick={() => setPadSize(size)}
              style={{ fontSize: 11, fontWeight: 600, width: 24 }}
            >
              {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="seg">
        <button data-on={view === 'grid'} onClick={() => setView('grid')} title="Pad view">
          <Grid2x2 size={15} />
        </button>
        <button data-on={view === 'list'} onClick={() => setView('list')} title="List view">
          <LayoutList size={15} />
        </button>
      </div>

      <button className="btn btn--wide" onClick={importFolder} title="Import a folder of sounds">
        <FolderPlus />
        <span>Folder</span>
      </button>
      <button className="btn btn--primary btn--wide" onClick={importFiles} title="Add sounds">
        {busy.current ? <Loader2 className="spin" /> : <FilePlus2 />}
        <span>Add sounds</span>
      </button>
    </div>
  )
}
