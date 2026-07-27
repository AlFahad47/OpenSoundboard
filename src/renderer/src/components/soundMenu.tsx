import {
  Copy,
  FolderInput,
  Heart,
  HeartOff,
  Pencil,
  Play,
  Repeat,
  Scissors,
  Square,
  Trash2,
  Volume2,
  FolderOpen
} from 'lucide-react'
import type { MenuItem } from './primitives'
import { useStore } from '../state/store'
import type { Sound } from '@shared/types'
import { engine } from '../audio/engine'

/**
 * One menu definition shared by the pad grid and the list, so both views offer
 * exactly the same actions.
 */
export function buildSoundMenu(sound: Sound, selection: string[]): MenuItem[] {
  const store = useStore.getState()
  const ids = selection.includes(sound.id) && selection.length > 1 ? selection : [sound.id]
  const many = ids.length > 1
  const playing = engine.isPlaying(sound.id)
  const categories = store.categories

  const items: MenuItem[] = [
    playing
      ? {
          label: 'Stop',
          icon: <Square />,
          onClick: () => store.stopSound(sound.id)
        }
      : {
          label: many ? `Play ${ids.length} sounds` : 'Play',
          icon: <Play />,
          onClick: () => ids.forEach((id) => void store.playSound(id))
        },
    {
      label: 'Preview on my headphones',
      icon: <Volume2 />,
      onClick: () => void store.playSound(sound.id, { preview: true })
    },
    { label: '', separator: true },
    {
      label: sound.favorite ? 'Remove from favourites' : 'Add to favourites',
      icon: sound.favorite ? <HeartOff /> : <Heart />,
      onClick: () => store.updateSounds(ids, { favorite: !sound.favorite })
    },
    {
      label: sound.loop ? 'Disable looping' : 'Loop this sound',
      icon: <Repeat />,
      onClick: () => store.updateSounds(ids, { loop: !sound.loop })
    },
    {
      label: 'Edit clip…',
      icon: <Scissors />,
      disabled: many,
      onClick: () => store.setEditorSound(sound.id)
    },
    {
      label: 'Rename',
      icon: <Pencil />,
      disabled: many,
      onClick: () => {
        store.setSelection([sound.id])
        // The inspector owns renaming; focusing it is enough.
        window.dispatchEvent(new CustomEvent('soundboard:focus-rename'))
      }
    }
  ]

  if (categories.length) {
    items.push({ label: '', separator: true })
    for (const category of categories.slice(0, 8)) {
      if (category.id === sound.categoryId) continue
      items.push({
        label: `Move to ${category.name}`,
        icon: <FolderInput />,
        onClick: () => store.updateSounds(ids, { categoryId: category.id })
      })
    }
    if (sound.categoryId) {
      items.push({
        label: 'Remove from category',
        icon: <FolderInput />,
        onClick: () => store.updateSounds(ids, { categoryId: null })
      })
    }
  }

  items.push(
    { label: '', separator: true },
    {
      label: 'Show in Explorer',
      icon: <FolderOpen />,
      disabled: many,
      onClick: () => void window.soundboard.files.reveal(sound.path)
    },
    {
      label: 'Copy file path',
      icon: <Copy />,
      disabled: many,
      onClick: () => void navigator.clipboard.writeText(sound.path)
    },
    { label: '', separator: true },
    {
      label: many ? `Remove ${ids.length} sounds` : 'Remove from library',
      icon: <Trash2 />,
      danger: true,
      onClick: () => store.removeSounds(ids)
    }
  )

  return items
}
