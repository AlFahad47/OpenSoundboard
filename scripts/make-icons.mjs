/**
 * Generates build/icon.png and build/icon.ico with no image dependencies.
 *
 * PNG and ICO are both simple enough to emit by hand, which keeps the toolchain
 * free of native modules. Run with: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'build')

// ------------------------------------------------------------------ drawing

const ACCENT = [124, 92, 255]
const CYAN = [34, 211, 238]

/** Bar heights of the waveform mark, as a fraction of the icon height. */
const BARS = [0.3, 0.56, 0.86, 0.62, 0.98, 0.44, 0.72, 0.34]

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]
}

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function roundedRectAlpha(x, y, size, radius) {
  const half = size / 2
  const dx = Math.abs(x - half) - (half - radius)
  const dy = Math.abs(y - half) - (half - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const distance = outside + Math.min(Math.max(dx, dy), 0) - radius
  // 1px feather.
  return Math.max(0, Math.min(1, 0.5 - distance))
}

function barAlpha(x, y, size) {
  const count = BARS.length
  const margin = size * 0.2
  const usable = size - margin * 2
  const slot = usable / count
  const barWidth = slot * 0.52
  const radius = barWidth / 2

  let alpha = 0
  for (let i = 0; i < count; i++) {
    const cx = margin + slot * i + slot / 2
    const height = BARS[i] * usable
    const top = size / 2 - height / 2
    const bottom = size / 2 + height / 2

    const dx = Math.abs(x - cx) - (barWidth / 2 - radius)
    const dy = Math.max(top + radius - y, y - (bottom - radius), 0)
    const distance = Math.hypot(Math.max(dx, 0), dy) - radius
    alpha = Math.max(alpha, Math.max(0, Math.min(1, 0.5 - distance)))
  }
  return alpha
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const shape = roundedRectAlpha(px, py, size, radius)
      const offset = (y * size + x) * 4

      if (shape <= 0) continue

      // Diagonal accent gradient.
      const t = Math.max(0, Math.min(1, (px / size) * 0.55 + (py / size) * 0.45))
      let [r, g, b] = mix(ACCENT, CYAN, t * 0.85)

      const bars = barAlpha(px, py, size)
      if (bars > 0) {
        r = Math.round(r + (255 - r) * bars)
        g = Math.round(g + (255 - g) * bars)
        b = Math.round(b + (255 - b) * bars)
      }

      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = Math.round(shape * 255)
    }
  }
  return pixels
}

// ---------------------------------------------------------------- PNG writer

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const src = y * size * 4
    const dst = y * (size * 4 + 1)
    raw[dst] = 0
    pixels.copy(raw, dst + 1, src, src + size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------- ICO writer

function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length

  entries.forEach((entry, index) => {
    const base = index * 16
    // 256 is stored as 0 in the directory.
    directory[base] = entry.size >= 256 ? 0 : entry.size
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size
    directory[base + 2] = 0 // palette
    directory[base + 3] = 0 // reserved
    directory.writeUInt16LE(1, base + 4) // colour planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32BE(0, base + 8)
    directory.writeUInt32LE(entry.data.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += entry.data.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)])
}

// --------------------------------------------------------------------- main

mkdirSync(OUT, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, data: encodePng(render(size), size) }))

const main = pngs.find((entry) => entry.size === 256)
writeFileSync(resolve(OUT, 'icon.png'), main.data)
writeFileSync(resolve(OUT, 'icon.ico'), encodeIco(pngs))

console.log(`Wrote build/icon.png (256px) and build/icon.ico (${sizes.join(', ')})`)
