// Generates resources/icons/{icon.png,tray.png,tray@2x.png} with zero dependencies.
// Design: dark rounded square, blue lens ring + dot. Replace with real artwork any time.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const smooth = (d, edge = 1) => Math.max(0, Math.min(1, 0.5 - d / edge));

function design(size, { square }) {
  const c = size / 2;
  const R = size * 0.34;   // ring radius
  const w = size * 0.075;  // ring width
  const r = size * 0.15;   // dot
  const corner = size * 0.22;
  return (x, y) => {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    let bgA = 1;
    if (square) {
      // rounded-square mask
      const qx = Math.max(Math.abs(dx) - (c - corner), 0);
      const qy = Math.max(Math.abs(dy) - (c - corner), 0);
      bgA = smooth(Math.hypot(qx, qy) - corner);
    } else bgA = 0;
    const ring = smooth(Math.abs(d - R) - w / 2);
    const dot = smooth(d - r);
    const blue = [59, 130, 246];
    const bg = [17, 24, 39];
    const fgA = Math.max(ring, dot);
    const outR = blue[0] * fgA + bg[0] * (1 - fgA);
    const outG = blue[1] * fgA + bg[1] * (1 - fgA);
    const outB = blue[2] * fgA + bg[2] * (1 - fgA);
    const a = Math.max(bgA, fgA);
    return [Math.round(outR), Math.round(outG), Math.round(outB), Math.round(a * 255)];
  };
}

writeFileSync(join(out, 'icon.png'), png(256, design(256, { square: true })));
writeFileSync(join(out, 'tray.png'), png(16, design(16, { square: false })));
writeFileSync(join(out, 'tray@2x.png'), png(32, design(32, { square: false })));
console.log('icons written to', out);
