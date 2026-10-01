# Security policy

OmniCam opens a port on your local network and installs a camera driver, so security reports are
taken seriously. Thank you for looking.

## Supported versions

Only the [latest release](https://github.com/Orest-Z/OmniCam/releases/latest) receives security fixes.
If you are on an older version, update first and check whether the issue is still there.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub instead:
[Security → Report a vulnerability](https://github.com/Orest-Z/OmniCam/security/advisories/new).

A useful report includes:

- the OmniCam version (shown in Settings) and your Windows version
- the phone and browser, if the phone side is involved
- steps to reproduce, ideally a minimal proof of concept
- what an attacker gains (what they can see, change or run, and from where)

An excerpt of `%APPDATA%\OmniCam\logs\omnicam.log` often helps. Packaged builds never write the
pairing token to the log, but please look over what you attach.

### What to expect

OmniCam is maintained by one person in their spare time. You can expect:

- an acknowledgement within **7 days**
- an assessment and a plan, or questions, once the report is reproduced
- a fix in a new release, with credit in the release notes unless you would rather stay anonymous

Please give a reasonable amount of time for a fix before disclosing publicly.

## In scope

The parts that matter most:

- **The phone server and pairing endpoint** (`apps/desktop/src/main/server.ts`, `session.ts`):
  connecting, pushing video or sending camera controls without the QR token; reading files outside
  the phone page; anything a device on the same network can do to the PC beyond loading that page.
- **The Electron app**: escaping the sandboxed UI window, running code through the engine window,
  abusing IPC between the windows and the main process.
- **The native code** (`packages/vcam-native`): memory-safety bugs reachable from frame data, or from
  an application that opens the OmniCam camera.
- **The installer**: driver registration, the Windows Firewall rule, install paths and permissions.
- **The updater** (`apps/desktop/src/main/updater.ts`): anything that makes OmniCam download or run
  something other than an official release.

## Known and by design

These are deliberate trade-offs, explained in [ARCHITECTURE.md](ARCHITECTURE.md). They are not
vulnerabilities on their own, but reports that show a *practical* attack building on them are welcome.

- **Self-signed certificate.** Phone browsers only allow camera access over HTTPS, and a local
  network address cannot get a publicly trusted certificate, so the phone shows a one-time warning.
  Accept it on a network you trust: someone able to intercept your Wi-Fi at that moment could
  present their own certificate instead.
- **The phone page is visible on the local network.** Any device on the same network can load the
  page and `/api/health`, which reports the app name and version. Only a phone holding the token
  from the QR code can start a stream.
- **The token lives in the QR code.** Anyone who sees the QR code or its URL can connect while that
  code is valid. Generate a new code from the pairing screen if it has been exposed; restarting
  OmniCam also replaces it.
- **The installer is not code-signed yet**, so Windows SmartScreen warns before running it. For the
  same reason, in-app updates are checked against the sha512 published with the GitHub release, not
  against a code signature.

Video travels phone → PC directly over WebRTC, which encrypts media (DTLS-SRTP). Nothing is sent
to any server outside your network.

## Third-party components

Bugs in [softcam](https://github.com/tshino/softcam), [libyuv](https://chromium.googlesource.com/libyuv/libyuv)
or Electron/Chromium belong with those projects. If OmniCam only needs to update a dependency, a
regular issue is fine, unless the bug is exploitable through OmniCam itself; then report it here
privately as above.
