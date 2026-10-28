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
| *anyone* | needs only a Windows or Linux machine and a phone |
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

## Done

Shipped items from earlier versions of this list, kept so the rest reads against what exists.

### Linux: v4l2loopback — 2.1.0

`backend/linux_v4l2.cc` writes YUYV to a v4l2loopback device labelled *OmniCam*, found by its label; a
one-time setup (one polkit prompt, or the rpm/deb install) makes it survive restarts; every camera problem shows its
fix in the UI, Secure Boot included. The phone's microphone needs no driver there: OmniCam adds *OmniCam Microphone*
to PipeWire while it runs. Packages are an AppImage (updates itself), an rpm and a deb, built and attached to each
release by CI. The tray falls back to a minimised window where GNOME has no tray.

Tested end to end on Fedora 44 (GNOME, Wayland), with Chromium (Chrome's engine) and ffmpeg reading the camera.
What remains is the matrix nobody has run yet: Ubuntu and Debian, KDE, X11, and more consumer apps (Firefox, OBS,
Zoom, Discord, Flatpak'd apps). Reports welcome,
*hardware*. A sandboxed Flatpak of OmniCam itself is not possible: it has to set up a kernel module.

### The phone as a microphone — 2.0.0

*Camera*, *Camera + microphone* or *Microphone only*, switchable from either side without reconnecting. On Windows the
sound goes into VB-CABLE, which the user installs once with a guide in *Settings → Microphone*; on Linux it is
*OmniCam Microphone*, above. A Windows microphone device of OmniCam's own is still open (item 5).

### A backend chooses its pixel format

`IVirtualCamera::preferredFormat()` lets each backend take frames in its own format. Windows keeps BGR24 for
DirectShow; the Linux backend takes YUYV (I420 for testing), straight from the phone's YUV with no RGB round trip.

### Tests — mostly

`npm test` runs Node's built-in test runner on every build, on Windows and on Linux, with no extra toolchain. It
covers the pairing guard (token check, per-device budget, which files the phone page may serve), the SDP answer
munging, frame-rate matching, the camera error codes, picking the microphone output, the Linux platform helpers and
the release notes. `apps/desktop/test/e2e/fake-phone.cjs` streams a fake camera and microphone into a running
OmniCam, so the whole path can be exercised without a phone. What is left is item 1 below.

---

## Next, in the order I would do them

### 1 · Finish the tests — S, *anyone*

Three easy ones have no tests yet:

- `main/network.ts`: which of the PC's addresses goes into the QR code
- `main/updater.ts`: `describe()`, which turns update errors into one plain sentence
- `packages/protocol` and `shared/ipc.ts`: the phone ↔ PC messages and the default settings

Then the bigger one: run the fake phone in CI and check that video reaches the OmniCam camera. That catches
what small tests can't, but the CI machine needs the virtual camera installed first.

### 2 · Windows 11 Media Foundation backend — M to L, *C++*

DirectShow is invisible to the Windows Camera app and the new Microsoft Teams, which is the most common
"why doesn't it show up" report. A Media Foundation virtual camera (`MFCreateVirtualCamera`, Windows 11
build 22000+) would cover them — alongside the DirectShow filter rather than replacing it, since
Windows 10 has no such API and is still supported here.

### 3 · Phone battery levers — S to M, *anyone*

The honest version of "why does my phone get warm" is in the README. These would genuinely help:

- adaptive capture: drop resolution before framerate when the phone reports thermal pressure
- a lower default than 1080p on small-battery phones, or a plain "battery saver" toggle on the page
- 15 fps rather than full rate when the desktop has a preview open but no app is reading the camera
- release the wake lock while the stream is idle and the page has not been touched

### 4 · macOS: CoreMediaIO camera extension — L, *C++ and hardware*

Harder than Linux was, despite the nicer API: a camera extension needs a paid Apple Developer account,
signing, notarization, and the user approving a system extension.

### 5 · An "OmniCam" microphone device on Windows — L, *C++ and costs money*

The phone already works as a microphone: the engine plays its audio into a virtual cable the user
installs (VB-CABLE), and apps pick the cable's other end. Chromium's WebRTC receiver handles jitter, clock
drift and resampling, so that part needed no native code ([ARCHITECTURE.md](ARCHITECTURE.md#phone-microphone)).

What is left is a device of OmniCam's own, so nobody has to install VB-CABLE: a loopback audio driver
(render side for the engine, capture side "OmniCam Microphone" for apps), for instance based on
Microsoft's SysVAD sample. The engine would not change; `shared/audio-sink.ts` would just recognise it.
The code is the smaller part. Windows only loads kernel drivers that Microsoft has signed, which takes
attestation signing through a Partner Center account with an EV certificate (paid, yearly; SignPath's free
signing does not cover drivers), and a driver bug blue-screens the user's PC, so development needs a
test-signing VM. On Linux this is done and needs no driver at all: a PipeWire null sink plus a remapped source,
created at runtime without root. macOS would need a HAL plug-in, BlackHole-style.

### 6 · "No-warning mode" — L, *needs a service*

A real certificate for a per-install hostname that resolves to a LAN address, Plex-style. It removes the
one rough edge in the whole product. It also means a domain, a small signing service, renewals, and an
internet dependency for something that otherwise works entirely offline — so it has to be opt-in, and
the local path has to keep working untouched.

### 7 · Code signing — S, *costs money*

In progress, and free: SignPath Foundation signs open-source releases from a verified GitHub Actions build,
and CI already has the steps, switched off until the project is accepted ([CODE_SIGNING.md](CODE_SIGNING.md)).
No release is signed yet.
Signing shows a verified publisher at once; the SmartScreen prompt fades as the certificate gathers
reputation. Left after that: signing the uninstaller, and `publisherName` so updates must be signed.

### 8 · PipeWire camera node on Linux — M, *hardware*

The nicer Linux path, with no kernel module at all. Consumer support is still patchy — Chrome and Firefox
reliably enumerate v4l2 devices, while the PipeWire camera portal is improving but not universal. v4l2loopback
works now, so this would be a second `IVirtualCamera` backend next to it, not a replacement.

---

## Good first issues

Small, verified, and each one has a known home in the code.

- **The Windows camera advertises 60 fps at 30.** Since 1.3.0 the pipeline paces the camera at the phone's
  real rate (60 for 720p60, 30 otherwise), but `backend/win_softcam.cc` still passes framerate `0.0` to
  softcam ("send immediately" — the pipeline owns the clock), so the filter falls back to its default of 60
  and apps report 60 fps for a camera running at 30. *(S to M, C++.)*
- **`consumers()` is a yes/no, not a count** (`IsConnected() ? 1 : 0` on Windows; on Linux too, whenever
  v4l2loopback reports usage events), yet the UI pluralizes "in use by N apps". Either count properly or
  stop implying a count. *(S.)*
- **A phone that can't turn its camera or microphone on only tells the log.** When the desktop switches on
  a source the phone was never given permission for, the phone sends an `error` message, and
  `apps/desktop/src/main/index.ts` only writes it to the log; the button just doesn't change. It belongs
  in the window, with what to do on the phone. *(S, anyone.)*
- **No retry after a failed virtual-camera start on Windows.** If `vcam.start()` throws — a stale OmniCam
  process still holding the shared memory, say — it is tried again only when a setting changes. Linux retries a
  busy device every 3 s; Windows would want the same for its `busy:` case, or a *Try again* button like Linux's.
  `apps/desktop/src/engine/engine.ts`, in `applySettings`. *(S.)*
- **Documentation and translation.** The phone page is the only part of OmniCam a phone user ever sees,
  and it is English-only. The strings are few and live in one file.

## Not planned

- **USB.** A phone hotspot, or USB tethering with the PC joined to that network, already covers it.
- **Recording, filters, effects, backgrounds.** OBS does all of this, downstream of OmniCam.
- **Several phones at once** — see "Already decided".
