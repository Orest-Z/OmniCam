# Privacy

OmniCam has **no account, no analytics and no crash reporting**. Nothing about you, your phone or your video
is sent to the developer.

Two things are sent **only if you choose to**, and both are off until you say yes: a once-a-month count of your
install, and a star rating. [What they contain](#the-count-and-the-rating-both-optional) is spelled out below.

## Connections OmniCam makes

| What | Where to | When | Can I turn it off? |
|---|---|---|---|
| The phone page and pairing | Your phone → your PC, on your local network (HTTPS, port 28441 by default) | While you pair | It *is* the app |
| Video, microphone sound and controls | Your phone ↔ your PC, peer-to-peer on your local network (WebRTC, encrypted; when WebRTC can't connect, over the page's own encrypted HTTPS connection) | While streaming; the microphone only when you turn it on | It *is* the app |
| Update check | Your PC → GitHub (`github.com`, the project's Releases) | At launch and once a day | **Yes**: Settings → About → *Check for updates automatically* |
| Update download | Your PC → GitHub | Only after you click *Update* | Don't click it |
| Counting your install (optional) | Your PC → OmniCam's counter (`omnicam-counter.orest-zogju.workers.dev`) | Once a calendar month in which you use OmniCam, and only if you said yes | **Yes**: it is off unless you turn it on; Settings → About → *Count this install* |
| Star rating (optional) | Your PC → the same counter | Once, when you click a star | Don't click one |

- Video and sound never leave your network: there are no STUN, TURN or relay servers, and WebRTC only uses
  your PC's local addresses. On the PC the phone's sound goes only into the virtual audio cable you
  installed (on Linux, OmniCam's own *OmniCam Microphone*), never to your speakers, and nothing is recorded.
- The phone page is served by your PC and loads nothing from the internet (fonts and scripts are built in).
- An update check is an ordinary request to GitHub for the latest release's `latest.yml`. GitHub sees your
  IP address and that an OmniCam install asked; [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
  applies to that request. Turning the setting off stops it; *Check for updates* in Settings still works
  when you click it.

## The count and the rating (both optional)

OmniCam is free and has no way to know whether anyone uses it. So it asks, once, whether your install may be
counted, and offers five stars to click. Say no, or ignore both, and nothing is ever sent.

- **The count** is one small message a month. This is all of it: `{"v":"2.5.0","os":"win32"}`, the app version
  and your operating system. There is no ID in it, so one month's message can't be linked to the next, or to you.
- **The rating** is sent once, when you click a star: `{"v":"2.5.0","os":"win32","stars":5}`.
- **What the counter keeps** is a tally: how many messages came in on a day for a version and a system, and how
  many ratings for each number of stars. Nothing else is written down.
- **Your IP address is never saved.** Like every request on the internet, the message arrives from your IP
  address. The counter does not store it and keeps no logs; it only uses it in passing to turn away floods of
  requests. The counter runs on Cloudflare (a Cloudflare Worker), which carries the request under
  [its own privacy policy](https://www.cloudflare.com/privacypolicy/).
- **You can read all of it.** The counter's code is in this repository
  ([tools/counter/worker.mjs](tools/counter/worker.mjs)), and so is the code that sends the two messages
  ([usage-ping.ts](apps/desktop/src/main/usage-ping.ts)).
- **Changing your mind:** Settings → About → *Count this install* turns the count on or off at any time. A rating
  that was sent can't be taken back, since nothing ties it to you.

## What stays on your PC

- Settings: `%APPDATA%\OmniCam\settings.json` (Linux: `~/.config/OmniCam/settings.json`), including your answers
  about the count and the rating, and on how many days a phone has streamed (used only to decide when to offer
  the stars; never sent)
- The self-signed HTTPS certificate for the phone page: generated on your PC, never uploaded
- Logs: `%APPDATA%\OmniCam\logs\omnicam.log`, on Linux `~/.config/OmniCam/logs/omnicam.log` (connections, camera device state, errors; never the pairing
  token in installed builds). Nothing reads them but you; attach them to a bug report only if you want to.

Uninstalling removes the program, the camera device and the firewall rule. Settings and logs in
`%APPDATA%\OmniCam` stay until you delete that folder (Linux: `~/.config/OmniCam`; the AppImage also leaves its
camera setup in `/etc/modprobe.d/omnicam.conf` and `/etc/modules-load.d/omnicam.conf`).

## The website

The project site (GitHub Pages) uses no cookies, analytics or trackers. GitHub hosts it and receives the
usual request information (IP address, browser) under its own privacy statement.
