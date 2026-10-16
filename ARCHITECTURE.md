# OmniCam — architecture and engineering notes

## What this is

A desktop app (Windows and Linux; macOS later) that turns a phone's camera into a **virtual
webcam** for Discord, Zoom, Teams, Chrome, OBS… with **nothing installed on the phone**:

1. Desktop app shows a QR code.
2. Phone (same Wi-Fi) scans it → a web page opens in the phone browser.
3. User accepts a one-time browser certificate warning, taps *Start camera*, allows camera access.
4. Video streams over WebRTC (LAN, peer-to-peer) into the desktop app, which feeds a virtual
   camera device named **"OmniCam"**: a DirectShow filter on Windows, a v4l2loopback device on Linux.

Priorities, in order: it must *just work* for non-technical users; video quality and latency on
par with native camera apps; front/back camera switching; robust reconnects. The phone's microphone
can come along, or replace the camera: it is played into a virtual audio cable on Windows, and into OmniCam's own
PipeWire microphone on Linux (see **Phone microphone**).

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
| Windows has no user-mode virtual microphone; audio drivers must be signed by Microsoft | The phone's audio is **played into a virtual audio cable** (VB-CABLE, installed by the user) with `setSinkId`; apps pick the cable's other end. An own signed driver is roadmap. |
| Linux has one virtual camera every consumer sees: v4l2loopback, an out-of-tree kernel module | One device labelled `OmniCam` (`exclusive_caps=1`, `video_nr=63`), **found by its label**, never by number. Root **once**, through polkit or the rpm/deb scriptlet, for a fixed setup script; never at launch, never `sudo` from the app. |
| Secure Boot rejects unsigned modules | The setup reports it (exit 14) and the UI shows the distro's key-enrolment steps (Fedora: akmods key + `mokutil`). Free, no BIOS change. |
| Linux audio needs no driver for a microphone | While OmniCam runs, `pactl` adds a null sink **OmniCam Feed** and a source **OmniCam Microphone** remapped from its monitor; no root. The engine is the same as on Windows. |
| Stock GNOME has no tray (no StatusNotifier host) | A tray only where `org.kde.StatusNotifierWatcher` has an owner; otherwise closing the window **minimises** it and `--hidden` starts minimised, so the app is never invisible. |
| electron-updater only replaces AppImages on Linux | AppImage updates in the app (`latest-linux.yml`); rpm and deb point to Releases. No Flatpak or Snap: a sandbox cannot set up a kernel module. |

## Architecture

