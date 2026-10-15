# OmniCam on Linux — port plan

Two Claude Code sessions build this in parallel, each in its own git worktree:

| Session | Worktree | Branch | Owns |
|---|---|---|---|
| **A — Native agent** | `~/Desktop/Projects/OmniCam-native` | `feat/linux-native` | `packages/vcam-native/**`, `apps/desktop/build/linux/**`, `apps/desktop/electron-builder.yml`, `.github/workflows/**`, the `package.json` scripts |
| **B — Desktop agent** | `~/Desktop/Projects/OmniCam-desktop` | `feat/linux-desktop` | `apps/desktop/src/**`, `apps/desktop/test/**`, `apps/desktop/tsconfig*.json`, `al-dente.json`, the docs |

Both merge into **`feat/linux`** (the main checkout, `~/Desktop/Projects/OmniCam`), which has a draft PR into
`main`. Nothing reaches `main` until the user merges that PR.

Steps run in pairs: **A1 ∥ B1 → A2 ∥ B2 → A3 ∥ B3 → I1 (A) → phone test (you) → D1 (B)**. A step may start once
the previous pair is merged into `feat/linux`; within a pair the two agents never touch the same files.

---

## 1 · Target architecture on Linux

```
PHONE (browser)                    DESKTOP (Electron, same code as Windows)
 apps/phone ── HTTPS / POST ─────►  main            server, cert, QR, session, tray, settings
            ◄ WebRTC video+audio ►    └─ platform   (NEW part) autostart · tray support · camera setup · virtual mic
                                    engine          WebRTC → VideoFrame.copyTo → addon.pushFrame
                                    │               audio → <audio>.setSinkId("OmniCam Feed")
                                    native addon    pipeline (libyuv) → backend chosen at build time:
                                    │                  Windows: softcam → DirectShow filter   (unchanged)
                                    │                  Linux:   linux_v4l2.cc → /dev/videoN  (YUYV)
                                    ▼
             v4l2loopback device "OmniCam"  ──►  Zoom, Discord, Chrome, Firefox, OBS
             PipeWire null sink "OmniCam Feed" → remapped source "OmniCam Microphone" ──► apps' mic
```

### Decisions (argue with them before coding, not during)

| # | Decision | Why |
|---|---|---|
| D1 | **Camera = v4l2loopback**, one device labelled `OmniCam`, `exclusive_caps=1`, `video_nr=63`; the backend finds it by label, never by number. | The only virtual camera every consumer (Zoom, Discord, Chrome, Firefox, OBS) sees. A PipeWire camera can come later as a second `IVirtualCamera` backend. |
| D2 | **The backend picks its pixel format** (`preferredFormat()`); Linux uses **YUYV**, `OMNICAM_V4L2_FORMAT=i420` switches for testing. Windows keeps BGR24. | ROADMAP item 2: avoids I420 → BGR24 → YUV. YUYV is the one format every V4L2 consumer accepts. |
| D3 | **Consumer count**: v4l2loopback's client-usage event if the installed header has it, otherwise a `/proc/*/fd` scan at most once a second. | `consumers()` drives "convert nothing while nobody watches" and the phone's 5 fps idle mode. |
| D4 | **Root only once**: a setup script run through `pkexec` (AppImage) or by the rpm/deb install scriptlet writes `modprobe.d` + `modules-load.d` and loads the module. Never at every launch, never `sudo` from the app. | The device must survive reboots; the app runs as the user. |
| D5 | **Microphone = PipeWire, no root**: main creates a null sink `OmniCam Feed` and a remapped source `OmniCam Microphone` with `pactl` while OmniCam runs, removes them on quit, cleans leftovers at start. The engine is unchanged. | Linux needs no VB-CABLE; `setSinkId` already works against PipeWire's Pulse layer. |
| D6 | **New `platform` part** (`apps/desktop/src/platform/`): every OS-specific main-process service lives there behind one interface, with `win.ts` wrapping today's behaviour. `main/index.ts` stops branching on `process.platform` for these. | Keeps the Windows path byte-for-byte in behaviour and the Linux code in one place. |
| D7 | **Packages: AppImage (in-app updates via `latest-linux.yml`), rpm, deb**, x64. No Flatpak/Snap of OmniCam (a sandbox cannot set up a kernel module). | electron-updater only updates AppImages; rpm/deb update through Releases. |
| D8 | **Tray only when a StatusNotifier host exists** (checked over D-Bus). Otherwise closing the window minimises it and `--hidden` starts minimised — the app is never invisible. | Stock GNOME has no tray. |
| D9 | **Windows stays green.** Nobody can build Windows here: the draft PR's Windows CI job is the check after every merge. | |
| D10 | **Lightweight later.** This port stays Electron. I1 records CPU/RAM so a native Linux daemon can be judged on numbers. | |

### Updated `al-dente.json` (B1 applies this)

