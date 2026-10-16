import type { Distro } from './ipc';

export interface FirewallStep {
  /** When this applies, one short sentence. */
  when: string;
  command: string;
}

/**
 * Opening OmniCam's port when the phone can't reach the page on Linux. Fedora Workstation's firewalld
 * zone already allows 1025–65535, so only other zones need it; Ubuntu's ufw is off unless turned on.
 * Pure, so node --test covers it.
 */
export function firewallSteps(distro: Distro, port: number): FirewallStep[] {
  const firewalld: FirewallStep = {
    when: distro === 'fedora' ? 'Fedora Workstation already allows it; other firewalld zones need:' : 'With firewalld:',
    command: `sudo firewall-cmd --permanent --add-port=${port}/tcp && sudo firewall-cmd --reload`,
  };
  const ufw: FirewallStep = { when: distro === 'debian' ? 'With ufw turned on (Ubuntu):' : 'With ufw:', command: `sudo ufw allow ${port}/tcp` };
  if (distro === 'fedora') return [firewalld];
  if (distro === 'debian') return [ufw];
  return [firewalld, ufw];
}
