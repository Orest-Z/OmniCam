# Changelog

## 1.3.0 — 2026-10-04

A bigger update: real 60 fps, a light theme, 4K output and a front-camera light, plus fixes for the
torch, Disconnect and closing the window.

### New
- **720p at 60 fps that really is 60.** The 1080p60 button never worked on iPhone: every iPhone browser
  runs on Safari's engine, which accepts a 60 fps request at 1080p and then keeps the camera at 30. It
  only reaches 60 fps at 720p, so **720p60** replaces 1080p60 on the desktop and on the phone. The phone
  now checks the rate its camera actually runs at instead of trusting what the browser accepted.
- **Apps get the 60 fps too.** The OmniCam camera's frame rate now follows what the phone really
  sends: 60 for 720p60, 30 otherwise, whichever side changed the resolution. Before, the camera stayed
  at 30 and Discord or Zoom got half the frames.
- **1080p at 60 fps, beta, Android only** — *Settings → Phone camera → Try 1080p60*. Some Android phones
  reach it in the browser; others drop to a smaller size at 60. Tell us how yours does.
- **Light theme.** *Settings → Appearance*: Dark (still the default), Light or System, which follows
  Windows. The sun/moon button next to Settings switches it in one click.
- **A light for the front camera.** Front cameras have no flashlight, so the torch button now turns the
  phone screen white to light your face. Turn the phone's brightness up for more light: a web page can't.
- **4K output** for OBS and recording, next to 720p and 1080p. Discord, Zoom and Teams send at most
  1080p, so it stays a manual choice.
- **The stream numbers stay on screen.** The preview in the window is a reduced 10 fps snapshot to save
  CPU, so it looks laggier than what apps get; the resolution / fps / bitrate overlay is the real picture
  and no longer hides until you hover. *Settings → Stream details* switches back to hover-only.
- The phone shows the resolution and frame rate it is really sending.

### Fixes
- **The torch can be turned off from the PC.** The button only ever switched it on; it now shows the
  torch's state and toggles it, whichever side switched it on.
- **Disconnect goes straight back to a new QR code.** It used to land on *Reconnecting* and stay there.
- **The phone knows it was disconnected.** It used to keep filming until its connection timed out; now
  it stops the camera and explains that Disconnect was pressed and to scan the new QR code.
- **Closing the window quits OmniCam when *Keep running in the tray* is off.** It kept running in the
  tray either way.
- A frozen phone stream is noticed after 1 second instead of 3.

### Under the hood
- Tests for the frame-rate matching and for how the desktop reads the phone's resolution (including a
  phone held upright).
- An unknown theme value in `settings.json` falls back to dark instead of stopping OmniCam from starting.
- Developer CPU logging works again on Electron 44.

## 1.2.0 — 2026-10-02

### Fixes
- **Moving between networks no longer asks every phone to accept the warning again.** The certificate
  is only re-issued when a network address turns up that it does not already cover, and it keeps the
  addresses it had, so a VPN going up and down or a different Wi-Fi leaves phones' exceptions intact.
- **A busy port is no longer changed silently.** When the port in Settings is taken, OmniCam says which
  port it is using instead, next to the setting and once in the window. Pairing always worked (the QR
  code carries the real port), but nothing admitted the setting was being ignored.
- **A phone stuck on *Reconnecting…* now leaves a trace.** Refused pairing attempts are written to the
  log and tell the phone how long to wait, and the per-device budget is high enough for a phone that
  keeps losing Wi-Fi and for several phones sharing one router address.
- A pairing request with a token of the right length but non-ASCII characters got a server error; it
  is now refused like any other wrong token.

### Privacy and trust
- **Settings → Check for updates automatically** can be turned off. The update check is the only
  connection OmniCam makes beyond your network; *Check for updates* still works when you click it.
- The installer's first page says what it changes on the system (the camera device and a firewall
  rule) before Windows asks for administrator rights.
- Each release lists the installer's SHA-256 and carries a signed build provenance attestation, so
  anyone can check it was built by this repository's GitHub Actions from the tagged commit.
- [PRIVACY.md](https://github.com/Orest-Z/OmniCam/blob/main/PRIVACY.md) lists every connection the app makes; [CODE_SIGNING.md](https://github.com/Orest-Z/OmniCam/blob/main/CODE_SIGNING.md)
  describes the code signing being set up through SignPath Foundation. This release is not signed yet.

### Under the hood
- Electron 44.5.0 (from 44.3.0).
- The phone page server only serves regular files inside its own folder, checked on a path boundary.
- The native files carry product name and version information.
- First automated tests, run on every build; CodeQL code scanning and Dependabot updates.
- A project website: https://orest-z.github.io/OmniCam/

## 1.1.0 — 2026-10-01

- **Check for updates** in Settings, plus a quiet check at launch and once a day. An *Update available*
  badge in the title bar opens a prompt that downloads the new version, verifies it and restarts
  OmniCam into it. Nothing is downloaded or installed without a click. A found update stays on
  offer even if a later check fails.
- Log file at `%APPDATA%\OmniCam\logs\omnicam.log` with an "Open log folder" button in Settings.
- The app recovers when one of its renderer processes dies (previously: black window / camera
  silently stopped until a restart).
- User data moves from `%APPDATA%\@omnicam\desktop` to `%APPDATA%\OmniCam`; settings and the
  certificate are carried over so phones keep their exception.
- Pairing endpoint: constant-time token check and a per-client rate limit.
- GitHub Actions build; a version bump on `main` publishes a release with the installer,
  `latest.yml` and the changelog section as its notes.

## 1.0.0 — 2026-09-12

First release. Windows 10 (1809+) and Windows 11, 64-bit.

### What it does
- Turns your phone's camera into a webcam named **OmniCam** for Discord, Zoom, Google Meet,
  Chrome, OBS and any other app that uses DirectShow cameras — with nothing installed on the phone.
- Scan a QR code, accept the one-time browser security warning, tap Start. Video goes phone → PC
  directly over your Wi-Fi (WebRTC, hardware-encoded H.264); nothing leaves your network.
- Front/back camera, resolution (720p – 4K), torch, mirror, rotate, Fill/Fit — from the desktop
  app or the phone page. Live preview with stats. Runs from the tray.

### Under the hood
- Own DirectShow virtual camera (built on softcam) with x64 and x86 drivers, registered by the
  installer together with a Windows Firewall rule.
- Native frame pipeline (libyuv): event-driven, correct BT.601/709 colour, nothing is converted
  while no app reads the camera; the phone drops to 5 fps when nothing on the desktop needs frames.
- Software video decoding by default (measured faster than the GPU round trip up to 1080p);
  hardware decoding available in Settings for 4K.
- ~0.25 CPU cores while streaming 1080p into an app, flat memory over long sessions.

### Known limitations
- Apps that only use the newer Windows camera stack (Windows Camera app, new Microsoft Teams)
  do not see DirectShow cameras.
- The installer is not code-signed yet: Windows SmartScreen shows "More info → Run anyway".
- No virtual microphone; macOS/Linux not yet supported.
