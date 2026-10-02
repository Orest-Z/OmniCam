# Changelog

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
