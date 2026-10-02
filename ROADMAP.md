# Roadmap

What OmniCam might become, what it deliberately will not, and where help would land best.

**Maintenance stance, so nobody has to guess:** OmniCam is a side project. It does what its author needs
it to do today. I will keep building on it while people find it useful; if it stays quiet, it stays as
it is — working, documented, and small enough for someone else to pick up. Issues and pull requests get
read either way. Nothing here is a commitment to a date.

Each item carries a rough size and who can realistically take it:

| | |
|---|---|
| **S** | a day or two |
| **M** | a week or two |
| **L** | a month or more |
| *anyone* | needs only a Windows machine and a phone |
| *C++* | touches `packages/vcam-native` |
| *hardware* | needs a Linux box, a Mac, or a paid developer account |

---

## Already decided

Please don't open a pull request for these without talking first — the reasoning is load-bearing and
written down so it can be argued with, not so it can be re-litigated from scratch.

**No app on the phone.** The whole product is "nothing to install". A native phone app would remove the
certificate warning and save battery, and it would also make OmniCam one more thing in the list of apps
that need installing on both ends. If you want that, DroidCam and Iriun already do it well.

**No swapping Electron for Tauri (or anything else).** Measured on the 1.1.0 build: Electron costs a
107 MiB installer and about 505 MB of working set (308 MB private) across five processes while idle.
Tauri would plausibly make that ~10–15 MB and ~100 MB. Everything else argues the other way:

- It would not change the phone's battery at all — the phone runs a browser page and cannot see what the
  desktop is written in. The only levers are what the desktop *asks* for, which already exist over the
  DataChannel (`setIdle`, resolution presets, `maxBitrate`).
- It would not meaningfully change CPU while streaming. The frame path is already native C++ and costs
  about a quarter of a core at 1080p; the decode and the colour conversion would be identical.
- Electron here is not a UI framework, it is **a production WebRTC receiver and H.264 decoder**. The
  engine window runs `RTCPeerConnection` → `MediaStreamTrackProcessor` → `VideoFrame.copyTo`. Tauri uses
  the OS webview: WebView2 has that pipeline, **WebKitGTK and WKWebView do not**. So the port is either
  Windows-only (defeating the point) or it means owning H.264 depacketization, a decoder, a jitter buffer
  and NACK/keyframe recovery in Rust — the exact surface Chromium has already solved and that this
  project actively exploits (`jitterBufferTarget = 0`; High profile only on Safari, because Chrome's
  software encoder stalls when it is selected).

**No cloud, no relay, no account.** Video goes phone → PC on the local network or it does not go. No
TURN server, no signalling service, no telemetry. "No-warning mode" below is the one exception under
discussion, and it is opt-in by design.

**One phone at a time.** Scanning a new code replaces the current phone. Several simultaneous phones
would mean several camera devices, a device-naming scheme, and a UI for all of it.

---

## Next, in the order I would do them

### 1 · A test suite — S to M, *anyone*

The biggest structural gap: there are no automated tests, and CI only typechecks and builds. That is
fine for one person who tests by hand and bad for anyone else trying to land a change with confidence.
The valuable first targets are all pure functions — no Electron, no hardware:

- `apps/desktop/src/main/network.ts` — `lanAddresses` scoring and `pickAddress`
- `apps/desktop/src/main/session.ts` — token validation, including the non-ASCII case below
- `apps/desktop/src/main/server.ts` — `sessionAllowed` budget, window expiry, eviction
- `apps/desktop/src/main/updater.ts` — the `describe()` error mapping
- `apps/desktop/src/engine/sdp.ts` — the answer munging
- `packages/protocol` — settings defaults and message shapes

Vitest fits the repo (TypeScript, ESM, no new toolchain). A `test` job in
`.github/workflows/build.yml` next to `typecheck` finishes it.

Worth knowing: the end-to-end path *is* testable without a phone. Chrome with
`--use-fake-device-for-media-stream` pointed at `https://127.0.0.1:PORT/?t=TOKEN&auto=1` (the page's
`auto=1` hook exists for exactly this) connects, streams, and lands frames in the virtual camera. A
second browser can open the OmniCam device and confirm the pixels arrive. That is a genuine smoke test
for a self-hosted Windows runner, or a documented manual script until then.

### 2 · Let a backend choose its pixel format — S, *C++*

`IVirtualCamera` (`packages/vcam-native/src/backend/ivcam.h`) declares that frames are BGR24, because
that is what DirectShow wants, and `pipeline.cc` converts with `I420ToRGB24Matrix` to produce it. v4l2
consumers want YUV420 or YUYV, so a Linux backend would otherwise pay I420 → BGR24 → YUV420: roughly
3 ms a frame of pointless work at 1080p. Adding a `preferredFormat()` to the interface and honouring it
in the pipeline is small and self-contained, and it unblocks Linux cleanly. **Worth doing before anyone
writes the Linux backend.**

### 3 · Linux: v4l2loopback — L, *C++ and hardware*

The seam is ready and `ivcam.h` already names this backend. The code is the easy part:

