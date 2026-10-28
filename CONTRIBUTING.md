# Contributing to OmniCam

Thanks for wanting to help. Bug reports, fixes, and testing on phones and apps nobody has tried
yet are all welcome.

## Reporting bugs

[Open an issue](https://github.com/Orest-Z/OmniCam/issues) and include:

- the OmniCam version (shown in Settings) and your Windows version, or your Linux distribution and desktop
- the phone model and browser (for example iPhone 14, Safari, or Pixel 7, Chrome)
- the app you are using the camera in (Discord, Zoom, OBS…)
- what you did, what you expected and what happened instead
- the log file: Settings → About → **Open log folder** → `omnicam.log`

Found a security problem? Please don't open an issue; follow [SECURITY.md](SECURITY.md) instead.

## Before you start on something bigger

For a new feature or an architectural change, open an issue first so we can agree on the approach
before you spend time on it.

Some things are fixed by product constraints. [ARCHITECTURE.md](ARCHITECTURE.md) explains each one;
the short version:

- **Nothing to install on the phone.** The phone side stays a plain web page.
- **No WebSockets for signaling.** iOS Safari ignores the certificate exception for `wss://`, so
  signaling is a single `fetch` POST and control messages ride the WebRTC DataChannel.
- **Video frames never cross Electron IPC.** The engine window loads the native addon in-process.
- **npm workspaces only**, no pnpm or yarn, to keep prerequisites minimal.
- **The phone page has no dependencies and no framework**, so it loads instantly.

## Setting up

The full app builds on Windows 10 or 11 (64-bit) and on Linux x64 ([below](#on-linux)). On Windows you need:

- Node.js 20 or newer
- Visual Studio 2022 Build Tools with the **Desktop development with C++** workload
- CMake 3.20 or newer (`pip install cmake` works)

```
git clone --recursive https://github.com/Orest-Z/OmniCam.git
cd OmniCam
npm install
npm run native:build      # N-API addon + DirectShow filter DLLs (x64, x86)
npm run native:register   # once, as administrator: registers the "OmniCam" camera
npm run dev               # builds the phone page, starts Electron with hot reload
```

Already cloned without `--recursive`? Run `git submodule update --init --recursive`.

You can skip the native steps if you are working on the UI or the phone page. The app still runs
(QR code, phone connection, preview) and reports "native addon not available".

### On Linux

Fedora:

```
sudo dnf install nodejs npm gcc-c++ make cmake git v4l-utils pulseaudio-utils
```

Debian or Ubuntu: `sudo apt install nodejs npm g++ make cmake git v4l-utils pulseaudio-utils` (Node 20 or newer;
use NodeSource if your release ships an older one).

Then the same steps as above, without `native:register`. The camera needs the v4l2loopback module (see
[Install (Linux)](README.md#install-linux), including Secure Boot); once it is installed, the app's **Set up camera**
button runs `apps/desktop/build/linux/omnicam-camera-setup.sh` for you. `v4l2-ctl --list-devices` should then list
*OmniCam*.

```
npm run native:build      # N-API addon with the v4l2loopback backend
npm run dev
npm run dist:linux        # AppImage, rpm and deb in apps/desktop/release
```

Building the rpm and deb on Fedora also needs `sudo dnf install rpm-build libxcrypt-compat` (electron-builder's
bundled fpm needs `libcrypt.so.1`). `shellcheck apps/desktop/build/linux/omnicam-camera-setup.sh` runs in CI.

**No phone at hand?** `npx electron apps/desktop/test/e2e/fake-phone.cjs '<phone URL>' both` opens the phone page in
Chromium with its fake camera (a moving pattern) and fake microphone (beeps) and starts streaming. `npm run dev`
logs the phone URL with its token. Then `ffmpeg -f v4l2 -i /dev/video63 -frames:v 30 grab-%02d.png` grabs frames
from the camera, and `parecord -d omnicam_mic --file-format=wav mic.wav` records the microphone.

## Where things live

| Path | What it is |
|---|---|
| `apps/desktop/src/main/` | Electron main process: HTTPS server, pairing token, certificate, tray, settings |
| `apps/desktop/src/platform/` | Per-OS services for main: autostart, tray support, camera setup, the Linux microphone |
| `apps/desktop/src/engine/` | Hidden window that receives the WebRTC stream and feeds the native addon |
| `apps/desktop/src/renderer/` | The React UI (sandboxed; talks to main through the preload bridge) |
| `apps/phone/` | The page the phone opens: camera capture and WebRTC sender |
| `packages/protocol/` | Message types the phone and desktop exchange |
| `packages/vcam-native/` | C++ addon, frame pipeline (libyuv), the DirectShow camera filter and the v4l2loopback backend |

The layout and the reasoning behind it are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Conventions

- **TypeScript strict** everywhere. Shared message shapes live in `packages/protocol` or
  `apps/desktop/src/shared/ipc.ts`; never define the same shape twice.
- **IPC has fixed paths.** Main ↔ engine goes through `engine-bridge.ts` only; UI ↔ main goes
  through the preload bridge only.
- **The phone page must work on iOS Safari 15+ and Android Chrome.** Wrap any browser API that may
  be missing (wake lock, torch, codec preferences…).
- **Don't edit `third_party/`.** Adapt the submodules at build time
  (`packages/vcam-native/cmake/patch_softcam.cmake`) or wrap them.
- **Errors a user can act on** (driver not registered, port busy, firewall) must show in the UI
  with a concrete instruction, not only in the log.
- **Performance decisions were measured.** Read the performance notes in
  [ARCHITECTURE.md](ARCHITECTURE.md) and re-measure before changing them, especially anything that
  draws frames in a renderer.
- **Icons and brand:** icons come from `lucide-react`; every app and tray icon size is generated by
  `node apps/desktop/build/icons.mjs`, so don't hand-edit the bitmaps.
- Formatting follows `.editorconfig`: 2-space indent, LF line endings, UTF-8.

## Testing your change

`npm test` runs the unit tests in `apps/desktop/test` on Node's built-in runner (pure modules only: no Electron, no
hardware). Add one when you change logic that can be tested that way. Beyond that:

- `npm run typecheck` and `npm test` must pass.
- If your change touches streaming, test with at least one phone (iPhone Safari or Android Chrome)
  and at least one app that uses the camera (OBS, Discord, or a browser camera test page).
- For UI changes, add a screenshot to the pull request.
- For native changes, close any app using the OmniCam camera before `npm run native:build`; the
  build script warns when the filter DLL is locked.

Say in the pull request what you tested and on which devices.

## Pull requests

- Branch from `main` and keep each pull request to one topic.
- Write commit messages as a short imperative summary, with an area prefix when it helps:
  `Engine: …`, `Phone: …`, `Native: …`, `README: …`.
- Add user-visible changes to `CHANGELOG.md` under **Unreleased** (add that heading if the last
  release took it). Those entries become the release notes once the version is bumped.
- CI must pass. It typechecks, runs the tests and builds the native parts and the packages on Windows and Linux.
  A change to Windows behaviour can only be checked there, so say in the pull request if you couldn't test it.
- Looking for something to pick up? [ROADMAP.md](ROADMAP.md) lists good first issues with the file they
  live in, and says which larger items need a Linux box, a Mac or C++.

By submitting a pull request you agree that your contribution is licensed under the
[MIT License](LICENSE), like the rest of the project.