```
PHONE (browser)                       DESKTOP (Electron)
 apps/phone  ── HTTPS GET / ────────►  main process   (apps/desktop/src/main)
             ── POST /api/session ──►    https server, cert, QR/token, tray, settings, IPC hub
             ◄ WebRTC video+audio+DC ► engine window  (apps/desktop/src/engine)  [nodeIntegration]
                                          RTCPeerConnection → MediaStreamTrackProcessor
                                          → VideoFrame.copyTo → addon.pushFrame()
                                          audio track → <audio>.setSinkId(cable) → apps' microphone
                                       native addon   (packages/vcam-native)  [C++]
                                          pacing thread, libyuv convert/scale/rotate → the backend's format
                                          Windows: BGR24 → softcam shared memory → omnicam_vcam.dll (DirectShow)
                                          Linux:   YUYV  → write() → /dev/videoN (v4l2loopback "OmniCam")
                                       UI window      (apps/desktop/src/renderer)  [sandboxed React]
                                          talks to main only via preload bridge (window.omnicam)
                                       platform       (apps/desktop/src/platform), called by main only
                                          autostart, tray support, camera setup, Linux microphone
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
  goes to `%APPDATA%\OmniCam\logs\omnicam.log` (Linux: `~/.config/OmniCam/logs/omnicam.log`), 2 MB with one
  rotation.

## Phone microphone

- **A loopback, not a driver.** The engine plays the phone's audio track through a hidden `<audio>`
  element whose output is a virtual cable (`setSinkId`); apps choose the cable's capture side as their
  microphone. Chromium's WebRTC jitter buffer already absorbs network jitter, the phone-vs-device clock
  drift and resampling in native code, so there is no Web Audio graph and no native audio code. An own
  signed "OmniCam Microphone" driver would be one more loopback for `shared/audio-sink.ts` to recognise;
  the engine would not change. Linux already works that way (below).
- **Linux: OmniCam's own pair** (`platform/virtual-mic-linux.ts`, `platform/pactl.ts`). At start `pactl`
  loads `module-null-sink` (`sink_name=omnicam_feed`, "OmniCam Feed") and `module-remap-source`
  (`source_name=omnicam_mic`, "OmniCam Microphone", from the feed's monitor); quitting unloads them, and a crash's
  leftovers are found by those names in `pactl list short modules` and unloaded first. Chromium labels the sink
  with its description, so `audio-sink.ts` simply knows "OmniCam Feed". The descriptions are quoted
  `'device.description="…"'`: pipewire-pulse cuts any other form at the first space. Both nodes get
  `priority.session=0` and are set to 100%, unmuted, twice (WirePlumber restores saved volumes by name, on its own
  schedule). A `pactl subscribe` watcher re-creates them if they vanish and, if the feed ever becomes the default
  output (WirePlumber falling back through its history, or a slip in the sound settings), switches back to the
  previous output: that would mute the speakers and send everything into the phone's microphone. All `pactl`
  calls run with `LC_ALL=C`, since `pactl info` is parsed.
- **Never the speakers.** `shared/audio-sink.ts` (shared by engine and UI, tested) only returns known
  loopback outputs, never Chromium's follow-the-default entries. The track is attached only after
  `setSinkId` succeeds, only while the phone reports its microphone on, and is detached when the cable
  goes away. With nothing attached Chromium does not decode the audio (verified: `totalSamplesDuration` 0).
- **Nothing while the microphone is off.** Listing or watching audio devices (`enumerateDevices`,
  `devicechange`) makes Chromium start its audio service and list cameras as well, and both stay for the
  rest of the session. So the engine and the live view only do it while the phone's microphone is on
  (Settings does it while open), and the video-capture service runs in the main process
  (`RunVideoCaptureServiceInBrowserProcess`): ~7 MB there instead of a ~64 MB process of its own.
  Listing cameras briefly opens OmniCam's own, so the log shows "camera opened by an app" once.
- **Switching without renegotiating.** The phone always offers one video and one audio transceiver and
  switches each with `replaceTrack(track | null)`; `setMic` / `setCamera` and the phone's `sources`
  message carry the state. The phone keeps at least one on. The tracks share no `MediaStream`, so Chromium
  does not lip-sync them and hold the video (`jitterBufferTarget = 0`) back to the audio's pace.
- **A raw microphone.** The phone opens it with echo cancellation, noise suppression and AGC off, like a
  USB mic: the app on the PC does its own. Camera and microphone open in one `getUserMedia` call (one
  permission prompt on iOS), then the audio track leaves the camera's stream so camera restarts never
  cut it. The answer asks for mono Opus at 64 kbps with in-band FEC (`engine/sdp.ts`).
- **Camera off is not a stall.** With the camera off, stall detection follows audio packets instead of
  frames, and apps get a "camera is off" placeholder rather than a frozen last frame. The UI's speaking
  glow comes from `totalAudioEnergy` in the stats the engine already polls. WebRTC adds up squared 10 ms
  *peaks* after the element's volume, so the level reads a little above true RMS, and a silent test at
  volume 0 reads 0.

## Repository layout

```
package.json                 npm workspaces (no pnpm — keep prerequisites minimal)
apps/desktop/                Electron app (electron-vite, React, TS)
  src/main/                  index.ts, server.ts, cert.ts, network.ts, session.ts, settings.ts,
                             engine-bridge.ts (only thing that talks to the engine), tray.ts, ui-window.ts,
                             log.ts (%APPDATA%\OmniCam\logs), user-data.ts (1.0.0 folder migration)
  src/platform/              per-OS services main calls (never the other way): types.ts (the interface), win.ts,
                             linux.ts (XDG autostart, tray check over D-Bus, camera setup, virtual-mic-linux.ts),
                             and pure, tested helpers (desktop-entry, dbus, pactl, os-release, setup-result)
  src/engine/                engine.ts (WebRTC receiver, stats, preview JPEGs, frame pump), vcam.ts (addon API),
                             mic.ts (phone audio → virtual cable), sdp.ts (answer tuning)
  src/renderer/              React UI (Pairing, Preview, Controls, Settings)
  src/preload/               contextBridge → window.omnicam (typed in shared/ipc.ts)
  src/shared/ipc.ts          IPC channel names + payload types, settings and stats (single source of truth)
  src/shared/audio-sink.ts   which audio outputs the phone's microphone may play into (engine and UI)
  src/shared/vcam-error.ts   camera error codes → title, line, commands and the Set up button (tested)
  resources/phone/           built phone page (generated, git-ignored)
  resources/native/          built addon + DLLs (generated, git-ignored)
  build/                     installer hooks, icon generator; build/linux: omnicam-camera-setup.sh, rpm/deb
                             scriptlets, icon theme sizes
