# Changelog

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
