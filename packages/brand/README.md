# OmniCam brand assets

- `fonts/` — Geist Sans & Geist Mono variable fonts (Vercel, SIL Open Font License), vendored so both
  the desktop renderer and the phone page can self-host them without network access.
- `mark.svg` — the OmniCam mark. The canonical geometry lives in `apps/desktop/build/icons.mjs`, which
  generates every icon size; keep this file in sync by re-running that script.

Palette: background `#0a0a0b`, surfaces `#121214` / `#19191c` / `#212126`, text `#ededef` / `#a1a1aa` / `#6e6e78`,
accent white, live `#0ad950`, warn `#f5a524`, danger `#f04a5e`.