apps/phone/                  Vanilla TS page (camera.ts, mic.ts, signaling.ts, main.ts). No framework — it must load instantly.
packages/protocol/           Wire types the phone and desktop exchange (HTTP API, DataChannel messages)
packages/vcam-native/        C++: addon.cc (N-API), pipeline.cc (double buffer + pacing + libyuv),
                             backend/ivcam.h (per-OS interface), backend/win_softcam.cc, backend/linux_v4l2.cc,
                             tools/vcam_selftest.cc (Linux: pushes a test pattern without Electron),
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
npm test                    # node --test, no extra dependencies (apps/desktop/test)
npm run dist                # NSIS installer (registers DLLs + firewall rule)
```

Without the native build the app still runs (QR, phone connection, preview) and reports
"native addon not available" in the UI — useful for working on the web/UI parts.

On Linux: Node ≥ 20, g++, make, CMake, plus `v4l-utils` and `pulseaudio-utils` (CONTRIBUTING lists the packages),
and the v4l2loopback module for the camera. `native:register` is not needed: the app's *Set up camera* button
runs `build/linux/omnicam-camera-setup.sh`. `npm run dist:linux` builds the AppImage, rpm and deb.
`apps/desktop/test/e2e/fake-phone.cjs` stands in for a phone (Chromium's fake camera and microphone).

## Conventions

- TypeScript strict everywhere; shared types live in `packages/protocol` (only what crosses to the
  phone) or `src/shared/ipc.ts` (desktop-only) — never duplicate a message shape.
- Main ↔ engine IPC goes through `engine-bridge.ts` only. UI ↔ main goes through the preload
  bridge only (UI is sandboxed; no Node in the renderer).
- Which folder may import which is written down in `al-dente.json`: main, engine, preload and the
  UI only meet through `src/shared`, and the phone page only uses `packages/protocol`. `platform` may use
  `src/shared` only; main calls it, never the other way, and main does not branch on `process.platform` for
  anything platform covers.
- Phone page: no dependencies, no framework, must work on iOS Safari 15+ and Android Chrome.
  Every browser API call that can be unsupported is wrapped (wake lock, torch, codec prefs…).
- Native code: never touch `third_party/` submodules; adapt at build time (see
  `cmake/patch_softcam.cmake`) or wrap. New platforms implement `IVirtualCamera`, and say which pixel format they
  want (`preferredFormat()`); the pipeline produces it.
- **Camera errors start with a code**, `"<code>: <sentence for the log>"`: `not-registered`, `busy` (both),
  `no-module`, `not-loaded`, `no-device`, `permission`, `format`, `io` (Linux), `no-addon` (engine).
  `shared/vcam-error.ts` turns them into what the UI shows; anything without a known code is shown as it is.
- **Root, and every other process OmniCam starts.** Root only through polkit (`pkexec`) for
  `omnicam-camera-setup.sh install`, or from the rpm/deb scriptlets. An rpm or deb runs its root-owned copy in
  place (checked: root's, no group or other write bit); an AppImage or dev build passes the script's text to
  `bash -c`, so there is never a user-owned file for root to run. The script's exit codes are a contract with the
  UI: 0 ok, 10 no module for this kernel, 11 load failed, 12 usage, 13 busy, 14 Secure Boot, 15 another
  `options v4l2loopback` would override OmniCam's (named in the last stderr line); pkexec's 126/127 mean cancelled.
  Its module options are `devices=1 video_nr=63 card_label="OmniCam" exclusive_caps=1 max_buffers=2`. After a
  setup, main runs `udevadm settle` before the engine opens the new device: until udev applies the seat user's
  ACL, the node is root's and opening it fails with EACCES. `pactl`, `gdbus`, `udevadm` run through `execFile`
  with fixed arguments, never a shell. `~/.config/OmniCam` is 0700 and the certificate key 0600.
- Frame pixel formats accepted by the addon mirror WebCodecs names (`I420`, `NV12`, `RGBA`, `BGRA`…).
  libyuv's "RGB24" is B,G,R in memory — that *is* DirectShow RGB24; don't "fix" it.
- Errors that a user can act on (driver not registered, port busy, firewall) must surface in
  the UI with a concrete instruction, not just in logs.
- CI (`.github/workflows/build.yml`) typechecks, runs the tests, builds the native pieces and the
  installer on every push, and publishes a release when the version is new (see **Releasing**), with a
  build provenance attestation and the installer's SHA-256 in the notes. CodeQL scans TypeScript and
  C++ (`codeql.yml`); Dependabot opens weekly grouped updates (Electron majors excluded).
- **Tests** run on Node's built-in runner with type stripping, so a tested module must not import
  Electron and must use erasable TypeScript only (no enums, no parameter properties). Security checks
  that the LAN can reach live in `src/main/pairing-guard.ts` for that reason.
- **Updates** (`src/main/updater.ts`): electron-updater against GitHub Releases. On Linux only the AppImage
  updates itself (`$APPIMAGE` set; it reads `latest-linux.yml`); an rpm or deb reports `unsupported: 'package'`
  and links to Releases. Checks quietly 15 s
  after launch and every 24 h; never downloads or installs without a click. The installer is verified
  against the sha512 in `latest.yml`, then runs silently (one UAC prompt) and restarts OmniCam.
  A release is only offered once it is **published** (not a draft) and carries `latest.yml` next to
  the `.exe`; CI attaches both. electron-updater is bundled into the main process like every other
  dependency (devDependencies, no `node_modules` in the package).
  The update dialog shows **What's new** from the same check: `fullChangelog` gives the notes of every
  version since the installed one (GitHub's HTML of each release body, from the release feed), cut at
  the first `<hr>` where CI's install steps start, and `ReleaseNotes.tsx` rebuilds them from their text
  and a few tags (never `innerHTML`; `<br>` from the CHANGELOG's hard wraps become spaces).
  After an update, the first launch shows **What's new in X** once, offline: `electron.vite.config.ts`
  bakes this version's CHANGELOG section into the UI (`build/release-notes.ts`, a converter for the
  CHANGELOG's small Markdown, tested), and `notesSeen` in settings records it was shown. It is set at
  once on a fresh install; a settings file without it (any older install, the 1.0.0 migration) counts as
  updated. Releasing renames Unreleased to the version before CI builds, so each installer carries its notes.
- **The feed is this repository's public Releases.** The GitHub provider requests releases
  unauthenticated, so the check only works while the repository is public; a private repo answers
  404 and the UI reports "No published release was found". Installs from before the repository went
  public (1.0.0) find the feed now with no change on their side. To move the feed elsewhere later,
  point `publish.owner/repo` in `electron-builder.yml` at a releases-only repo (and give CI a token
  for it), or use `provider: generic` against a static host. Neither changes what the app does with
  the feed. Every check downloads `latest.yml`, so its download count on a release is a rough measure
  of running installs (checks, not unique users); OmniCam has no telemetry.
- **Code signing** (SignPath Foundation, [CODE_SIGNING.md](CODE_SIGNING.md)): the CI steps run only for a
  release build and only once the repository variable `SIGNPATH_ORGANIZATION_ID` is set (plus
  `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG` and the secret `SIGNPATH_API_TOKEN`). Inside out: the
  `win-unpacked` directory is signed (artifact configuration `app`), the installer is built from it with
  `--prepackaged` and signed (`installer`), then `build/signing.mjs` rewrites `latest.yml` and the blockmap
  for the signed bytes and writes the `app-update.yml` a prepackaged build skips. Both configurations live
  in `.signpath/artifact-configurations/`; SignPath holds the copies it uses. Every request waits for a
  manual approval in SignPath. Only our own binaries are signed, never Electron's, and every one carries a
  version resource (`packages/vcam-native/src/version.rc.in`). Do not set `win.publisherName` until a
  signed release has shown the exact certificate subject: once set, the updater rejects any installer not
  signed by that name.
- **Website**: `website/index.html` (+ `site.css`, `site.js`; static, no build step) uses the README's own
  images in `docs/media`, so opening the file locally shows the real page.
  `.github/workflows/pages.yml` publishes `website/` to GitHub Pages with `docs/media` flattened into the
  site root and the Geist fonts copied in from `assets/brand/fonts`. Download and star counts are read
  live from GitHub's API by `site.js`, so the page never shows a stale hard-coded number. It links to GitHub Releases for downloads and hosts no binaries.
- **Releasing** is driven by the version in `apps/desktop/package.json` (it names the installer and
  fills `latest.yml`). Bump it, rename the `CHANGELOG.md` **Unreleased** heading to the new version,
  merge to `main`: CI builds, then publishes a release tagged `v<version>` whose notes are that
  changelog section (commit subjects since the previous tag if there is none). That section is also
  what the app shows as What's new, so write it for users, and never put a `---` rule in it: the app
  stops reading at the first one. A build whose version
  is already released publishes nothing, so ordinary commits to `main` only build. Pushing a `v*`
  tag publishes the same way and fails the build if the tag and the version disagree.

## Brand & UI

- Assets live in `assets/brand/` (Geist fonts, `mark.svg`, the reference icon sheet). Every icon size
  is generated from vector geometry by `node apps/desktop/build/icons.mjs` — never hand-crop bitmaps.
  The same geometry is duplicated in `renderer/components/Mark.tsx`, the phone `index.html` and the
  engine placeholder (`vcam.ts`); change all four together. The phone's microphone mark (`#mic-mark` in the
  phone `index.html`) borrows the camera mark's signal arcs, line weights and colour, so it follows them too.