```json
{
  "parts": {
    "desktop-ui":     { "label": "Desktop UI",     "description": "React renderer: pairing, live view, settings", "paths": ["apps/desktop/src/renderer"], "uses": ["desktop-shared", "protocol"] },
    "main":           { "label": "Main process",   "description": "Electron main: server, sessions, tray, updater", "paths": ["apps/desktop/src/main"], "uses": ["platform", "desktop-shared", "protocol"] },
    "platform":       { "label": "Platform",       "description": "Per-OS services for main: autostart, tray support, camera setup, virtual microphone", "paths": ["apps/desktop/src/platform"], "uses": ["desktop-shared"] },
    "engine":         { "label": "Engine",         "description": "WebRTC receive and virtual camera output", "paths": ["apps/desktop/src/engine"], "uses": ["desktop-shared", "protocol"] },
    "preload":        { "label": "Preload",        "description": "Bridge exposing IPC to the renderer", "paths": ["apps/desktop/src/preload"], "uses": ["desktop-shared", "protocol"] },
    "phone":          { "label": "Phone app",      "description": "Browser page that streams the phone camera", "paths": ["apps/phone/src"], "uses": ["protocol"] },
    "desktop-shared": { "label": "Desktop shared", "description": "IPC contract and stream format helpers", "paths": ["apps/desktop/src/shared"], "uses": ["protocol"] },
    "protocol":       { "label": "Protocol",       "description": "Types and messages shared by phone and desktop", "paths": ["packages/protocol/src"], "uses": [] }
  }
}
```

`platform` may not import `main` (main calls platform, never the other way). The native C++ stays outside the
map; its seam is `backend/ivcam.h`.

---

## 2 · Rules for both agents (every step)

1. **Read first**: this file (§1–§3 and your step), `ARCHITECTURE.md`, and the files your step names. Match the
   surrounding code: comment density, naming, idiom. Conventions in `ARCHITECTURE.md` → *Conventions* apply.
2. **Where commands run.** If `/.flatpak-info` exists you are inside a Flatpak sandbox: run every `node`, `npm`,
   `npx`, `electron`, native build, `v4l2-ctl`, `ffmpeg`, `pactl`, `gh` command on the host with
   `flatpak-spawn --host bash -lc 'cd <dir> && <command>'`. The addon must be built on the host.
3. **No `sudo`, ever.** When something needs root (dnf, modprobe, installing an rpm), stop and give the user the
   exact command.
4. **al-dente**: respect the part map. If the al-dente plugin blocks an edit, the design is wrong — don't work
   around it. Only B1 changes `al-dente.json`. Run the al-dente check before finishing a step if the plugin is installed.
5. **Contracts in §3 are fixed.** Need one changed? Stop and tell the user; they relay it to the other agent.
6. **Stay in your files** (table at the top). Need a change in the other agent's files? Say so in your report.
7. **Windows parity**: every change keeps Windows behaviour identical. Re-read your diff for that before committing.
8. **Finish a step** like this:
   - `npm run typecheck && npm test` pass (on the host), plus your step's acceptance checks.
   - Commit in small commits with subjects like the existing history (`git log --oneline -20`): imperative, no prefix.
   - `git rebase feat/linux`, then
     `git -C ~/Desktop/Projects/OmniCam merge --ff-only <your branch>` (if it refuses, the other agent merged
     first: rebase again and retry), then `git -C ~/Desktop/Projects/OmniCam push origin feat/linux`.
   - Watch the PR's CI (`gh pr checks --watch` from the main checkout); Windows must stay green.
   - Report: what changed, what you tested and how, what you could not test, anything for the other agent.

---

## 3 · Contracts between the agents

**C1 — Camera error reasons.** Every error string from the addon (`probe().reason`, `start()` throws) starts with a
code: `"<code>: <sentence for the log>"`. The UI maps codes to instructions (B3, `shared/vcam-error.ts`).

| Code | Who | Meaning |
|---|---|---|
| `not-registered` | Windows | DirectShow filter not registered |
| `busy` | both | Another OmniCam / another producer owns the device, or a consumer blocks a format change |
| `no-module` | Linux | No v4l2loopback module for the running kernel |
| `not-loaded` | Linux | Module exists but is not loaded |
| `no-device` | Linux | Module loaded but no device labelled `OmniCam` |
| `permission` | Linux | `/dev/videoN` can't be opened (EACCES) |
| `format` | Linux | `VIDIOC_S_FMT` / `S_PARM` rejected |
| `io` | Linux | Anything else (errno text in the sentence) |
| `no-addon` | engine (TS) | `omnicam_vcam.node` missing or failed to load |

**C2 — Camera setup script.** `apps/desktop/build/linux/omnicam-camera-setup.sh` (A3 writes it), packaged at
`resources/linux/omnicam-camera-setup.sh`. Dev path: `apps/desktop/build/linux/…`. Usage, as root:
`omnicam-camera-setup.sh install|remove`. Its last stderr line is a human sentence. Exit codes:
`0` ok · `10` no module for this kernel · `11` load failed (other) · `12` usage · `13` busy (a program has a camera
open) · `14` Secure Boot rejected the module · `15` another `options v4l2loopback` config exists (named in the message).
Main (B3) runs it as `pkexec /bin/bash <copy> install`, where `<copy>` is a 0700 copy in `$XDG_RUNTIME_DIR` (root
can't read an AppImage's FUSE mount). pkexec's own `126`/`127` = cancelled / not authorised.

