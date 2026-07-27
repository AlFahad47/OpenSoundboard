# OpenSoundboard

A soundboard for Windows that plays into your microphone — so the people in your
call, game or stream hear your sounds while you keep talking over them.

Every sound goes to two places at once:

- **Monitor** — your own headphones, so you hear what you just fired.
- **Broadcast** — a virtual audio cable that Discord, OBS, games and anything
  else read as a normal microphone.

Your real microphone is mixed into the broadcast side and ducks automatically
while a sound plays, so the clip stays intelligible without you going silent.

---

## Install

Grab the latest `OpenSoundboard-*-setup.exe` from
[Releases](../../releases) and run it. Windows 10 or 11, 64-bit.

The build is not code-signed, so SmartScreen will show a blue
"Windows protected your PC" panel the first time — **More info → Run anyway**.
If you would rather not, build it yourself from source with the steps under
[Running it](#running-it); it is the same output.

There is also a portable `.exe` in every release if you prefer nothing written
outside its own folder.

---

## Setup

Windows has no built-in way for one app to feed audio into another app's
microphone input — that needs an audio driver, and shipping our own would mean a
WHQL/attestation-signed kernel-mode driver. So OpenSoundboard installs the official
free one for you.

On first run, press **Install automatically**. OpenSoundboard will:

1. Fetch the current VB-CABLE package directly from `download.vb-audio.com`.
2. Verify its Authenticode signature and refuse to run it unless Windows reports
   `Valid` *and* the signer matches VB-Audio.
3. Run the documented silent install (`-i -h`) behind a single UAC prompt.
4. Offer a restart — audio drivers only load at boot.
5. Select the cable by itself once it appears.

Then switch on **"Set this up in Discord and games for me"** and there is nothing
left to configure anywhere. OpenSoundboard points Windows' default *communications*
microphone at the cable, and every app that follows the system default — Discord,
most games, OBS — picks it up on its own.

Your real microphone is written to disk before anything changes and put back
when OpenSoundboard exits, so closing the app never leaves you silent in a call. If
OpenSoundboard is killed or crashes, the next launch repairs it.

Prefer to do it by hand? Leave that switch off and select **CABLE Output** as the
microphone inside each app instead.

VoiceMeeter and other virtual devices work too — OpenSoundboard ranks every output
device and picks the best broadcast target, ignoring lookalikes such as NVIDIA
Virtual Audio, Voicemod and DroidCam that contain "virtual" but are not loopback
cables. Prefer to do it yourself? **Install manually** opens
[vb-audio.com/Cable](https://vb-audio.com/Cable/).

Without any cable the app still works fine as a local soundboard; the title bar
just reads **Local only**.

### Shipping the driver offline instead

OpenSoundboard downloads rather than bundles, which keeps it clear of redistribution
licensing. VB-Audio does grant distribution/bundle licences on request — with
one, drop the pack into `resources/` and point `bundledPack()` in
[`src/main/cable.ts`](src/main/cable.ts) at it. The verify/install/reboot flow is
unchanged, and it then works with no network access.

---

## Features

**Interface**
- Dark and light themes, or match Windows automatically
- Every colour resolves from CSS custom properties, so a theme switch is one
  attribute flip with no re-render
- Configurable accent colour that survives a theme change
- Floating card layout, pad grid in three sizes or a dense list
- Side panel with most played, recently added, routing status and your hotkeys

**Playback**
- Simultaneous monitor + broadcast output, sample-accurate between the two
- Layered playback, or one-sound-at-a-time mode
- Per-sound volume, pitch (±12 semitones), speed, fade in/out and looping
- Non-destructive trim points — set in/out without touching the file
- Optional loudness normalisation so quiet and loud clips sit at the same level
- Configurable fade on stop, so nothing ends in a click
- Middle-click any pad to audition it on your headphones only

**Microphone**
- Passthrough so you can talk while sounds play
- Automatic ducking with adjustable depth
- Self-monitoring ("hear myself") for level checks
- One-key mute, from a hotkey, the tray or the transport bar

**Library**
- MP3, WAV, OGG, Opus, FLAC, M4A, AAC, WebM, WMA, AIFF
- Drag files or whole folders anywhere onto the window
- Recursive folder import, duplicate detection, missing-file detection
- Categories with custom colours and icons; drag sounds between them
- Favourites, tags, play counts, recently played
- Pad grid in three sizes, or a dense list view
- Sort by name, date added, last played, play count or duration

**Hotkeys**
- A global hotkey per sound, active even when OpenSoundboard is in the background
- Global controls: stop all, pause/resume, next, previous, volume, random,
  mute mic, quick search, start recording
- Conflicts with other apps are detected and shown in the title bar

**Quick search**
- `Ctrl+K`, or a global hotkey, opens a launcher over any window
- Type, arrow, Enter — fastest way to a sound mid-conversation

**Recorder**
- Record your microphone, your system audio ("what you hear"), or both mixed
- Pause and resume mid-take, live level meter
- Saves as WAV or Opus and drops straight into your library

**Editor**
- Waveform view with draggable in/out handles
- Fade in/out, speed, pitch
- Normalise, crop, trim silence, reverse
- Apply as non-destructive trim points, or render out a new file

**Phone remote**
- Serves a small web page on your LAN — open it on your phone and tap pads
- Optional PIN, live sync of what's playing, remote volume and stop
- Nothing leaves your machine; no account, no cloud
- Off by default. While it is on, the server only answers requests whose `Host`
  is a private LAN address and whose `Origin` is its own page, so a random web
  page you happen to open cannot reach across your network and fire sounds.
  Set a PIN as well if you share the network with people you don't trust.

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

Build the production bundles:

```bash
npm run build
```

Package a Windows installer and a portable exe into `release/`:

```bash
npm run dist
```

Regenerate the app icons (they are written procedurally, no image tooling
needed):

```bash
npm run icons
```

---

## How it is put together

```
src/
  main/          Electron main process
    index.ts       window, session permissions, IPC wiring
    store.ts       atomic JSON persistence with backup
    files.ts       dialogs, recursive scanning, reads and writes
    hotkeys.ts     global shortcut registration and conflict reporting
    remote.ts      LAN remote server (HTTP + server-sent events)
    cable.ts       one-click virtual cable download, verify and install
    audio-policy.ts  IPolicyConfig COM bindings for default audio endpoints
    voice-routing.ts auto-routing voice apps, with crash-safe restore
    tray.ts        tray icon and menu
  preload/       contextBridge API — the only surface the UI can reach
  renderer/
    audio/
      engine.ts    dual-output playback graph, ducking, voices
      decoder.ts   decode + LRU cache + waveform peaks
      recorder.ts  mic / loopback / mixed capture
      editor.ts    offline DSP
      wav.ts       16-bit PCM writer
    state/store.ts zustand store, library and settings
    components/    UI
```

**Why Web Audio rather than a native engine.** Chromium decodes every format
listed above with no extra dependencies, and `AudioContext.setSinkId` drives two
output devices from one process. Where `setSinkId` is unavailable the engine
falls back to routing through a `MediaStreamDestination` and a hidden `<audio>`
element, which works everywhere.

**Memory.** Decoded audio is cached with a byte budget (320 MB by default) and
evicted least-recently-used. Sounds with hotkeys, favourites and high play counts
are decoded in the background at startup so they fire instantly. Waveform peaks
are kept permanently — they are a few KB each.

**Setting the default microphone.** Windows exposes no public API for this — only
the undocumented `IPolicyConfig` COM interface, stable since Vista. Which
coclass/interface pair answers `QueryInterface` varies by build: on Windows 10
19045 `CPolicyConfigClient` returns `E_NOINTERFACE` for both policy interfaces
and only `CPolicyConfigVistaClient` + `IPolicyConfigVista` works, so
[`audio-policy.ts`](src/main/audio-policy.ts) tries both. It is driven through
inline C# via `Add-Type`, which avoids a native module and any third-party
binary.

**Persistence.** The library is written to
`%APPDATA%\OpenSoundboard\library.json` atomically: render to a temp file, rotate
the previous copy to `library.backup.json`, then swap. A crash mid-write cannot
truncate your library, and a file that is unreadable *or* parses to the wrong
shape falls back to the backup rather than starting you over empty.

---

## Responsible use

OpenSoundboard is a tool. It plays audio files **you** supply, to devices **you**
choose. It ships with no sounds, hosts nothing, and uploads nothing.

What you play, where you play it, and who has to hear it is yours to answer for.

Do not use it to:

- **Harass, bully, intimidate or humiliate anyone.** Firing sounds at someone to
  distress them, drown them out, or make them a target is abuse — whatever the
  sound happens to be.
- **Break the law**, including copyright, harassment, recording-consent and
  broadcasting law where you live.
- **Break the rules of the platform you are on.** Discord, Twitch, YouTube and
  most games have terms covering disruptive audio, and some address soundboards
  directly. Read them before you assume.
- **Deceive people** — impersonating someone's voice or passing off a fabricated
  clip as a real recording.

If something is unlawful for you, forbidden to you, or simply unkind, running it
through this app does not make it otherwise. That judgement is yours, and so are
the consequences.

The recorder captures your own microphone and your own system audio. Recording
other people can require their consent depending on where you live — establishing
that is your responsibility, not the app's.

Sounds you add are yours to hold the rights to. This project ships none, bundles
none and distributes none.

The authors and contributors provide this software as-is, accept no liability for
how anyone uses it, and are not responsible for anything done with it. See
[LICENSE](LICENSE).

---

## Licence

[MIT](LICENSE). Ships with no sounds — bring your own.

OpenSoundboard does not redistribute VB-CABLE; it downloads it from VB-Audio at
your request, and the driver stays under
[VB-Audio's own terms](https://vb-audio.com/Cable/). If you fork this and sell
the result, talk to VB-Audio about a distribution licence first.
