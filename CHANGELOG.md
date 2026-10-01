# Changelog

## Unreleased

- A busy port no longer moves OmniCam quietly. When the port in Settings is taken, the app says which
  port it is using instead — in a notice next to the setting and once in the window. Pairing always
  worked (the QR code carries the real port), but nothing admitted the setting was being ignored.
- Refused pairing attempts are written to the log and tell the phone how long to wait, and the budget
  per device is high enough for a phone that keeps losing Wi-Fi and for several phones sharing one
  router address. A phone stuck on *Reconnecting…* used to leave no trace anywhere.
- The certificate is only re-issued when a network address turns up that it does not already cover,
  and it keeps the addresses it had. Moving between networks, or a VPN going up and down, no longer
  asks every phone to accept the warning again.

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
