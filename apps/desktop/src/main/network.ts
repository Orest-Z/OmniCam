import { networkInterfaces } from 'node:os';
import type { NetworkAddress } from '@omnicam/protocol';

const WIFI_HINT = /wi-?fi|wlan|wireless|802\.11|en0|airport/i;
const VIRTUAL_HINT = /vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier|hamachi|loopback|bluetooth|npcap|tap-|tun/i;

function isPrivate(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** LAN IPv4 addresses a phone on the same Wi-Fi could plausibly reach, best first. */
export function lanAddresses(): NetworkAddress[] {
  const out: NetworkAddress[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (/^169\.254\./.test(info.address)) continue; // APIPA = no DHCP, useless
      out.push({ ip: info.address, interfaceName: name, wifi: WIFI_HINT.test(name) });
    }
  }
  const score = (a: NetworkAddress) =>
    (a.wifi ? 4 : 0) + (isPrivate(a.ip) ? 2 : 0) - (VIRTUAL_HINT.test(a.interfaceName) ? 8 : 0);
  return out.sort((a, b) => score(b) - score(a));
}

export function pickAddress(preferredIp: string): NetworkAddress | undefined {
  const all = lanAddresses();
  return all.find((a) => a.ip === preferredIp) ?? all[0];
}
