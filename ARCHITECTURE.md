# OmniCam — architecture and engineering notes

## What this is

A desktop app (Windows first; macOS/Linux later) that turns a phone's camera into a **virtual
webcam** for Discord, Zoom, Teams, Chrome, OBS… with **nothing installed on the phone**:

1. Desktop app shows a QR code.
2. Phone (same Wi-Fi) scans it → a web page opens in the phone browser.
3. User accepts a one-time browser certificate warning, taps *Start camera*, allows camera access.
4. Video streams over WebRTC (LAN, peer-to-peer) into the desktop app, which feeds a
   DirectShow virtual camera device named **"OmniCam"**.

Priorities, in order: it must *just work* for non-technical users; video quality and latency on
par with native camera apps; front/back camera switching; robust reconnects. Video only in v1
(no virtual microphone).

## Non-negotiable product constraints and the decisions they forced

| Constraint | Consequence |
|---|---|
| No app install on the phone | Phone side is a plain web page served by the desktop app. |
| Mobile browsers require HTTPS for `getUserMedia` | Desktop serves a **self-signed cert**; user accepts a one-time warning. UI walks them through it. (Future opt-in: real domain + per-install cert, Plex-style.) |
| iOS Safari ignores the cert exception for `wss://` | Signaling uses **plain `fetch` POST, non-trickle ICE** (one round trip). No WebSockets. After that, control messages ride a WebRTC **DataChannel**. |
| Win10 has no Media Foundation virtual camera API | Virtual camera is a **DirectShow filter** (softcam, MIT) built from source with OmniCam's own name/CLSID. Registered with `regsvr32` (x64 + x86 DLLs) by the installer. |
| Consumer apps negotiate a camera format once | Virtual camera output is a **fixed size/fps** (720p/1080p @30/60); incoming frames are scaled/letterboxed in native code. |
| Some Wi-Fi blocks mDNS | Electron runs with `--disable-features=WebRtcHideLocalIpsWithMdns` so the desktop's ICE candidate is a real LAN IP. |
| Camera must survive closing the window | Hidden **engine** window owns WebRTC + native addon; UI window is optional; app lives in the tray. |

## Architecture

```
PHONE (browser)                       DESKTOP (Electron)
 apps/phone  ── HTTPS GET / ────────►  main process   (apps/desktop/src/main)
             ── POST /api/session ──►    https server, cert, QR/token, tray, settings, IPC hub
             ◄── WebRTC video+DC ───►  engine window  (apps/desktop/src/engine)  [nodeIntegration]
                                          RTCPeerConnection → MediaStreamTrackProcessor
                                          → VideoFrame.copyTo → addon.pushFrame()
                                       native addon   (packages/vcam-native)  [C++]
                                          pacing thread, libyuv convert/scale/rotate → BGR24
                                          → softcam shared memory → omnicam_vcam.dll (DirectShow)
                                       UI window      (apps/desktop/src/renderer)  [sandboxed React]
                                          talks to main only via preload bridge (window.omnicam)
```

- **Frames never cross Electron IPC.** The engine loads the addon in-process.
- **The native thread owns the camera clock.** JS deposits frames; C++ repeats the last one when
  the source stalls and shows a placeholder when nothing is connected.
- **Security model:** per-launch random token in the QR URL; `/api/session` rejects anything
  else (constant-time compare, one negotiation at a time, 6 attempts/min per client); one active
  phone at a time.
- **Crash recovery:** both renderers are reloaded on `render-process-gone` (at most 3 times per
  minute, then the UI shows an error). The engine re-attaches the addon and the phone's own
  reconnect loop restores the stream. Everything `console.*` in main (engine logs are relayed)
  goes to `%APPDATA%\OmniCam\logs\omnicam.log`, 2 MB with one rotation.

## Repository layout