**C3 — Module options** (script and package scriptlets use exactly these):
`options v4l2loopback devices=1 video_nr=63 card_label="OmniCam" exclusive_caps=1 max_buffers=2` in
`/etc/modprobe.d/omnicam.conf`, and `v4l2loopback` in `/etc/modules-load.d/omnicam.conf`.

**C4 — Native files.** Linux ships only `resources/native/omnicam_vcam.node`; the JS API in
`engine/vcam.ts` does not change. `OMNICAM_V4L2_DEVICE=/dev/videoN` overrides the device lookup (testing only).

**C5 — Virtual microphone names.** Sink `sink_name=omnicam_feed`, description `OmniCam Feed` (the output the engine
plays into). Source `source_name=omnicam_mic`, description `OmniCam Microphone` (what users pick in apps).

---

## 4 · Step 0 — you, before any agent starts

**0.1 Host packages**
```
sudo dnf install -y nodejs npm gcc-c++ make cmake git gh v4l-utils ffmpeg-free pulseaudio-utils
gh auth login
```

**0.2 v4l2loopback with Secure Boot on (free; no BIOS change)**
```
sudo dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
sudo dnf install -y akmods kernel-devel-$(uname -r)
sudo kmodgenca -a
sudo mokutil --import /etc/pki/akmods/certs/public_key.der     # pick a one-time password
systemctl reboot
```
At boot a blue **MOK management** screen appears once: *Enroll MOK → Continue → Yes →* the password *→ Reboot*.
Then:
```
sudo dnf install -y akmod-v4l2loopback v4l2loopback
sudo akmods --force && sudo depmod -a
sudo modprobe v4l2loopback devices=1 video_nr=63 card_label=OmniCam exclusive_caps=1
v4l2-ctl --list-devices        # expect: OmniCam (platform:v4l2loopback-000) → /dev/video63
```
Leave it loaded for A2. (The app's own setup makes it permanent in A3/B3.) If `modprobe` says *Key was rejected
by service*, the MOK enrolment didn't take: run `mokutil --list-enrolled | grep -i akmods` and repeat the import.

**0.3 al-dente** — install the al-dente plugin the way you did on Windows (it isn't in the official marketplace),
enable it in both sessions and start its live map. Its check on `main` should report no breaks.

**0.4 Branches, worktrees, draft PR**
```
cd ~/Desktop/Projects/OmniCam
git switch -c feat/linux
git add docs/linux-port/PLAN.md && git commit -m "Plan the Linux port"
git push -u origin feat/linux
gh pr create --draft --base main --head feat/linux --title "Linux port" --body "Plan: docs/linux-port/PLAN.md"
git worktree add ../OmniCam-native  -b feat/linux-native
git worktree add ../OmniCam-desktop -b feat/linux-desktop
for d in ../OmniCam-native ../OmniCam-desktop; do (cd "$d" && git submodule update --init --recursive && npm install); done
```

**0.5 Sessions** — open two terminals (a host terminal is simplest; inside a Flatpak IDE the agents use
`flatpak-spawn --host`): `cd ~/Desktop/Projects/OmniCam-native && claude` and
`cd ~/Desktop/Projects/OmniCam-desktop && claude`. Every prompt below is self-contained, so `/clear` between
steps is fine.

---

## 5 · Prompts

### Phase 1 (parallel)

#### A1 — Backend-chosen pixel format, per-OS native build  *(session A)*

```
You are the Native agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-native (branch
feat/linux-native). Read docs/linux-port/PLAN.md §1–§3 and step A1, ARCHITECTURE.md, ROADMAP.md items 2 and 3, and
everything in packages/vcam-native (src/, CMakeLists.txt, cmake/, scripts/, package.json). Follow PLAN.md §2.

Step A1: let a backend choose its output pixel format and make the native build per-OS. No real Linux camera yet.

1. backend/ivcam.h: add `enum class OutputFormat { BGR24, I420, YUYV };` and
   `virtual OutputFormat preferredFormat() const { return OutputFormat::BGR24; }`. sendFrame() receives a tightly
   packed frame in that format at the start() size (I420: Y, U, V planes back to back; YUYV: width*2 bytes per row).
   Update the comment block (it names the per-OS backends).
2. pipeline.h/.cc: the pipeline already builds an I420 canvas before I420ToRGB24Matrix. Produce the output in the
   device's format: BGR24 = today's call, unchanged; I420 = copy the canvas; YUYV = libyuv::I420ToYUY2. YUV output
   passes the source's YUV through (no RGB round trip); note the BT.601/709 caveat in a comment. Placeholder
   rendering, keepalive repeats and makePreview() (which assumes BGR24 out_ today) must work for every format —
   build the preview from whatever the output format is (e.g. I420ToARGB / YUY2ToARGB) with the same size and
   interval logic. Keep the "nothing converted while nobody watches" behaviour.
3. Worker thread off Windows: name it "omnicam-vcam" (pthread_setname_np); a modest priority bump that silently
   ignores failure. Leave the _WIN32 block as it is.
4. CMakeLists.txt: put everything Windows-only under if(WIN32) — the WIN32/_WINDOWS/UNICODE definitions, softcam,
   the filter, the version resource, MSVC flags, Windows libraries. OMNICAM_BUILD_FILTER defaults OFF off Windows.
   On Linux the addon builds from addon.cc, pipeline.cc and a new backend/linux_v4l2.cc with GCC flags
   (-Wall -Wextra on our code, -w on libyuv, -fPIC, hidden visibility). For now linux_v4l2.cc is a stub whose
   probe()/start() return "not-loaded: Linux camera backend not built yet" (PLAN §3 C1) — A2 fills it in.
5. Windows error reasons get their C1 codes: "not-registered: …" for the registry probe, "busy: …" for
   CreateCamera failing. Same sentences after the code.
6. scripts/build.mjs: per-OS. Linux: cmake-js --runtime electron --arch x64, no x86 pass, copy the .node to
   apps/desktop/resources/native/omnicam_vcam.node (find where cmake-js puts it with a single-config generator;
   don't guess). Windows path unchanged in behaviour. package.json register/unregister on Linux: print one line
   saying the camera is set up by the app (Settings → Camera) instead of running PowerShell.

Acceptance (on the host):
- npm run native:build succeeds on Fedora and writes apps/desktop/resources/native/omnicam_vcam.node.
- ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(require('./apps/desktop/resources/native/omnicam_vcam.node').probe(''))"
  (from the repo root) prints { ok: false, reason: 'not-loaded: …' }.
- npm run typecheck && npm test pass.
- Your diff keeps the Windows build identical in behaviour (re-read every if(WIN32) move). After merging and
  pushing per §2, the PR's Windows CI job is green — report its result.
```

#### B1 — Platform layer, al-dente map, autostart and tray on Linux  *(session B)*

```
You are the Desktop agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-desktop (branch
feat/linux-desktop). Read docs/linux-port/PLAN.md §1–§3 and step B1, ARCHITECTURE.md, al-dente.json, and
apps/desktop/src/main/{index,tray,ui-window,log,user-data,settings,updater}.ts, src/shared/ipc.ts,
src/preload/*, tsconfig.node.json, tsconfig.test.json. Follow PLAN.md §2.

Step B1: introduce the `platform` part and make the app behave on Linux outside the camera and microphone.

1. Apply the al-dente.json in PLAN §1 exactly. Add src/platform to tsconfig.node.json. Run the al-dente check.
2. Create apps/desktop/src/platform/: types.ts (the Platform interface), win.ts (today's behaviour, moved, not
   changed), linux.ts, index.ts (picks one by process.platform; anything else falls back to a safe no-op
   implementation). Design the interface for what main needs now and what B2/B3 will add (virtual mic, camera
   setup) without implementing those yet. Pure logic (desktop-entry text, D-Bus reply parsing, quoting) goes in
   files that don't import electron, so node --test can cover them (see tsconfig.test.json and the Tests
   convention in ARCHITECTURE.md). platform must not import main.
3. Autostart on Linux: an XDG autostart entry ($XDG_CONFIG_HOME or ~/.config)/autostart/omnicam.desktop with
   Exec = $APPIMAGE if set, else process.execPath, quoted per the Desktop Entry spec, plus --hidden; removed when
   turned off; reconciled at startup (setting on but the file points at an old AppImage path → rewrite).
   main/index.ts calls platform instead of app.setLoginItemSettings.
4. Tray support (PLAN D8): Linux checks for a StatusNotifier host
   (org.freedesktop.DBus.NameHasOwner "org.kde.StatusNotifierWatcher" via gdbus, 2 s timeout, any failure = no
   tray). Without one: no Tray is created, closing the window minimises instead of hiding, and --hidden starts
   minimised. Put `trayAvailable` in AppState (shared/ipc.ts); Settings → App shows "close to tray" disabled
   with one short line and an ⓘ: "GNOME needs the AppIndicator extension for a tray icon." Follow the Brand & UI
   rules in ARCHITECTURE.md.
5. The `ms-settings:sound` special case in UI_OPEN_EXTERNAL becomes a platform question (Windows: that URL;
   Linux: none for now). Keep the allowlist strict.
6. Check main/ui-window.ts for Windows-only window options (title bar overlay, materials, .ico paths) and make
   the window look right on GNOME Wayland (client-side decorations) without changing Windows. Check that log.ts,
   settings and user-data resolve under ~/.config/OmniCam on Linux and that the 1.0.0 migration is a no-op
   there; fix comments that say %APPDATA% only.
7. Tests for the pure pieces (desktop entry text and quoting, gdbus reply parsing).

Acceptance (on the host):
- npm run typecheck && npm test pass; al-dente check: no breaks.
- npm run dev starts OmniCam on Fedora GNOME Wayland: QR shows, the camera error reads "not-loaded: …" or
  "no-addon: …", closing the window minimises (no AppIndicator) — ask the user to confirm what they see, and to
  try the phone: pairing and the live preview should already work without a camera device.
- Autostart on/off creates/removes the .desktop file (show its contents).
- Windows behaviour unchanged: win.ts is a move, not a rewrite. Windows CI green after merge.
```

### Phase 2 (parallel)

#### A2 — The v4l2loopback backend  *(session A)*

```
You are the Native agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-native (branch
feat/linux-native). Rebase onto feat/linux first. Read docs/linux-port/PLAN.md §1–§3 and step A2, and
packages/vcam-native/src (pipeline, ivcam.h, the stub linux_v4l2.cc, win_softcam.cc). Follow PLAN.md §2.
The user has loaded v4l2loopback with the C3 options (PLAN step 0.2); check with `v4l2-ctl --list-devices`.

Step A2: implement backend/linux_v4l2.cc.

1. Device lookup: /sys/class/video4linux/video*/name == "OmniCam" (trimmed), or OMNICAM_V4L2_DEVICE (C4).
2. probe() diagnoses in order and returns C1 codes with a precise sentence: no-module (no v4l2loopback.ko* under
   /lib/modules/$(uname -r), compressed variants included), not-loaded (/sys/module/v4l2loopback absent),
   no-device (loaded, no OmniCam label — say which labels exist, e.g. "OBS Virtual Camera"), permission.
3. start(): open the device (O_RDWR | O_NONBLOCK), VIDIOC_S_FMT on V4L2_BUF_TYPE_VIDEO_OUTPUT with YUYV (or I420
   when OMNICAM_V4L2_FORMAT=i420), field NONE, correct bytesperline/sizeimage and colorspace; VIDIOC_S_PARM with
   1/fps so consumers see the right rate. Map EBUSY → busy, EACCES → permission, rejected format → format, else io.
   A format change while a consumer holds the device usually fails with EBUSY: report busy with "close the apps
   using the camera to change the output size".
4. sendFrame(): write() a full frame; EAGAIN or a short write drops the frame (never block the worker).
5. consumers() per PLAN D3: look in the installed v4l2loopback header for a client-usage event
   (V4L2_EVENT_PRI_CLIENT_USAGE or similar) and use it if present (detect at build time, keep both paths);
   otherwise count other processes holding the device via /proc/*/fd, at most once a second, cached.
6. preferredFormat(): YUYV unless OMNICAM_V4L2_FORMAT=i420.
7. A self-test tool, Linux-only CMake option OMNICAM_BUILD_SELFTEST: tools/vcam_selftest.cc links pipeline +
   backend + libyuv without N-API, pushes a moving I420 test pattern at 30 fps at 1280x720 and 1920x1080 for N
   seconds, prints probe(), consumers changes and the pipeline's convert time.

Acceptance (on the host; put captures in your scratchpad, not the repo):
- vcam_selftest runs; `v4l2-ctl -d <dev> --all` shows the format and fps you set.
- `ffmpeg -f v4l2 -i <dev> -frames:v 30 -y <scratch>/grab-%02d.png` captures the moving pattern (look at two
  frames: different, not black, colours right). consumers goes 0 → 1 → 0 around the ffmpeg run.
- Unload-module cases: ask the user to run `sudo modprobe -r v4l2loopback`, check probe() says not-loaded; ask
  them to reload it with card_label=Other, check no-device names "Other"; then restore the C3 options.
- Report convert time per frame at 1080p for YUYV and I420, and whether ffplay/Firefox/Chrome list "OmniCam"
  (ask the user to check one browser camera picker).
- npm run native:build still works; typecheck/test pass; Windows CI green after merge.
```

#### B2 — The phone's microphone on Linux (PipeWire)  *(session B)*

```
You are the Desktop agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-desktop (branch
feat/linux-desktop). Rebase onto feat/linux first. Read docs/linux-port/PLAN.md §1–§3 and step B2, the
*Phone microphone* section of ARCHITECTURE.md, src/engine/mic.ts, src/shared/audio-sink.ts and its test,
src/renderer/components/{MicGuide,SettingsDialog}.tsx, src/renderer/useLoopbacks.ts, and src/platform/*.
Follow PLAN.md §2.

Step B2: the phone's microphone as "OmniCam Microphone" on Linux, with no root and no VB-CABLE (PLAN D5, C5).

1. platform/linux: a virtual mic service. While OmniCam runs: pactl load-module module-null-sink with
   sink_name=omnicam_feed and description "OmniCam Feed", then module-remap-source source_name=omnicam_mic
   master=omnicam_feed.monitor with description "OmniCam Microphone". Get pactl's property quoting right (test it
   on the host). Remove both on quit (module ids); at startup unload leftovers from a crash (find them by
   sink_name/source_name in `pactl list short modules`). Creating them must never change the user's default
   output or input: compare pactl get-default-sink / get-default-source before and after and restore if
   WirePlumber moved them. No pactl or no Pulse layer → state "unavailable" with the install command
   (Fedora: pulseaudio-utils; Debian/Ubuntu: pulseaudio-utils). Windows: no-op (VB-CABLE as today).
2. Status in AppState (shared/ipc.ts): virtual mic ready / unavailable / error with a reason.
3. shared/audio-sink.ts: recognise "OmniCam Feed" as a loopback output; micNameFor("OmniCam Feed") →
   "OmniCam Microphone". First check the exact label Chromium reports for the sink on Linux (log
   enumerateDevices from the engine once on the host) and test against that. Extend audio-sink.test.ts.
   VB-CABLE recognition stays as it is.
4. UI on Linux (state.platform): Settings → Microphone and MicGuide show no VB-CABLE install slides; the
   checklist becomes "OmniCam Microphone is ready" → "Pick OmniCam Microphone in Discord, Zoom…" → "Sound
   arrives" (the existing level). Keep the default-output warning (if the user picked "OmniCam Feed" as the
   speakers). Windows UI unchanged.
5. The engine should need no change (setSinkId into the feed). If it does, explain why in the report.

Acceptance (on the host):
- npm run dev: `pactl list short sinks` / `sources` show omnicam_feed / omnicam_mic; the defaults are unchanged;
  quitting removes them; killing the app with -9 and restarting leaves exactly one of each.
- With the phone on "Camera + microphone": `parecord -d omnicam_mic --file-format=wav <scratch>/mic.wav` for 5 s
  while the user speaks is not silent (ffmpeg -af volumedetect); `pactl list sink-inputs` shows OmniCam's stream
  only on omnicam_feed — never the speakers. Ask the user to do the phone part.
- npm run typecheck && npm test pass; al-dente check clean; Windows CI green after merge.
```

### Phase 3 (parallel)

#### A3 — Setup script, Linux packages, CI  *(session A)*

```
You are the Native agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-native (branch
feat/linux-native). Rebase onto feat/linux first. Read docs/linux-port/PLAN.md §1–§3 and step A3,
apps/desktop/electron-builder.yml, apps/desktop/package.json, package.json, .github/workflows/build.yml, and the
Releasing / Updates / Code signing conventions in ARCHITECTURE.md. Follow PLAN.md §2.

Step A3: the one-time camera setup, Linux packages, and a Linux CI job.

1. apps/desktop/build/linux/omnicam-camera-setup.sh exactly per PLAN C2 and C3 (bash, shellcheck-clean, set -eu):
   install = check a module exists for this kernel (10), refuse to clobber another `options v4l2loopback` file
   (15, name it), write the two config files, then make the OmniCam device exist now: if the module is loaded
   without an OmniCam device and v4l2loopback-ctl can add devices (check its --help: flags differ by version),
   add one with the C3 label/caps; otherwise modprobe -r (busy → 13) and modprobe; "Key was rejected" /
   "Required key not available" → 14; other failure → 11; finally verify the label appears. remove = delete the
   files and remove the device or unload when unused. Last stderr line is always one human sentence.
2. electron-builder.yml: linux targets AppImage, rpm, deb (x64), icon from resources/icons/icon.png, category
   AudioVideo, executableName omnicam, artifact names like OmniCam-${version}.${ext}; Linux-only extraResources
   build/linux/omnicam-camera-setup.sh → linux/. rpm and deb install scriptlets run the script's install (they
   are root already) and never fail the package install if it fails; removal runs remove. deb recommends
   v4l2loopback-dkms; rpm recommends akmod-v4l2loopback (RPM Fusion may be off: never a hard dependency).
   Verify every option name against electron-builder 26's schema, don't guess. Windows config untouched.
3. Scripts: apps/desktop `dist:linux` (electron-vite build && electron-builder --linux … --publish never), root
   `dist:linux` (builds the phone page first, like `dist`). Windows `dist` unchanged.
4. CI: a `linux` job on ubuntu-latest: checkout with submodules, setup-node 22, npm ci, typecheck, test,
   native:build, dist:linux (install `rpm` for the rpm target), upload the AppImage, rpm, deb and
   latest-linux.yml as an artifact. When the windows job publishes a release, the linux job (needs: windows,
   reading the windows job's version/release outputs) attaches its files to the same release without
   touching the notes, and attests their provenance. Add a short Linux paragraph to the release notes the
   windows job writes (AppImage: chmod +x; rpm/deb; v4l2loopback; link to the README Linux section). A PR or
   branch build publishes nothing, as today.

Acceptance:
- shellcheck passes; walk the script through install/remove with the user (they run it with sudo): device
  appears, survives `sudo modprobe -r v4l2loopback && sudo systemctl restart systemd-modules-load`, and a
  reboot (ask the user).
- npm run dist:linux on the host produces the three packages. The user installs the rpm
  (`sudo dnf install ./apps/desktop/release/OmniCam-*.rpm`): OmniCam is in the app grid and launches. The
  AppImage runs after chmod +x (if FUSE is missing: `sudo dnf install fuse-libs`, or --appimage-extract-and-run).
- The PR's CI shows both jobs green and the linux artifact downloadable. typecheck/test pass.
```

#### B3 — Camera setup and errors in the UI, updater, firewall  *(session B)*

```
You are the Desktop agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-desktop (branch
feat/linux-desktop). Rebase onto feat/linux first. Read docs/linux-port/PLAN.md §1–§3 and step B3,
src/renderer/components/{PairView,SettingsDialog,UpdateDialog}.tsx, src/main/{updater,engine-bridge,index}.ts,
src/engine/{engine,vcam}.ts, src/shared/ipc.ts, src/preload/*, src/platform/*. Follow PLAN.md §2.

Step B3: every camera problem on Linux shows a concrete fix in the UI, and the one-time setup is a button.

1. The engine's "native addon not available" reason gets the C1 code no-addon.
2. src/shared/vcam-error.ts (pure, tested): parse "<code>: <text>"; describe(code, platform, distro) → a short
   title, one line, the commands to run (copyable) and an optional action ("setup"). Distro from /etc/os-release
   ID/ID_LIKE, read by main and sent in AppState: fedora | debian (incl. ubuntu) | arch | other.
   - no-module: Fedora: enable RPM Fusion free + `sudo dnf install akmod-v4l2loopback`; Debian/Ubuntu:
     `sudo apt install v4l2loopback-dkms`; Arch: `sudo pacman -S v4l2loopback-dkms`; then the Set up button.
   - not-loaded, no-device: the "Set up camera" button (one password prompt).
   - setup result 14 (Secure Boot): the MOK steps for that distro (Fedora: kmodgenca + mokutil --import, reboot,
     Enroll MOK; Ubuntu: the DKMS enrolment prompt / `sudo update-secureboot-policy --enroll-key`).
   - permission: `sudo usermod -aG video $USER`, then log out and in.
   - busy / format / 13: close the apps using a camera (OBS's virtual camera feeds the same kind of device).
   - 15: the conflicting file named in the message.
   - not-registered (Windows): today's text, unchanged.
3. Camera setup: IPC channel (ipc.ts + preload + main handler) → platform camera setup per C2 (copy the script to
   $XDG_RUNTIME_DIR with mode 0700, `pkexec /bin/bash <copy> install`, map exit codes, 126/127 = cancelled
   quietly). Script path: packaged resources/linux/omnicam-camera-setup.sh, dev apps/desktop/build/linux/…
   (A3 writes it; until it is merged, test against a stub that exits with each code). On success re-apply the
   engine settings so the camera starts without restarting OmniCam.
4. PairView banner and Settings → Camera use describe(): the title, one line, commands with a copy button, the
   Set up button with its progress and result. ARCHITECTURE.md Brand & UI rules; no wall of text.
5. Updater on Linux: supported only when process.env.APPIMAGE is set; rpm/deb installs show "unsupported" with
   "Installed from a package: get new versions from GitHub Releases." Check UpdateDialog's wording per platform.
6. Connection section ⓘ on Linux: if the phone can't open the page, Fedora firewalld:
   `sudo firewall-cmd --permanent --add-port=<port>/tcp && sudo firewall-cmd --reload` (Fedora Workstation
   allows 1025–65535 already, so only other zones need it); Ubuntu with ufw on: `sudo ufw allow <port>/tcp`.
   Use the configured port.

Acceptance (on the host):
- vcam-error tests cover every code × distro; typecheck/test pass; al-dente clean.
- npm run dev with the module unloaded (ask the user to `sudo modprobe -r v4l2loopback`): the banner says
  not-loaded and offers Set up; clicking it shows the polkit prompt; afterwards the camera starts and
  `v4l2-ctl --list-devices` lists OmniCam — without restarting the app.
- Cancelling the polkit prompt shows nothing alarming. Windows UI unchanged; Windows CI green after merge.
```

### Phase 4 — integration

#### I1 — End to end on Fedora without a phone  *(session A, in the main checkout)*

```
You are the integration agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam on branch
feat/linux (git pull first; both feat/linux-native and feat/linux-desktop should be merged — check). Read
docs/linux-port/PLAN.md fully and the ROADMAP note on the fake-device smoke test. Follow PLAN.md §2.

Step I1: prove the whole path on this Fedora machine, without a phone, then with packages.

1. npm install, git submodule update --init --recursive, npm run native:build, npm run dev. Camera set up via the
   app's button if needed (the user approves the prompt).
2. A fake phone: apps/desktop/test/e2e/fake-phone.cjs — a tiny Electron main that opens the phone URL with
   &auto=1 using --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --ignore-certificate-errors
   (Chromium's fake camera and beeping fake microphone). The dev build logs the phone URL with its token. Add a
   one-line usage comment; it is a dev tool, never packaged.
3. Check and record each, with evidence:
   - the UI goes Live; stats show fps and codec;
   - ffmpeg grabs frames from the OmniCam device showing Chromium's fake pattern (save to your scratchpad and look);
   - consumers 0 → 1 → 0 around the grab; the phone drops to idle 5 fps after 5 s with no reader and the
     window hidden, and comes back when a reader opens;
   - microphone: parecord from omnicam_mic is not silent (fake beeps); nothing on the speakers;
   - output size change 720p ↔ 1080p with and without a reader attached (busy message when a reader holds it);
   - quit: device stays, virtual mic removed, no stray processes.
4. Numbers for the "lightweight" decision (PLAN D10): CPU (% of one core) and total RSS of all OmniCam processes
   while streaming 1080p30 into ffmpeg, idle with no phone, and idle with a phone but no reader. Use ps/top over
   30 s, not one sample.
5. Packages: npm run dist:linux; the user installs the rpm; repeat the Live + ffmpeg + mic checks against the
   installed app; then the AppImage (and its in-app update state).
6. Write a "Results" section at the end of docs/linux-port/PLAN.md: a pass/fail table with the evidence, the
   numbers, and every bug found. Fix bugs only if they are small and inside one part; otherwise list them for
   the owning agent. Commit, push.
```

### Phase 5 — you, with the phone

1. Launch OmniCam from the app grid (installed rpm). No AppIndicator first, then with
   `sudo dnf install gnome-shell-extension-appindicator` (log out/in, enable it in *Extensions*): tray appears.
2. Scan the QR with the phone, accept the warning, *Start camera* → Live.
3. Pick **OmniCam** in Firefox (any video-call test page), Chrome/Chromium, OBS (*Video Capture Device (V4L2)*),
   Discord and Zoom. Flatpak'd Discord/Zoom need camera access (Flatseal → *All devices*).
4. Front/back, 720p · 720p60 · 1080p · 4K, torch, mirror, rotate, Fill/Fit, QR while live, Disconnect.
5. *Camera + microphone*: in Discord choose **OmniCam Microphone**, speak; nothing comes out of the speakers.
   *Microphone only* too.
6. Close the window (camera stays live), lock and unlock the phone, Wi-Fi off/on, quit from the tray.
7. Settings → *Launch at login* on, reboot: OmniCam starts hidden, the camera device exists after boot.

Anything wrong → the fix prompt below, in the session that owns the part (table at the top).

#### F — Fix prompt (reuse as often as needed)

```
Read docs/linux-port/PLAN.md §1–§3 and its Results section, and follow §2. Rebase onto feat/linux first.
On Fedora this went wrong: <what you did, what you expected, what happened; phone model and browser;
consumer app>. Logs: ~/.config/OmniCam/logs/omnicam.log (last run). Find the cause before changing anything,
reproduce it on the host if you can (fake phone: apps/desktop/test/e2e/fake-phone.cjs), fix it in the part
that owns it, add a test where the logic is testable, then merge and push per §2 and add a line to Results.
```

### Phase 6 — docs and the PR

#### D1 — Documentation, changelog, ready for review  *(session B)*

```
You are the Desktop agent for OmniCam's Linux port. Work in ~/Desktop/Projects/OmniCam-desktop (branch
feat/linux-desktop), rebased onto feat/linux. Read docs/linux-port/PLAN.md fully (especially Results),
README.md, ARCHITECTURE.md, ROADMAP.md, CONTRIBUTING.md, CHANGELOG.md, PRIVACY.md. Follow PLAN.md §2 (you may
edit all of these docs in this step).

Step D1: document Linux as a supported platform, in the existing voice of each file.

- README: badges and "What it doesn't do" updated; an "Install (Linux)" section — AppImage / rpm / deb,
  v4l2loopback per distro, Secure Boot (MOK, free, no BIOS change), the Set up camera button, OmniCam
  Microphone (no VB-CABLE), GNOME tray extension, Flatpak'd apps needing device access, firewall note,
  Ubuntu 24.04 AppImage sandbox note if Results found it. Windows text unchanged.
- ARCHITECTURE: Linux in "What this is", new rows in the constraints table, the platform part and the Linux
  backend in the diagram and repository layout, Linux build prerequisites, Linux performance numbers from
  Results, the al-dente rule now mentioning `platform`, the roadmap list.
- ROADMAP: item 2 done, item 3 done or what remains (from Results); keep the format.
- CONTRIBUTING: Linux setup (Fedora/Ubuntu packages, module, native build, fake phone).
- CHANGELOG: an Unreleased section written for users (what's new on Linux), no `---` rules (the app stops there).
- Move anything worth keeping from PLAN.md into ARCHITECTURE.md, then delete docs/linux-port/.
- Do not bump the version. Merge and push per §2, then `gh pr ready` on the feat/linux PR and post a summary
  comment (what works, how it was tested, what's left). Tell the user: bumping apps/desktop/package.json to
  2.1.0, renaming Unreleased to 2.1.0 and merging the PR publishes the release with Windows and Linux builds.
```

---

## Results

*(I1 fills this in.)*
