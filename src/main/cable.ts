import { app, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type { CableProgress, CableStage } from '../shared/types'

/**
 * One-click virtual audio cable setup.
 *
 * Windows cannot route one app's audio into another app's microphone without a
 * driver, and shipping our own would need a WHQL/attestation-signed kernel
 * driver. Instead we fetch the official VB-CABLE package straight from
 * VB-Audio, verify its Authenticode signature before running anything, and
 * drive its documented silent install (-i -h) behind a single UAC prompt.
 *
 * Downloading rather than bundling keeps us clear of redistribution licensing.
 * To ship it offline instead, drop the pack in resources/ and point
 * `bundledPack()` at it — the rest of the flow is unchanged.
 */

/**
 * Probed newest-first so a future pack is picked up without shipping an update;
 * older entries keep working if VB-Audio ever retires a version.
 */
const PACK_CANDIDATES = [48, 47, 46, 45, 44, 43]
const PACK_URL = (n: number) =>
  `https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack${n}.zip`

/**
 * Nothing is executed unless Windows reports a valid signature AND the signer
 * matches. Note the certificate is issued to VB-Audio's founder personally
 * ("CN=BUREL VINCENT Entrepreneur individuel"), not to a "VB-Audio" subject —
 * matching on the brand name alone would reject the genuine installer.
 */
const EXPECTED_SIGNER = /BUREL\s+VINCENT|VB[- ]?Audio/i

let win: BrowserWindow | null = null
let running = false

export function setCableWindow(target: BrowserWindow | null): void {
  win = target
}

function report(stage: CableStage, percent: number, message: string): void {
  const payload: CableProgress = { stage, percent, message }
  win?.webContents.send(IPC.cableProgress, payload)
}

// --------------------------------------------------------------- powershell

function powershell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: String(err) }))
  })
}

/** PowerShell single-quoted literal: the only escape needed is the quote itself. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// ------------------------------------------------------------------ download

function head(url: string, redirects = 0): Promise<number> {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve(0)
    const request = https.request(url, { method: 'HEAD', timeout: 12_000 }, (res) => {
      const status = res.statusCode ?? 0
      res.resume()
      if (status >= 300 && status < 400 && res.headers.location) {
        resolve(head(new URL(res.headers.location, url).toString(), redirects + 1))
      } else {
        resolve(status)
      }
    })
    request.on('error', () => resolve(0))
    request.on('timeout', () => {
      request.destroy()
      resolve(0)
    })
    request.end()
  })
}

async function resolvePackUrl(): Promise<string | null> {
  for (const version of PACK_CANDIDATES) {
    const url = PACK_URL(version)
    if ((await head(url)) === 200) return url
  }
  return null
}

function download(url: string, target: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'))

    https
      .get(url, { timeout: 60_000 }, (res) => {
        const status = res.statusCode ?? 0

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve(download(new URL(res.headers.location, url).toString(), target, redirects + 1))
        }
        if (status !== 200) {
          res.resume()
          return reject(new Error(`Download failed with HTTP ${status}`))
        }

        const total = Number(res.headers['content-length'] ?? 0)
        let received = 0

        const file = createWriteStream(target)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total) {
            report(
              'downloading',
              Math.min(45, Math.round((received / total) * 45)),
              'Downloading the audio driver…'
            )
          }
        })
        // Without this a connection dropped mid-download leaves the promise
        // pending forever and the UI stuck on "Downloading…".
        res.on('error', reject)
        res.pipe(file)
        file.on('finish', () =>
          file.close(() => {
            // A server that hangs up early still ends the stream cleanly, which
            // would hand Expand-Archive a truncated zip and a baffling error.
            if (total && received < total) {
              reject(new Error('The download ended early. Check your connection and try again.'))
            } else {
              resolve()
            }
          })
        )
        file.on('error', reject)
      })
      .on('error', reject)
      .on('timeout', function (this: import('node:http').ClientRequest) {
        this.destroy()
        reject(new Error('The download timed out'))
      })
  })
}

// ------------------------------------------------------------------- install

/**
 * Path to a driver pack shipped inside the app, or null when there is none.
 *
 * Redistributing VB-CABLE needs a distribution licence from VB-Audio, so the
 * default build downloads instead. With a licence, drop the pack in
 * `resources/` as `VBCABLE_Driver_Pack.zip` and this takes over — the install
 * then works with no network access at all.
 */
async function bundledPack(): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'VBCABLE_Driver_Pack.zip'),
    path.join(app.getAppPath(), 'resources', 'VBCABLE_Driver_Pack.zip')
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      /* not bundled */
    }
  }
  return null
}

export async function isCableInstalled(): Promise<boolean> {
  // The driver registers a device whose name carries the VB-Audio branding.
  const { stdout } = await powershell(
    `Get-CimInstance Win32_SoundDevice | Where-Object { $_.Name -match 'VB-?Audio|CABLE' } | Select-Object -First 1 -ExpandProperty Name`
  )
  return stdout.length > 0
}