```
package.json                 npm workspaces (no pnpm — keep prerequisites minimal)
apps/desktop/                Electron app (electron-vite, React, TS)
  src/main/                  index.ts, server.ts, cert.ts, network.ts, session.ts, settings.ts,
                             engine-bridge.ts (only thing that talks to the engine), tray.ts, ui-window.ts,
                             log.ts (%APPDATA%\OmniCam\logs), user-data.ts (1.0.0 folder migration)
  src/engine/                engine.ts (WebRTC receiver, stats, preview JPEGs, frame pump), vcam.ts (addon API)
  src/renderer/              React UI (Pairing, Preview, Controls, Settings)
  src/preload/               contextBridge → window.omnicam (typed in shared/ipc.ts)
  src/shared/ipc.ts          IPC channel names + payload types (single source of truth)
  resources/phone/           built phone page (generated, git-ignored)
  resources/native/          built addon + DLLs (generated, git-ignored)
  build/                     installer hooks, icon generator
apps/phone/                  Vanilla TS page (camera.ts, signaling.ts, main.ts). No framework — it must load instantly.
packages/protocol/           Wire types shared by everything (HTTP API, DataChannel messages, stats, settings)
packages/vcam-native/        C++: addon.cc (N-API), pipeline.cc (double buffer + pacing + libyuv),
                             backend/ivcam.h (per-OS interface), backend/win_softcam.cc,
                             filter/omnicam_filter.cpp (DirectShow DLL entry), third_party/{softcam,libyuv} submodules
```

## Build & run

Prerequisites: Node ≥ 20, **VS 2022 Build Tools (C++ workload)**, CMake ≥ 3.20 (`pip install cmake` works).

```
git submodule update --init --recursive
npm install
npm run native:build        # builds omnicam_vcam.node + omnicam_vcam.dll (x64, x86) → apps/desktop/resources/native
npm run native:register     # one-time, needs admin: regsvr32 both DLLs
npm run dev                 # builds phone page, starts Electron with HMR
npm run typecheck
npm run dist                # NSIS installer (registers DLLs + firewall rule)
```

Without the native build the app still runs (QR, phone connection, preview) and reports
"native addon not available" in the UI — useful for working on the web/UI parts.

## Conventions

- TypeScript strict everywhere; shared types live in `packages/protocol` or `src/shared/ipc.ts` —
  never duplicate a message shape.
- Main ↔ engine IPC goes through `engine-bridge.ts` only. UI ↔ main goes through the preload
  bridge only (UI is sandboxed; no Node in the renderer).
- Phone page: no dependencies, no framework, must work on iOS Safari 15+ and Android Chrome.
  Every browser API call that can be unsupported is wrapped (wake lock, torch, codec prefs…).
- Native code: never touch `third_party/` submodules; adapt at build time (see
  `cmake/patch_softcam.cmake`) or wrap. New platforms implement `IVirtualCamera`.
- Frame pixel formats accepted by the addon mirror WebCodecs names (`I420`, `NV12`, `RGBA`, `BGRA`…).
  libyuv's "RGB24" is B,G,R in memory — that *is* DirectShow RGB24; don't "fix" it.
- Errors that a user can act on (driver not registered, port busy, firewall) must surface in
  the UI with a concrete instruction, not just in logs.
- CI (`.github/workflows/build.yml`) typechecks, builds the native pieces and the installer on
  every push; a `v*` tag additionally creates a draft GitHub release with the installer attached.
- **Updates** (`src/main/updater.ts`): electron-updater against GitHub Releases. Checks quietly 15 s
  after launch and every 24 h; never downloads or installs without a click. The installer is verified
  against the sha512 in `latest.yml`, then runs silently (one UAC prompt) and restarts OmniCam.
  A release is only offered once it is **published** (not a draft) and carries `latest.yml` next to
  the `.exe`; CI attaches both. electron-updater is bundled into the main process like every other
  dependency (devDependencies, no `node_modules` in the package).
