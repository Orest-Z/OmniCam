# OmniCam brand assets

- `fonts/` — Geist Sans & Geist Mono variable fonts (Vercel, SIL Open Font License), vendored so both
  the desktop renderer and the phone page can self-host them without network access.
- `mark.svg` — the OmniCam mark. The canonical geometry lives in `apps/desktop/build/icons.mjs`, which
  generates every icon size; keep this file in sync by re-running that script.

Palette (from the brand sheet): background `#0a0a0d`, surfaces `#141317` / `#1b1a20` / `#242229`, text `#e8e6ef` / `#9d99ab` / `#6b6778`,
accent violet `#8a5cf3` (hover `#9b74f7`), light violet `#ccb6fe` for active text, live `#a78bfa`, warn `#e9b35a`, danger `#f06a7e`.
accent white, live `#0ad950`, warn `#f5a524`, danger `#f04a5e`.