export async function installCable(): Promise<CableProgress> {
  if (running) return { stage: 'error', percent: 0, message: 'An install is already running.' }
  if (process.platform !== 'win32') {
    return { stage: 'error', percent: 0, message: 'Automatic install is Windows only.' }
  }

  running = true
  const work = path.join(app.getPath('temp'), `soundboard-cable-${Date.now()}`)

  try {
    await fs.mkdir(work, { recursive: true })

    // 1-2. Use a bundled pack when the build ships one, otherwise fetch it.
    const zip = path.join(work, 'cable.zip')
    const bundled = await bundledPack()

    if (bundled) {
      report('extracting', 45, 'Preparing the audio driver…')
      await fs.copyFile(bundled, zip)
    } else {
      report('downloading', 2, 'Contacting VB-Audio…')
      const url = await resolvePackUrl()
      if (!url) {
        throw new Error(
          'Could not reach the VB-Audio download server. Check your connection, or use “Install manually”.'
        )
      }
      await download(url, zip)
    }

    // 3. Unpack.
    report('extracting', 52, 'Unpacking…')
    const extracted = path.join(work, 'pack')
    const unzip = await powershell(
      `Expand-Archive -Path ${psQuote(zip)} -DestinationPath ${psQuote(extracted)} -Force`
    )
    if (unzip.code !== 0) throw new Error(`Could not unpack the driver: ${unzip.stderr}`)

    // 4. Pick the right setup binary for this machine.
    const wants64 = process.arch === 'x64' || process.arch === 'arm64'
    const entries = await fs.readdir(extracted)
    const setupName =
      entries.find((name) =>
        wants64 ? /^VBCABLE_Setup_x64\.exe$/i.test(name) : /^VBCABLE_Setup\.exe$/i.test(name)
      ) ?? entries.find((name) => /^VBCABLE_Setup.*\.exe$/i.test(name))
    if (!setupName) throw new Error('The downloaded package did not contain an installer.')
    const setup = path.join(extracted, setupName)

    // 5. Never run an unverified binary.
    report('verifying', 60, 'Checking the driver signature…')
    const check = await powershell(
      `$s = Get-AuthenticodeSignature -FilePath ${psQuote(setup)}; ` +
        `Write-Output "$($s.Status)|$($s.SignerCertificate.Subject)"`
    )
    const [status, subject = ''] = check.stdout.split('|')
    if (status !== 'Valid') {
      throw new Error(`The driver's signature is not valid (${status || 'unknown'}). Install cancelled.`)
    }
    if (!EXPECTED_SIGNER.test(subject)) {
      throw new Error('The driver was not signed by VB-Audio. Install cancelled.')
    }

    // 6. Silent install behind a single UAC prompt.
    report('installing', 70, 'Installing — approve the Windows prompt…')
    const install = await powershell(
      `$p = Start-Process -FilePath ${psQuote(setup)} -ArgumentList '-i','-h' -Verb RunAs -Wait -PassThru; ` +
        `Write-Output $p.ExitCode`
    )

    if (install.code !== 0) {
      // A declined UAC dialog surfaces here rather than as a non-zero exit code.
      const declined = /cancell?ed by the user|operation was canceled/i.test(install.stderr)
      if (declined) {
        report('cancelled', 0, 'Installation was cancelled at the Windows prompt.')
        return { stage: 'cancelled', percent: 0, message: 'Installation was cancelled.' }
      }
      throw new Error(install.stderr || 'The installer could not be started.')
    }

    // PowerShell exits 0 as long as it managed to *launch* the installer, so the
    // installer's own exit code is the only thing that says whether it worked.
    // Without this a failed install still reported "restart to finish setup".
    // -PassThru on an elevated process can yield an empty ExitCode; treat only a
    // reported non-zero value as a failure.
    const exitCode = Number.parseInt(install.stdout.trim(), 10)
    if (Number.isFinite(exitCode) && exitCode !== 0) {
      throw new Error(`The VB-CABLE installer failed with exit code ${exitCode}.`)
    }

    // 7. Some machines expose the device immediately; most need the reboot.
    report('installing', 92, 'Finishing up…')
    await new Promise((resolve) => setTimeout(resolve, 2500))

    if (await isCableInstalled()) {
      report('installed', 100, 'Virtual audio cable installed.')
      return { stage: 'installed', percent: 100, message: 'Virtual audio cable installed.' }
    }

    report('reboot-required', 100, 'Installed — restart Windows to finish.')
    return { stage: 'reboot-required', percent: 100, message: 'Restart Windows to finish setup.' }
  } catch (err) {
    const message = (err as Error)?.message ?? 'The install failed.'
    report('error', 0, message)
    return { stage: 'error', percent: 0, message }
  } finally {
    running = false
    void fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/** User-initiated only — never call this without an explicit click. */
export function restartWindows(): void {
  spawn('shutdown', ['/r', '/t', '5', '/c', 'Restarting to finish OpenSoundboard audio setup'], {
    windowsHide: true,
    detached: true
  }).unref()
}
