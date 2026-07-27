import { useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines,
  Clock,
  Folder,
  FolderPlus,
  Heart,
  Laugh,
  LayoutGrid,
  Library,
  Mic,
  Music,
  Pencil,
  Settings,
  Sparkles,
  Trash2,
  Zap,
  Gamepad2,
  Megaphone,
  Volume2,
  Radio,
  Drum,
  Bell
} from 'lucide-react'
import { useStore } from '../state/store'
import { ContextMenu, Modal, type MenuItem } from './primitives'
import type { Category } from '@shared/types'

/** Only these icons can be assigned to a category, so the picker stays curated. */
export const CATEGORY_ICONS: Record<string, typeof Folder> = {
  Folder,
  Laugh,
  Music,
  Zap,
  Mic,
  Sparkles,
  Gamepad2,
  Megaphone,
  Volume2,
  Radio,
  Drum,
  Bell
}

const PALETTE = [
  '#7c5cff',
  '#f06595',
  '#4dabf7',
  '#51cf66',
  '#ffd43b',
  '#ff922b',
  '#22d3ee',
  '#e599f7',
  '#ff6b6b',
  '#94d82d'
]

export function Sidebar(): ReactNode {
  const sounds = useStore((s) => s.sounds)
  const categories = useStore((s) => s.categories)
  const active = useStore((s) => s.activeCategory)
  const panel = useStore((s) => s.panel)
  const setActiveCategory = useStore((s) => s.setActiveCategory)
  const setPanel = useStore((s) => s.setPanel)
  const addCategory = useStore((s) => s.addCategory)
  const updateCategory = useStore((s) => s.updateCategory)
  const removeCategory = useStore((s) => s.removeCategory)
  const updateSounds = useStore((s) => s.updateSounds)

  const [menu, setMenu] = useState<{ x: number; y: number; category: Category } | null>(null)
  const [editing, setEditing] = useState<Category | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const sound of sounds) {
      const key = sound.categoryId ?? '__none'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [sounds])

  const favourites = sounds.filter((s) => s.favorite).length
  const uncategorised = counts.get('__none') ?? 0

  /** Sounds are dragged onto a category to re-file them. */
  const handleDrop = (categoryId: string | null) => (event: React.DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const raw = event.dataTransfer.getData('application/x-soundboard-sounds')
    if (!raw) return
    try {
      const ids = JSON.parse(raw) as string[]
      if (ids.length) updateSounds(ids, { categoryId })
    } catch {
      /* not our payload */
    }
  }

  const allowDrop = (id: string) => (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('application/x-soundboard-sounds')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(id)
  }

  const menuItems: MenuItem[] = menu
    ? [
        {
          label: 'Rename & restyle',
          icon: <Pencil />,
          onClick: () => setEditing(menu.category)
        },
        { label: '', separator: true },
        {
          label: 'Delete category',
          icon: <Trash2 />,
          danger: true,
          onClick: () => removeCategory(menu.category.id, false)
        },
        {
          label: 'Delete with sounds',
          icon: <Trash2 />,
          danger: true,
          onClick: () => removeCategory(menu.category.id, true)
        }
      ]
    : []

  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="rail__logo">
          <AudioLines />
        </span>
        <span className="rail__word">
          OpenSoundboard
          <span>Soundboard</span>
        </span>
      </div>

      <nav className="rail__nav">
        <button
          className="rail__navbtn"
          data-on={panel === 'library'}
          onClick={() => setPanel('library')}
        >
          <Library size={16} />
          Library
        </button>
        <button
          className="rail__navbtn"
          data-on={panel === 'recorder'}
          onClick={() => setPanel('recorder')}
        >
          <Mic size={16} />
          Record
        </button>
        <button
          className="rail__navbtn"
          data-on={panel === 'settings'}
          onClick={() => setPanel('settings')}
        >
          <Settings size={16} />
          Setup
        </button>
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <CategoryRow
          icon={<LayoutGrid className="catrow__icon" />}
          name="All sounds"
          count={sounds.length}
          active={active === 'all' && panel === 'library'}
          onClick={() => {
            setPanel('library')
            setActiveCategory('all')
          }}
          onDragOver={allowDrop('__all')}
          onDragLeave={() => setDropTarget(null)}
          onDrop={handleDrop(null)}
          dropping={dropTarget === '__all'}
        />
        <CategoryRow
          icon={<Heart className="catrow__icon" />}
          name="Favourites"
          count={favourites}
          active={active === 'favorites' && panel === 'library'}
          onClick={() => {
            setPanel('library')
            setActiveCategory('favorites')
          }}
        />
        <CategoryRow
          icon={<Clock className="catrow__icon" />}
          name="Recently played"
          count={sounds.filter((s) => s.lastPlayed).length}
          active={active === 'recent' && panel === 'library'}
          onClick={() => {
            setPanel('library')
            setActiveCategory('recent')
          }}
        />
      </div>

      <div className="rail__section">
        <span>Categories</span>
        <button
          className="rail__add"
          title="New category"
          onClick={() => {
            const id = addCategory('New category')
            const created = useStore.getState().categories.find((c) => c.id === id)
            if (created) setEditing(created)
          }}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="rail__list">
        {categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.icon] ?? Folder
          return (
            <CategoryRow
              key={category.id}
              dot={category.color}
              icon={<Icon className="catrow__icon" style={{ color: category.color }} />}
              name={category.name}
              count={counts.get(category.id) ?? 0}
              active={active === category.id && panel === 'library'}
              onClick={() => {
                setPanel('library')
                setActiveCategory(category.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, category })
              }}
              onDragOver={allowDrop(category.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={handleDrop(category.id)}
              dropping={dropTarget === category.id}
            />
          )
        })}

        {uncategorised > 0 ? (
          <CategoryRow
            icon={<Folder className="catrow__icon" />}
            name="Uncategorised"
            count={uncategorised}
            active={active === '__none'}
            onClick={() => {
              setPanel('library')
              setActiveCategory('__none')
            }}
          />
        ) : null}
      </div>

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}

      {editing ? (
        <CategoryEditor
          category={editing}
          onSave={(patch) => {
            updateCategory(editing.id, patch)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </aside>
  )
}

function CategoryRow({
  icon,
  dot,
  name,
  count,
  active,
  dropping,
  onClick,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  icon: ReactNode
  dot?: string
  name: string
  count: number
  active: boolean
  dropping?: boolean
  onClick: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  onDragOver?: (event: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent) => void
}): ReactNode {
  return (
    <button
      className="catrow"
      data-on={active}
      data-drop={dropping}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dot ? <span className="catrow__dot" style={{ background: dot }} /> : icon}
      <span className="catrow__name">{name}</span>
      <span className="catrow__count">{count}</span>
    </button>
  )
}

function CategoryEditor({
  category,
  onSave,
  onClose
}: {
  category: Category
  onSave: (patch: Partial<Category>) => void
  onClose: () => void
}): ReactNode {
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color)
  const [icon, setIcon] = useState(category.icon)

  return (
    <Modal
      title="Edit category"
      onClose={onClose}
      width={430}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={() => onSave({ name, color, icon })}>
            Save
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="field">
          <div className="field__label">Name</div>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && onSave({ name, color, icon })}
          />
        </div>

        <div className="field">
          <div className="field__label">Colour</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {PALETTE.map((swatch) => (
              <button
                key={swatch}
                onClick={() => setColor(swatch)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 9,
                  background: swatch,
                  boxShadow: color === swatch ? '0 0 0 2px var(--bg-panel), 0 0 0 4px ' + swatch : 'none'
                }}
                aria-label={swatch}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field__label">Icon</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                onClick={() => setIcon(key)}
                className="btn btn--icon btn--sm"
                style={
                  icon === key
                    ? { borderColor: color, color: color, background: 'var(--bg-active)' }
                    : undefined
                }
                aria-label={key}
              >
                <Icon />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
