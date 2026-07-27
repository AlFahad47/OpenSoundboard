import { BrowserWindow, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AUDIO_EXTENSIONS, type ImportedFile } from '../shared/types'

const EXT_SET = new Set<string>(AUDIO_EXTENSIONS as readonly string[])

function isAudio(file: string): boolean {
  return EXT_SET.has(path.extname(file).slice(1).toLowerCase())
}

async function describe(file: string): Promise<ImportedFile | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) return null
    return { path: file, name: path.basename(file, path.extname(file)), size: stat.size }
  } catch {
    return null
  }
}

export async function pickFiles(win: BrowserWindow | null): Promise<ImportedFile[]> {
  const result = await dialog.showOpenDialog(win!, {
    title: 'Add sounds',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled) return []
  const described = await Promise.all(result.filePaths.filter(isAudio).map(describe))
  return described.filter((f): f is ImportedFile => f !== null)
}

export async function pickFolder(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win!, {
    title: 'Add a folder of sounds',
    properties: ['openDirectory']
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Walks a directory tree collecting audio files. Depth-capped so a stray symlink can't hang us. */
export async function scanFolder(root: string, maxDepth = 8): Promise<ImportedFile[]> {
  const found: ImportedFile[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && isAudio(full)) {
        const described = await describe(full)
        if (described) found.push(described)
      }
    }
  }

  await walk(root, 0)
  found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  return found
}

/** Turns a mixed list of dropped paths (files and folders) into a flat audio file list. */
export async function resolveDropped(paths: string[]): Promise<ImportedFile[]> {
  const out: ImportedFile[] = []
  for (const p of paths) {
    try {
      const stat = await fs.stat(p)
      if (stat.isDirectory()) {
        out.push(...(await scanFolder(p)))
      } else if (isAudio(p)) {
        const described = await describe(p)
        if (described) out.push(described)
      }
    } catch {
      /* skip unreadable entries */
    }
  }
  return out
}

export async function readFileBuffer(file: string): Promise<Uint8Array | null> {
  try {
    const buf = await fs.readFile(file)
    return new Uint8Array(buf)
  } catch (err) {
    console.error('[files] read failed:', file, err)
    return null
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}

export async function statFile(file: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const stat = await fs.stat(file)
    return { size: stat.size, mtime: stat.mtimeMs }
  } catch {
    return null
  }
}

export function reveal(file: string): void {
  shell.showItemInFolder(path.normalize(file))
}

export async function saveDialog(
  win: BrowserWindow | null,
  defaultName: string
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win!, {
    title: 'Save audio',
    defaultPath: defaultName,
    filters: [{ name: 'WAV audio', extensions: ['wav'] }]
  })
  return result.canceled ? null : (result.filePath ?? null)
}

export interface SaveResult {
  ok: boolean
  file?: ImportedFile
  /** Human-readable reason, shown directly to the user when the write fails. */
  error?: string
}

function describeWriteError(err: unknown, file: string): string {
  const code = (err as NodeJS.ErrnoException)?.code
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `No permission to write to ${path.dirname(file)}.`
    case 'ENOSPC':
      return 'The disk is full.'
    case 'ENOENT':
      return `That folder does not exist: ${path.dirname(file)}`
    case 'EBUSY':
      return 'That file is open in another program.'
    case 'ENAMETOOLONG':
      return 'The file name is too long.'
    case 'EINVAL':
      return 'That file name contains characters Windows does not allow.'
    default:
      return (err as Error)?.message ?? 'Unknown error writing the file.'
  }
}

/** Writes renderer-produced audio (edited clips, recordings) to disk. */
export async function saveBuffer(file: string, data: Uint8Array): Promise<SaveResult> {
  // A blank folder yields "\name.wav", which Node calls absolute but Windows
  // resolves to the drive root and refuses. Require a real drive or UNC root so
  // the message names the actual problem instead of surfacing EACCES.
  const rooted = /^[a-zA-Z]:[\\/]/.test(file) || /^\\\\[^\\]/.test(file)
  if (!file || !rooted) {
    return {
      ok: false,
      error: 'No recordings folder is set — choose one under Record → Recordings folder.'
    }
  }

  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, data)
    const described = await describe(file)
    return described
      ? { ok: true, file: described }
      : { ok: false, error: 'The file was written but could not be read back.' }
  } catch (err) {
    console.error('[files] write failed:', file, err)
    return { ok: false, error: describeWriteError(err, file) }
  }
}