- Palette/typography are CSS tokens at the top of `renderer/styles.css` (mirrored in the phone
  `styles.css` and `THEME` in `main/ui-window.ts` for the native title bar). Violet `#8a5cf3` is the
  single accent (buttons, active states, live indicator); light violet `#ccb6fe` for active text;
  amber/red only for paused/error. Low contrast on purpose: violet-tinted grays, no pure white surfaces.
- The main window is state-driven: `PairView` (QR + steps) until a phone connects, `LiveView`
  (preview + controls) afterwards. Settings and the QR-while-live are dialogs, not panels. Settings is a
  sidebar of five sections (Camera, Microphone, Connection, App, About), each opening with a one-line status;
  a section with a problem gets a dot and is where Settings opens. Settings carry one short line; longer
  explanations go in an ⓘ tooltip, rarely used ones under a collapsed Advanced (a native `<details>`).
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

## Performance notes (measured, Linux)

Measured on 2026-10-16: Fedora 44, Intel Core i7-1185G7, dev build (not packaged), 1080p YUYV output, Chromium's
fake phone camera at 1080p **20 fps**, software H.264 decoding. CPU is OmniCam's whole process tree as a share of one
core, averaged over 30 s; memory is PSS (RSS double-counts shared pages). A 30 fps phone costs more while streaming.
Re-measure before changing any of these decisions.

