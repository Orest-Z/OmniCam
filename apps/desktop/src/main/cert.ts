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

/**
 * Self-signed server certificate, generated once per install and re-generated when the
 * set of LAN addresses changes. Phones will show a one-time "not private" warning; that is
 * an accepted product constraint (see ARCHITECTURE.md). SANs are still filled in correctly so the
 * warning is the *only* thing standing between the phone and a working camera page.
 */
export async function loadOrCreateCert(): Promise<TlsMaterial> {
  const dir = join(app.getPath('userData'), 'tls');
  const keyFile = join(dir, 'server.key');
  const certFile = join(dir, 'server.crt');
  const metaFile = join(dir, 'meta.json');

  const ips = lanAddresses().map((a) => a.ip).sort();
  const meta = { ips, v: 1 };

  if (existsSync(keyFile) && existsSync(certFile) && existsSync(metaFile)) {
    try {
      const prev = JSON.parse(readFileSync(metaFile, 'utf8')) as typeof meta;
      if (prev.v === meta.v && JSON.stringify(prev.ips) === JSON.stringify(ips)) {
        return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
      }
    } catch {
      /* regenerate */
    }
  }

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
  writeFileSync(metaFile, JSON.stringify(meta));
  return { key: pems.private, cert: pems.cert };
}
