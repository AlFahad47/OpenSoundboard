import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { IPC } from '../shared/ipc'

let tray: Tray | null = null

export function iconPath(): string {
  const candidates = [
    path.join(process.env.VITE_PUBLIC ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(process.resourcesPath, 'build', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? ''
}

export function createTray(win: BrowserWindow, onQuit: () => void): Tray | null {
  if (tray) return tray

  const file = iconPath()
  const image = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
  if (image.isEmpty()) {
    // Without an icon Windows shows a blank slot, which looks broken — skip the tray instead.
    console.warn('[tray] no icon found, tray disabled')
    return null
  }

  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('OpenSoundboard')

  const show = () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Show OpenSoundboard', click: show },
    { type: 'separator' },
    {
      label: 'Stop all sounds',
      click: () => win.webContents.send(IPC.trayCommand, 'stopAll')
    },
    {
      label: 'Toggle microphone',
      click: () => win.webContents.send(IPC.trayCommand, 'toggleMic')
    },
    {
      label: 'Play random sound',
      click: () => win.webContents.send(IPC.trayCommand, 'random')
    },
    { type: 'separator' },
    { label: 'Quit', click: onQuit }
  ])

  tray.setContextMenu(menu)
  tray.on('click', show)
  tray.on('double-click', show)
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
