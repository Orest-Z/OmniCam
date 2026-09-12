import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { PairingInfo } from '@omnicam/protocol';
import { pickAddress, lanAddresses } from './network';
import { settings } from './settings';

/**
 * Pairing token + QR. The token is a per-launch secret embedded in the QR URL; the phone
 * must present it on /api/session. Anyone on the LAN can load the page, but only a phone
 * that scanned the QR can push video into the virtual camera.
 */
class SessionManager {
  private token = randomBytes(16).toString('base64url');
  private port = settings.get().port;

  setPort(port: number) {
    this.port = port;
  }

  rotateToken(): void {
    this.token = randomBytes(16).toString('base64url');
  }

  validate(token: unknown): boolean {
    return typeof token === 'string' && token.length > 8 && token === this.token;
  }

  async pairingInfo(): Promise<PairingInfo> {
    const addr = pickAddress(settings.get().preferredIp);
    const ip = addr?.ip ?? '127.0.0.1';
    const url = `https://${ip}:${this.port}/?t=${this.token}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#17151d', light: '#efe9ff' },
    });
    return { url, token: this.token, port: this.port, ip, addresses: lanAddresses(), qrDataUrl };
  }
}

export const session = new SessionManager();
