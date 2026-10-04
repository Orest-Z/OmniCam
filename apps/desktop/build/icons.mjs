// Generates every icon asset from one vector definition of the OmniCam mark
// (lens ring + aperture dot + two signal arcs), so all sizes stay pixel-crisp.
//
//   apps/desktop/resources/icons/  icon.png (1024)  icon.ico  tray.ico  tray-live.ico
//                                  tray.png tray@2x.png tray-live.png tray-live@2x.png
//   apps/phone/public/             apple-touch-icon.png icon-192.png icon-512.png favicon.svg
//   assets/brand/                  mark.svg  contact-sheet.png (reference sheet for eyeballing small sizes)
//
// Usage: node build/icons.mjs
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, '..', 'resources', 'icons');
const phoneDir = resolve(here, '..', '..', 'phone', 'public');
const brandDir = resolve(here, '..', '..', '..', 'assets', 'brand');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(phoneDir, { recursive: true });

export const BRAND = {
  bg: '#0A0A0D',
  fg: '#FFFFFF',
  live: '#8A5CF3',
};

const deg = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, a) => [cx + r * Math.cos(deg(a)), cy + r * Math.sin(deg(a))];
const arcPath = (cx, cy, r, a0, a1) => {
  const [x0, y0] = pt(cx, cy, r, a0);
  const [x1, y1] = pt(cx, cy, r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/**
 * The mark in a 100×100 box. `weight` scales stroke thickness (small sizes need heavier strokes).
 * Geometry measured from the reference sheet: ring offset down-left so the arcs balance it.
 */
function mark({ weight = 1, color = BRAND.fg, small = false } = {}) {
  const cx = 44, cy = 56;
  const ringR = 26, ringW = 8.6 * weight;
  const dotR = 7.2 * weight ** 0.5;
  const arcW = 6 * weight;
  const a0 = -66, a1 = -20;
  // Small sizes (<= 24 px): one thick arc instead of two — two arcs alias into a smear.
  const arcs = small
    ? `<path d="${arcPath(cx, cy, 44, a0, a1)}" stroke-width="${arcW * 1.6}"/>`
    : `<path d="${arcPath(cx, cy, 38.5, a0, a1)}" stroke-width="${arcW}"/>
       <path d="${arcPath(cx, cy, 50.5, a0, a1)}" stroke-width="${arcW}"/>`;
  return `
    <g fill="none" stroke="${color}" stroke-linecap="round">
      <circle cx="${cx}" cy="${cy}" r="${ringR}" stroke-width="${ringW}"/>
      ${arcs}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${color}"/>`;
}

function svg(size, inner, { viewBox = 100 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${viewBox} ${viewBox}">${inner}</svg>`;
}

/** App icon: dark rounded square, mark at ~64% of the tile. */
function appIconSvg(size, { rounded = true } = {}) {
  const r = rounded ? 22 : 0;
  const small = size <= 24;
  const scale = small ? 0.8 : size <= 48 ? 0.72 : 0.64;
  const off = (100 - 100 * scale) / 2;
  return svg(size, `
    <rect width="100" height="100" rx="${r}" fill="${BRAND.bg}"/>
    <g transform="translate(${off} ${off}) scale(${scale})">${mark({ weight: small ? 1.3 : size <= 48 ? 1.1 : 1, small })}</g>`);
}

/** Tray glyph: white mark filling the canvas, optional live dot with a transparent knock-out ring. */
function traySvg(size, { live = false } = {}) {
  const heavy = size <= 24 ? 1.35 : size <= 48 ? 1.15 : 1;
  const dot = live
    ? `<circle cx="84" cy="84" r="16" fill="${BRAND.live}"/>`
    : '';
  const knock = live
    ? `<mask id="k"><rect width="100" height="100" fill="#fff"/><circle cx="84" cy="84" r="24" fill="#000"/></mask>`
    : '';
  return svg(size, `
    ${knock}
    <g ${live ? 'mask="url(#k)"' : ''} transform="translate(4 4) scale(0.92)">${mark({ weight: heavy, small: size <= 24 })}</g>
    ${dot}`);
}

async function png(svgText, size, density = 384) {
  return sharp(Buffer.from(svgText), { density }).resize(size, size).png().toBuffer();
}

async function main() {
  // --- desktop app icon ---
  writeFileSync(join(iconsDir, 'icon.png'), await png(appIconSvg(1024), 1024));
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = await Promise.all(icoSizes.map((s) => png(appIconSvg(s), s)));
  writeFileSync(join(iconsDir, 'icon.ico'), await pngToIco(icoPngs));
  writeFileSync(join(brandDir, 'mark.svg'), svg(256, mark()));

  // --- tray icons (Windows uses the .ico; the PNG pairs serve macOS/Linux later) ---
  for (const live of [false, true]) {
    const base = live ? 'tray-live' : 'tray';
    const traySizes = [16, 20, 24, 32, 48];
    const pngs = await Promise.all(traySizes.map((s) => png(traySvg(s, { live }), s)));
    writeFileSync(join(iconsDir, `${base}.ico`), await pngToIco(pngs));
    writeFileSync(join(iconsDir, `${base}.png`), await png(traySvg(16, { live }), 16));
    writeFileSync(join(iconsDir, `${base}@2x.png`), await png(traySvg(32, { live }), 32));
  }

  // --- phone page (iOS rounds home-screen icons itself: use square corners) ---
  writeFileSync(join(phoneDir, 'apple-touch-icon.png'), await png(appIconSvg(180, { rounded: false }), 180));
  writeFileSync(join(phoneDir, 'icon-192.png'), await png(appIconSvg(192), 192));
  writeFileSync(join(phoneDir, 'icon-512.png'), await png(appIconSvg(512), 512));
  writeFileSync(join(phoneDir, 'favicon.svg'), appIconSvg(64));

  // --- contact sheet for eyeballing small sizes ---
  const sheetTiles = [];
  for (const s of [16, 24, 32, 48, 64, 128]) {
    sheetTiles.push({ input: await png(appIconSvg(s), s), left: 20, top: 20 });
    sheetTiles.push({ input: await png(traySvg(s), s), left: 20 + 140, top: 20 });
    sheetTiles.push({ input: await png(traySvg(s, { live: true }), s), left: 20 + 280, top: 20 });
    const last = sheetTiles.length - 3;
    for (let i = 0; i < 3; i++) sheetTiles[last + i].top = 20 + [16, 24, 32, 48, 64, 128].indexOf(s) * 150;
  }
  await sharp({ create: { width: 440, height: 920, channels: 4, background: '#2A2D33' } })
    .composite(sheetTiles)
    .png()
    .toFile(join(brandDir, 'contact-sheet.png'));

  console.log('icons written to', iconsDir, phoneDir, 'and', brandDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