| State | CPU | Processes | PSS |
|---|---|---|---|
| Idle, no phone | 2.1% | 8 | 389 MB |
| Phone connected, no reader, window minimised | 13.0% | 10 | 364 MB |
| Streaming 1080p into a reader (ffmpeg), window minimised | 22.8% | 10 | 376 MB |

Per 1080p frame in the native pipeline: I420→YUYV 0.65–0.77 ms (I420→I420 0.39 ms); `VideoFrame.copyTo` ~0.55 ms.

- **YUYV out, no RGB.** The pipeline converts the phone's I420 straight to YUYV (`I420ToYUY2`), the one format
  every V4L2 consumer accepts; `OMNICAM_V4L2_FORMAT=i420` writes I420 for testing.
- **Who is watching:** v4l2loopback 0.13+ sends a client-usage event when a reader starts or stops; older modules
  fall back to counting other processes holding the device in `/proc/*/fd`, at most once a second. That count
  drives "convert nothing while nobody watches" and the phone's 5 fps idle mode, as on Windows.
- **A minimised window is still "visible" on Wayland** (xdg-shell has no minimised state a client sees), so main
  runs the preview only while the window is shown and not minimised by its own account
  (`ui-window.ts`, `syncPreview`). Without that the preview never stopped and the phone never went idle:
  47% → 13% of a core with a phone connected and nobody watching. Only a minimise OmniCam makes itself counts (its
  close button without a tray, a `--hidden` start): one the desktop makes (Super+H, a dock click) reaches the app as
  a mere blur, with page visibility and animation frames unchanged (checked on GNOME 50), so the preview runs on.

## Roadmap (not built yet)

Sizes, reasoning and contribution notes are in [ROADMAP.md](ROADMAP.md); this is the short technical list.

- Windows 11 Media Foundation virtual camera backend (for UWP/MF-only apps).
- macOS: CoreMediaIO Camera Extension backend (needs Apple signing). Linux: a PipeWire camera as a
  second backend next to v4l2loopback.
- "No-warning mode": real domain + per-install certificate (requires internet + a small service).
- An own signed microphone driver, replacing VB-CABLE. Code signing (in progress, SignPath).