- **The in-app check cannot reach this feed while the repository is private**, which it stays: the
  GitHub provider requests releases unauthenticated, so a private repo answers 404 and the UI
  reports "No published release was found". Published releases are still the distribution channel —
  they are just readable only by accounts with access to the repo. Making the check work for other
  people needs a public feed that is not this repository: a releases-only public repo (point
  `publish.owner/repo` in `electron-builder.yml` at it and give CI a token for it) or
  `provider: generic` against a static host. Neither changes what the app does with the feed.
- **Releasing** is driven by the version in `apps/desktop/package.json` (it names the installer and
  fills `latest.yml`). Bump it, rename the `CHANGELOG.md` **Unreleased** heading to the new version,
  merge to `main`: CI builds, then publishes a release tagged `v<version>` whose notes are that
  changelog section (commit subjects since the previous tag if there is none). A build whose version
  is already released publishes nothing, so ordinary commits to `main` only build. Pushing a `v*`
  tag publishes the same way and fails the build if the tag and the version disagree.

## Brand & UI

- Assets live in `packages/brand/` (Geist fonts, `mark.svg`, the reference icon sheet). Every icon size
  is generated from vector geometry by `node apps/desktop/build/icons.mjs` — never hand-crop bitmaps.
  The same geometry is duplicated in `renderer/components/Mark.tsx`, the phone `index.html` and the
  engine placeholder (`vcam.ts`); change all four together.
- Palette/typography are CSS tokens at the top of `renderer/styles.css` (mirrored in the phone
  `styles.css` and `THEME` in `main/ui-window.ts` for the native title bar). Violet `#8a5cf3` is the
  single accent (buttons, active states, live indicator); light violet `#ccb6fe` for active text;
  amber/red only for paused/error. Low contrast on purpose: violet-tinted grays, no pure white surfaces.
- The main window is state-driven: `PairView` (QR + steps) until a phone connects, `LiveView`
  (preview + controls) afterwards. Settings and the QR-while-live are dialogs, not panels.
- Icons: `lucide-react` only. Fonts: Geist / Geist Mono, self-hosted (no network on the phone page).

## Performance notes (measured, Electron 44 / Win10, 1080p stream)

Numbers from the perf pass on 2026-09-12; re-measure before changing any of these decisions.

- **Software video decoding is the default** (`--disable-accelerated-video-decode` unless
  `settings.hardwareDecode`). Hardware-decoded frames are GPU-backed NV12: `VideoFrame.copyTo()`
  costs ~12 ms per 1080p frame (GPU readback). Software frames are CPU I420: ~0.4 ms. Decode itself
  costs ~0.13 core at 1080p20. Whole app while streaming into a consumer: ~0.25 core, flat memory.
- **Never draw frames into a canvas/img in either renderer.** `drawImage(VideoFrame)`,
  `createImageBitmap` + `drawImage`, and blob-URL `<img>` all grow the GPU process by 10–30 MB/s
  without bound. The preview path is: native pipeline → downscaled RGBA → IPC → `putImageData` on a
  `willReadFrequently` canvas in the UI. Keep it that way.
- libyuv under MSVC x64 has no SIMD for NV12→RGB24 (10 ms/frame); NV12 goes through I420 (1.5 ms).
- Nothing is copied or converted while no app reads the camera and the preview is hidden; after
  5 s of that the phone is told to drop to 5 fps (`setIdle`) to save its battery.
- H.264 High profile is preferred only on Safari. Chrome's software encoder advertises High but
  stalls the sender after ~30 s when it is selected.
- Diagnostics: `OMNICAM_DEBUG=timing,cpu` (engine copy/convert times, per-process CPU),
  `nocopy` / `nopreview` to bisect the pipeline; `OMNICAM_UI_DEBUG=metrics` logs renderer
  layout/style counters. `scripts`: see `packages/vcam-native/scripts`.

## Roadmap (not built yet)

- Windows 11 Media Foundation virtual camera backend (for UWP/MF-only apps).
- macOS: CoreMediaIO Camera Extension backend (needs Apple signing). Linux: v4l2loopback.
- "No-warning mode": real domain + per-install certificate (requires internet + a small service).
- Virtual microphone. Code signing.
