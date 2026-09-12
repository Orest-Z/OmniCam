# OmniCam

Use your phone's camera as a webcam on your computer — **no app to install on the phone**.

1. Open OmniCam on your PC. It shows a QR code.
2. Scan it with your phone (same Wi-Fi). A page opens in the browser.
3. Accept the one-time security warning, tap **Start camera**, allow camera access.
4. Pick **"OmniCam"** as the camera in Discord, Zoom, Teams, Chrome, OBS…

Video goes phone → PC directly over your Wi-Fi (WebRTC, hardware-encoded H.264); nothing leaves
your network. Switch front/back camera, torch, resolution, mirror and rotation from either side.

## Development

Prerequisites (Windows): Node ≥ 20, Visual Studio 2022 Build Tools with the C++ workload,
CMake ≥ 3.20 (`pip install cmake` is fine).

```
git clone --recursive <repo>
npm install
npm run native:build      # N-API addon + DirectShow filter DLLs
npm run native:register   # admin, once: registers the "OmniCam" camera device
npm run dev
```

See `CLAUDE.md` for the architecture and the reasoning behind the design.

## License

MIT. Bundles [softcam](https://github.com/tshino/softcam) (MIT) and
[libyuv](https://chromium.googlesource.com/libyuv/libyuv) (BSD).
