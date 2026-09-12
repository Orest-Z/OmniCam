OmniCam 0.1.0
=============

Use your phone's camera as a webcam on this PC. Nothing to install on the phone.
Created by Orest Zogju - https://github.com/Orest-Z/OmniCam

Works on Windows 10 (1809 or newer) and Windows 11, 64-bit.
Video stays on your Wi-Fi: the phone talks to this PC directly, nothing goes to the internet.


HOW TO USE
----------
1. Open OmniCam. It shows a QR code.
2. Make sure your phone is on the same Wi-Fi as this PC.
3. Scan the QR code with your phone's camera app and open the link.
4. Your phone shows a security warning ONCE. This is expected: the link is private to
   your Wi-Fi, so the phone cannot verify it like a public website.
      iPhone (Safari):  tap "Show Details", then "visit this website"
      Android (Chrome): tap "Advanced", then "Proceed to 192.168..."
5. Tap "Start camera" and allow camera access.
6. In Discord, Zoom, Teams, Google Meet, OBS, Chrome ... choose the camera named "OmniCam".

Tips
- Closing the OmniCam window keeps the camera running in the system tray. Quit from the
  tray icon to stop it.
- Front/Back camera, resolution, torch, mirror, rotate and Fill/Fit are on the desktop app;
  flip and resolution are on the phone page too.
- Hold the phone in landscape for the best picture. Fill (default) crops a portrait phone
  into a normal 16:9 picture; Fit shows everything with black bars.
- Keep the phone page open. Locking the phone or switching apps pauses the camera; it
  resumes when you come back.
- Settings (gear icon): output resolution (720p/1080p), what to show when the phone
  pauses, Wi-Fi interface and port, start with Windows.


IF THE PHONE CANNOT OPEN THE PAGE
---------------------------------
- Phone and PC must be on the SAME Wi-Fi network (not mobile data, not a guest network).
- Some routers isolate Wi-Fi devices from each other ("AP isolation" / "client isolation").
  Turn that off in the router, or use another network / a phone hotspot with the PC on it.
- If Windows asked about the firewall when OmniCam first started, allow it for private
  networks. The installer adds a firewall rule for you; re-run the installer if in doubt.
- Several network interfaces (VPN, virtual adapters)? Pick the Wi-Fi one under
  Settings > Network interface so the QR code uses the right address.


IF "OmniCam" DOES NOT SHOW UP AS A CAMERA
-----------------------------------------
- Restart the app that should use it (Discord, Zoom...). Apps list cameras at start.
- The installer registers the camera driver; run the installer again if it is missing.
- Apps that only use the newer Windows camera stack (for example the Windows Camera app
  or the new Microsoft Teams) do not see DirectShow cameras. Discord, Zoom, Google Meet,
  Chrome, Firefox, OBS, Slack and most others do.


WINDOWS SMARTSCREEN
-------------------
OmniCam is open source and not (yet) code-signed, so Windows may show
"Windows protected your PC" when you run the installer. Click "More info", then
"Run anyway". You can always verify the download at https://github.com/Orest-Z/OmniCam


UNINSTALL
---------
Settings > Apps > OmniCam > Uninstall. This removes the camera device and firewall rule.


LICENSE
-------
MIT License - Copyright (c) 2026 Orest Zogju. See LICENSE.txt for details and
third-party notices (softcam, libyuv, Geist, Electron, Lucide).