- `backend/linux_v4l2.cc` — open `/dev/videoN`, `VIDIOC_S_FMT`, write frames (M)
- `CMakeLists.txt` is unconditionally Windows today (`add_compile_definitions(WIN32 _WINDOWS …)`, the
  DirectShow filter, the x86 build). It needs per-OS branches and a Linux CI job (S)
- Tray on GNOME has no StatusNotifier by default, so "the window is optional, it lives in the tray"
  needs a fallback. Autostart needs an XDG `.desktop` file — `setLoginItemSettings` does not cover
  Linux. electron-updater supports AppImage only, so in-app updates would be AppImage-only (M)

What costs the time is the install story, not the code. v4l2loopback is an out-of-tree DKMS module: root
to install, kernel headers, **re-signing under Secure Boot or it will not load**, and persistent options
(`exclusive_caps=1`, `card_label=OmniCam`) through `modules-load.d` and `modprobe.d`. A `.deb` can depend
on `v4l2loopback-dkms`; an AppImage cannot install anything. Then the matrix: Ubuntu and Fedora, X11 and
Wayland, GNOME and KDE, against Chrome, Firefox, OBS, Zoom and Discord — and Flatpak'd consumers need
`/dev/video*` granted.

Realistically: a week or two for "works on my Ubuntu", four to six focused weeks for something
shippable. The code is maybe 40% of that.

### 4 · Windows 11 Media Foundation backend — M to L, *C++*

DirectShow is invisible to the Windows Camera app and the new Microsoft Teams, which is the most common
"why doesn't it show up" report. A Media Foundation virtual camera (`MFCreateVirtualCamera`, Windows 11
build 22000+) would cover them — alongside the DirectShow filter rather than replacing it, since
Windows 10 has no such API and is still supported here.

### 5 · Phone battery levers — S to M, *anyone*

The honest version of "why does my phone get warm" is in the README. These would genuinely help:

- adaptive capture: drop resolution before framerate when the phone reports thermal pressure
- a lower default than 1080p on small-battery phones, or a plain "battery saver" toggle on the page
- 15 fps rather than full rate when the desktop has a preview open but no app is reading the camera
- release the wake lock while the stream is idle and the page has not been touched

### 6 · macOS: CoreMediaIO camera extension — L, *C++ and hardware*

Harder than Linux despite the nicer API: a camera extension needs a paid Apple Developer account,
signing, notarization, and the user approving a system extension. Linux first.

### 7 · Virtual microphone — L, *C++*

Often the first thing people ask for. It is a second device, a second pipeline (WebRTC audio, resampling,
drift between the phone's clock and the audio device's) and a second driver per OS. Genuinely a
project-sized chunk of work rather than a feature.

### 8 · "No-warning mode" — L, *needs a service*

A real certificate for a per-install hostname that resolves to a LAN address, Plex-style. It removes the
one rough edge in the whole product. It also means a domain, a small signing service, renewals, and an
internet dependency for something that otherwise works entirely offline — so it has to be opt-in, and
the local path has to keep working untouched.

### 9 · Code signing — S, *costs money*

In progress, and free: SignPath Foundation signs open-source releases from a verified GitHub Actions build,
and CI already has the steps, switched off until the project is accepted ([CODE_SIGNING.md](CODE_SIGNING.md)).
Signing shows a verified publisher at once; the SmartScreen prompt fades as the certificate gathers
reputation. Left after that: signing the uninstaller, and `publisherName` so updates must be signed.

### 10 · PipeWire camera node on Linux — M, *hardware*

The nicer Linux path, with no kernel module at all. Consumer support is still patchy — Chrome and Firefox
reliably enumerate v4l2 devices, while the PipeWire camera portal is improving but not universal. Worth
revisiting once v4l2loopback works.

---

## Good first issues

Small, verified, and each one has a known home in the code.

- **The camera advertises the wrong frame rate.** `backend/win_softcam.cc` passes framerate `0.0` to
  softcam ("send immediately" — the pipeline owns the clock), so the filter advertises its default and
  Chrome reports 60 fps for a device paced at 30. The output fps setting looks ignored in any app that
  displays it. *(S to M, C++.)*
- **`consumers()` can only ever be 0 or 1** (`IsConnected() ? 1 : 0`), yet the UI pluralizes "N apps are
  using it". Either count properly or stop implying a count. *(S.)*
- **The phone's status pill contradicts its own overlay** after Disconnect: the overlay says the code
  expired while the pill still says "Reconnecting…", because `stopSession()` never calls `setStatus`.
  `apps/phone/src/main.ts`. *(S, anyone.)*
- **No retry after a failed virtual-camera start.** If `vcam.start()` throws — a stale OmniCam process
  still holding the shared memory, say — nothing retries until the output format changes, so restarting
  the app is the only way out. `apps/desktop/src/engine/engine.ts`, in `applySettings`. *(S.)*
- **Documentation and translation.** The phone page is the only part of OmniCam a phone user ever sees,
  and it is English-only. The strings are few and live in one file.

## Not planned

- **USB.** A phone hotspot, or USB tethering with the PC joined to that network, already covers it.
- **Recording, filters, effects, backgrounds.** OBS does all of this, downstream of OmniCam.
- **Several phones at once** — see "Already decided".
