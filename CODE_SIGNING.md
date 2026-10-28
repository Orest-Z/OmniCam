# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

**Not active yet.** No OmniCam release is code-signed so far. CI has the signing
steps, switched off until SignPath Foundation accepts the project, so Windows reports every file as unsigned
and SmartScreen asks you to confirm before the installer runs. This page is the policy that applies once
signing is switched on.

## What will be signed

Only files built by this repository's CI ([`.github/workflows/build.yml`](.github/workflows/build.yml)) on
GitHub-hosted runners, from the commit the release is tagged at:

- `OmniCam-Setup-<version>.exe`, the installer
- `OmniCam.exe`
- `omnicam_vcam.dll` (x64 and x86), the DirectShow camera filter
- `omnicam_vcam.node`, the native frame pipeline

Electron's own binaries (`ffmpeg.dll`, `libEGL.dll` and the other Chromium files) are upstream
open-source builds and are shipped unchanged, unsigned by this project. The installer's uninstaller is
generated inside the installer build and is not signed separately yet.

Each signing request is submitted by CI and **approved by hand** before anything is signed. A build that
did not come from this repository's workflow cannot be signed: SignPath verifies the origin of every
request. Ordinary commits and pull requests are never signed, only releases.

## Team

| Role | Members |
|---|---|
| Committers and reviewers | [Orest-Z](https://github.com/Orest-Z) |
| Approvers | [Orest-Z](https://github.com/Orest-Z) |

Changes from anyone else arrive as pull requests and are reviewed by a committer before they are merged.
Everyone with access to the repository or to SignPath uses multi-factor authentication.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: OmniCam has no account and no telemetry. The video stays on your
local network. The only connection it makes beyond that is the update check against GitHub, which you
can turn off in Settings.

## What the installer changes

Shown on the installer's first page, and undone by the uninstaller:

- registers the "OmniCam" camera device (a DirectShow filter, 64- and 32-bit) with `regsvr32`
- adds a Windows Firewall rule named "OmniCam" that allows inbound connections to `OmniCam.exe`
  on private and public network profiles (phone hotspots often show up as "public"), so your
  phone can reach it on the local network

## Verifying a download

Until releases are signed, the installer has no **Digital Signatures** tab. Every release's notes list instead
the installer's SHA-256 and a signed build provenance attestation, which shows it was built by this repository's
GitHub Actions from the tagged commit:

```powershell
Get-FileHash .\OmniCam-Setup-<version>.exe
gh attestation verify OmniCam-Setup-<version>.exe --repo Orest-Z/OmniCam
```

Once signing is on: right-click the installer → **Properties** → **Digital Signatures**, and the signer is
*SignPath Foundation*. Or `Get-AuthenticodeSignature .\OmniCam-Setup-<version>.exe`.

Reporting a problem with a signed file, or a file that claims to be signed by this project and was not
built here: follow [SECURITY.md](SECURITY.md).
