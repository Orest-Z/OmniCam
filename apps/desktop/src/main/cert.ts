import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { lanAddresses } from './network';

export interface TlsMaterial {
  key: string;
  cert: string;
}

const TEN_YEARS_MS = 10 * 365 * 24 * 3600 * 1000;

/** Keeps the SAN list (and the warning-free window) from growing forever on a roaming machine. */
const MAX_SAN_IPS = 32;

/**
 * Self-signed server certificate, generated once per install. Phones show a one-time "not private"
 * warning; that is an accepted product constraint (see ARCHITECTURE.md). SANs are filled in correctly
 * so the warning is the *only* thing standing between the phone and a working camera page.
 *
 * The certificate is only re-generated when a LAN address appears that it does not already cover, and
 * the new one keeps the addresses the old one had. Regenerating invalidates the exception every phone
 * accepted, so "one-time" has to mean one time: addresses must accumulate rather than be replaced,
 * or moving between two networks (or a VPN going up and down) would ask again on every switch.
 */
export async function loadOrCreateCert(): Promise<TlsMaterial> {
  const dir = join(app.getPath('userData'), 'tls');
  const keyFile = join(dir, 'server.key');
  const certFile = join(dir, 'server.crt');
  const metaFile = join(dir, 'meta.json');

  const current = lanAddresses().map((a) => a.ip);
  let covered: string[] = [];

  if (existsSync(keyFile) && existsSync(certFile) && existsSync(metaFile)) {
    try {
      const prev = JSON.parse(readFileSync(metaFile, 'utf8')) as { v?: number; ips?: string[] };
      if (prev.v === 2 && Array.isArray(prev.ips)) {
        covered = prev.ips;
        if (current.every((ip) => covered.includes(ip))) {
          return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
        }
      }
    } catch {
      /* regenerate */
    }
  }

  // Current addresses first, so the cap drops the ones least likely to come back.
  const ips = [...new Set([...current, ...covered])].slice(0, MAX_SAN_IPS);
  console.log(`cert: issuing a certificate for ${ips.join(', ') || 'localhost only'}`);

  const pems = await generate([{ name: 'commonName', value: 'OmniCam' }, { name: 'organizationName', value: 'OmniCam' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + TEN_YEARS_MS),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyAgreement: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 2, value: 'omnicam.local' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });

  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, pems.private, { mode: 0o600 });
  writeFileSync(certFile, pems.cert);
  writeFileSync(metaFile, JSON.stringify({ v: 2, ips }));
  return { key: pems.private, cert: pems.cert };
}
