# Privacy

OmniCam has **no account, no telemetry, no analytics and no crash reporting**. There is no OmniCam
server. Nothing about you, your phone or your video is sent to the developer.

## Connections OmniCam makes

| What | Where to | When | Can I turn it off? |
|---|---|---|---|
| The phone page and pairing | Your phone → your PC, on your local network (HTTPS, port 28441 by default) | While you pair | It *is* the app |
| Video, microphone sound and controls | Your phone ↔ your PC, peer-to-peer on your local network (WebRTC, encrypted) | While streaming; the microphone only when you turn it on | It *is* the app |
| Update check | Your PC → GitHub (`github.com`, the project's Releases) | At launch and once a day | **Yes**: Settings → About → *Check for updates automatically* |
| Update download | Your PC → GitHub | Only after you click *Update* | Don't click it |

- Video and sound never leave your network: there are no STUN, TURN or relay servers, and WebRTC only uses
  your PC's local addresses. On the PC the phone's sound goes only into the virtual audio cable you
  installed (on Linux, OmniCam's own *OmniCam Microphone*), never to your speakers, and nothing is recorded.
- The phone page is served by your PC and loads nothing from the internet (fonts and scripts are built in).
- An update check is an ordinary request to GitHub for the latest release's `latest.yml`. GitHub sees your
  IP address and that an OmniCam install asked; [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
  applies to that request. Turning the setting off stops it; *Check for updates* in Settings still works
  when you click it.

## What stays on your PC

- Settings: `%APPDATA%\OmniCam\settings.json` (Linux: `~/.config/OmniCam/settings.json`)
- The self-signed HTTPS certificate for the phone page: generated on your PC, never uploaded
- Logs: `%APPDATA%\OmniCam\logs\omnicam.log`, on Linux `~/.config/OmniCam/logs/omnicam.log` (connections, camera device state, errors; never the pairing
  token in installed builds). Nothing reads them but you; attach them to a bug report only if you want to.

Uninstalling removes the program, the camera device and the firewall rule. Settings and logs in
`%APPDATA%\OmniCam` stay until you delete that folder (Linux: `~/.config/OmniCam`; the AppImage also leaves its
camera setup in `/etc/modprobe.d/omnicam.conf` and `/etc/modules-load.d/omnicam.conf`).

## The website

The project site (GitHub Pages) uses no cookies, analytics or trackers. GitHub hosts it and receives the
usual request information (IP address, browser) under its own privacy statement.
