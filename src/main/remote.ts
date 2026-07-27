import http from 'node:http'
import { networkInterfaces } from 'node:os'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { REMOTE_PAGE } from './remote-page'

/**
 * Phone remote. Plain HTTP + Server-Sent Events, so there is no websocket
 * dependency to ship and any browser on the LAN can drive the board.
 */

interface RemoteState {
  sounds: { id: string; name: string; color: string; categoryId: string | null }[]
  categories: { id: string; name: string; color: string }[]
  playing: string | null
  paused: boolean
  volume: number
}

let server: http.Server | null = null
let clients: http.ServerResponse[] = []
let lastState: RemoteState = { sounds: [], categories: [], playing: null, paused: false, volume: 1 }
let pin = ''
let win: BrowserWindow | null = null

export function setRemoteWindow(target: BrowserWindow | null): void {
  win = target
}

export function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

function authorised(req: http.IncomingMessage, url: URL): boolean {
  if (!pin) return true
  return url.searchParams.get('pin') === pin || req.headers['x-soundboard-pin'] === pin
}

/**
 * The remote listens on the LAN with no PIN by default, so these two checks are
 * what stand between a user's soundboard and any web page they happen to open.
 *
 * `Origin` blocks cross-site requests: our own page is served from this origin,
 * so a mismatch means some other site is driving us. Dropping the old
 * `access-control-allow-origin: *` is not enough on its own — a simple POST is
 * still *delivered* cross-origin, the attacker just cannot read the reply, and
 * firing a sound never needed a readable reply.
 *
 * `Host` blocks DNS rebinding: an attacker-controlled name that resolves to the
 * user's LAN address would otherwise pass the Origin check.
 */
function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // curl, the EventSource reconnect, non-browser clients
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function hostAllowed(req: http.IncomingMessage): boolean {
  const host = req.headers.host
  if (!host) return false
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (name === 'localhost' || name === '::1' || /^127\./.test(name)) return true
  // Private IPv4 ranges only — a public name pointing here is a rebinding attempt.
  // 100.64/10 is CGNAT, which is where Tailscale and similar overlays live; it
  // is not publicly routable, so allowing it costs nothing and saves anyone
  // reaching their own machine over a mesh VPN.
  return (
    /^10\./.test(name) ||
    /^192\.168\./.test(name) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(name) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(name) ||
    /^169\.254\./.test(name) ||
    /^fe80:/i.test(name) ||
    /^f[cd][0-9a-f]{2}:/i.test(name)
  )
}

function send(res: http.ServerResponse, code: number, body: string, type = 'application/json') {
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    // No access-control-allow-origin: the remote page is same-origin with this
    // API and nothing else has any business reading it.
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      // Commands are tiny; anything larger is not something we want to buffer.
      if (data.length > 64_000) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
    // destroy() above fires 'close' without 'error', which would otherwise leave
    // this promise — and the request handler awaiting it — pending forever.
    req.on('close', () => resolve(data))
  })
}

export function broadcastState(state: Partial<RemoteState>): void {
  lastState = { ...lastState, ...state }
  const frame = `data: ${JSON.stringify(lastState)}\n\n`
  for (const client of clients) {
    try {
      client.write(frame)
    } catch {
      /* dropped clients are reaped on close */
    }
  }
}

export function startRemote(
  port: number,
  requiredPin: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  return new Promise((resolve) => {
    stopRemote()
    pin = requiredPin ?? ''

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

      if (!hostAllowed(req) || !sameOrigin(req)) {
        return send(res, 403, JSON.stringify({ error: 'forbidden' }))
      }

      if (req.method === 'OPTIONS') return send(res, 204, '')

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return send(res, 200, REMOTE_PAGE, 'text/html; charset=utf-8')
      }

      if (!authorised(req, url)) return send(res, 401, JSON.stringify({ error: 'bad pin' }))

      if (url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*'
        })
        res.write(`data: ${JSON.stringify(lastState)}\n\n`)
        clients.push(res)
        // Comment frames keep proxies and phone radios from closing the stream.
        const beat = setInterval(() => {
          try {
            res.write(': ping\n\n')
          } catch {
            /* handled on close */
          }
        }, 20_000)
        req.on('close', () => {
          clearInterval(beat)
          clients = clients.filter((c) => c !== res)
        })
        // Ask the renderer to push a fresh snapshot for the new listener.
        win?.webContents.send(IPC.remoteCommand, { type: 'sync' })
        return
      }

      if (url.pathname === '/command' && req.method === 'POST') {
        const raw = await readBody(req)
        try {
          const command = JSON.parse(raw)
          win?.webContents.send(IPC.remoteCommand, command)
          return send(res, 200, JSON.stringify({ ok: true }))
        } catch {
          return send(res, 400, JSON.stringify({ error: 'bad command' }))
        }
      }

      if (url.pathname === '/needs-pin') {
        return send(res, 200, JSON.stringify({ needsPin: Boolean(pin) }))
      }

      send(res, 404, JSON.stringify({ error: 'not found' }))
    })

    server.on('error', (err) => {
      server = null
      resolve({ ok: false, error: (err as NodeJS.ErrnoException).code ?? String(err) })
    })

    server.listen(port, '0.0.0.0', () => {
      const host = lanAddress() ?? 'localhost'
      resolve({ ok: true, url: `http://${host}:${port}` })
    })
  })
}

export function stopRemote(): void {
  for (const client of clients) {
    try {
      client.end()
    } catch {
      /* ignore */
    }
  }
  clients = []
  server?.close()
  server = null
}

export function remoteStatus(): { running: boolean; url: string | null; clients: number } {
  const address = server?.address()
  const port = address && typeof address === 'object' ? address.port : null
  return {
    running: Boolean(server),
    url: port ? `http://${lanAddress() ?? 'localhost'}:${port}` : null,
    clients: clients.length
  }
}
