/**
 * The phone's microphone reaches apps through a loopback device (a "virtual cable"): the engine plays
 * the audio into its output side, and apps pick its input side as their microphone. Only the output
 * side of a known loopback is ever used, never a real speaker, which would play the phone's
 * microphone out loud.
 *
 * VB-CABLE (and its A–D and Hi-Fi variants) names the pair "CABLE Input" / "CABLE Output"; Virtual
 * Audio Cable gives both sides the same name, e.g. "Line 1 (Virtual Audio Cable)".
 */
const LOOPBACK_OUTPUT = /\bcable(-[a-d])? input\b|\(virtual audio cable\)/i;

/** The fields of a MediaDeviceInfo this needs, so it runs without a browser. */
export interface AudioDevice {
  kind: string;
  deviceId: string;
  label: string;
}

/**
 * Loopback outputs among the devices. Chromium's "default" and "communications" entries are left out:
 * they follow whatever Windows makes the default, which can turn into the speakers at any moment.
 */
export function loopbackOutputs<T extends AudioDevice>(devices: T[]): T[] {
  return devices.filter(
    (d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && LOOPBACK_OUTPUT.test(d.label),
  );
}

/** Where the phone's audio goes: the chosen loopback while it is there, else the first one found, else nowhere. */
export function pickSink<T extends AudioDevice>(devices: T[], preferred: string): T | null {
  const outputs = loopbackOutputs(devices);
  return outputs.find((d) => d.label === preferred) ?? outputs[0] ?? null;
}

/** The microphone to pick in Discord, Zoom or Teams: VB-CABLE's "CABLE Input" comes out of "CABLE Output". */
export function micNameFor(outputLabel: string): string {
  return outputLabel.replace(/\bInput\b/, 'Output');
}
