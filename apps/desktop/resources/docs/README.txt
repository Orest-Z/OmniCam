OmniCam
=======

Use your phone as a webcam and microphone on this PC. Nothing to install on the phone.
Created by Orest Zogju - https://github.com/Orest-Z/OmniCam

Works on Windows 10 (1809 or newer) and Windows 11, 64-bit, and on Linux x64.
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
5. Pick Camera, Camera + microphone or Microphone only, tap Start and allow access.
6. In Discord, Zoom, Teams, Google Meet, OBS, Chrome ... choose the camera named "OmniCam".

Tips
- Closing the OmniCam window keeps the camera running in the system tray (Settings > App
  can make it quit instead). Quit from the tray icon to stop it. On Linux without a tray
  (GNOME without the AppIndicator extension) the window minimises instead.
- Front/Back camera, resolution, torch, mirror, rotate and Fill/Fit are on the desktop app;
  flip, torch and resolution are on the phone page too.
- Hold the phone in landscape for the best picture. Fill (default) crops a portrait phone
  into a normal 16:9 picture; Fit shows everything with black bars.
- Keep the phone page open. Locking the phone or switching apps pauses the camera; it
  resumes when you come back.
- Settings (gear icon) has five sections: Camera (output resolution and frame rate, what to
  show when the phone pauses), Microphone, Connection (network and port), App (theme, tray,
  start when you sign in) and About (updates, log file).


THE PHONE AS A MICROPHONE
-------------------------
Windows: install VB-CABLE (free, https://vb-audio.com/Cable/) and restart. In Discord, Zoom
or Teams, choose "CABLE Output (VB-Audio Virtual Cable)" as the microphone.
Settings > Microphone > Set up walks through it. Keep your speakers as the default output.

Linux: nothing to install. While OmniCam runs, apps get a microphone named
"OmniCam Microphone".


LINUX: THE CAMERA
-----------------
The camera needs the v4l2loopback kernel module, installed once:
   Fedora:          enable RPM Fusion free, then  sudo dnf install akmod-v4l2loopback
   Debian, Ubuntu:  sudo apt install v4l2loopback-dkms
   Arch:            sudo pacman -S v4l2loopback-dkms linux-headers
Then open OmniCam and click "Set up camera" (one password prompt). If something is
missing, Settings > Camera says what and shows the command, Secure Boot included.


IF THE PHONE CANNOT OPEN THE PAGE
---------------------------------
- Phone and PC must be on the SAME Wi-Fi network (not mobile data, not a guest network).
- Some routers isolate Wi-Fi devices from each other ("AP isolation" / "client isolation").
  Turn that off in the router, or use another network / a phone hotspot with the PC on it.
- Windows: if Windows asked about the firewall when OmniCam first started, allow it for
  private networks. The installer adds a firewall rule for you; re-run it if in doubt.
- Linux: a firewall may block the port. Settings > Connection > "Phone can't open the
  page?" shows the command.
- Several network interfaces (VPN, virtual adapters)? Pick the right one under
  Settings > Connection > Network so the QR code uses the right address.


IF "OmniCam" DOES NOT SHOW UP AS A CAMERA
-----------------------------------------
- Restart the app that should use it (Discord, Zoom...). Apps list cameras at start.
- Windows: the installer registers the camera driver; run it again if it is missing.
  Apps that only use the newer Windows camera stack (for example the Windows Camera app
  or the new Microsoft Teams) do not see DirectShow cameras. Discord, Zoom, Google Meet,
  Chrome, Firefox, OBS, Slack and most others do.
- Linux: OmniCam's pairing screen and Settings > Camera say what is missing. Apps from
  Flathub need device access: flatpak override --user --device=all <app id>


SOMETHING ELSE?
---------------
Settings > About > "Open log folder" shows omnicam.log (connections, camera device,
crashes). Nothing is uploaded anywhere. Attach it when reporting a problem at
https://github.com/Orest-Z/OmniCam/issues


WINDOWS SMARTSCREEN
-------------------
OmniCam is open source and not (yet) code-signed, so Windows may show
"Windows protected your PC" when you run the installer. Click "More info", then
"Run anyway". You can always verify the download at https://github.com/Orest-Z/OmniCam


UNINSTALL
---------
Windows: Settings > Apps > OmniCam > Uninstall. This removes the camera device and
firewall rule.
Linux: sudo dnf remove OmniCam, or sudo apt remove omnicam. An AppImage is just the file;
its camera setup stays until you delete /etc/modprobe.d/omnicam.conf and
/etc/modules-load.d/omnicam.conf.


LICENSE
-------
MIT License - Copyright (c) 2026 Orest Zogju. See LICENSE.txt for details and
third-party notices.
