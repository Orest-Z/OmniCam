/**
 * The PipeWire / PulseAudio pieces of OmniCam's Linux microphone, as pactl arguments, and reading
 * pactl's output. Pure (no Electron), so node --test covers it.
 *
 * The engine plays the phone's audio into a null sink ("OmniCam Feed"); a source remapped from its
 * monitor ("OmniCam Microphone") is what apps record from. Both live only while OmniCam runs.
 */

export const SINK_NAME = 'omnicam_feed';
export const SOURCE_NAME = 'omnicam_mic';

/**
 * The property lists are single-quoted with a double-quoted description inside: PulseAudio's own syntax.
 * pipewire-pulse cuts an unquoted or only double-quoted description at its first space ("OmniCam").
 * priority.session=0 puts both last when WirePlumber picks a default by itself (hardware is ~600–2000).
 */
export const SINK_ARGS = [
  'load-module',
  'module-null-sink',
  `sink_name=${SINK_NAME}`,
  `sink_properties='device.description="OmniCam Feed" priority.session=0'`,
];
export const SOURCE_ARGS = [
  'load-module',
  'module-remap-source',
  `source_name=${SOURCE_NAME}`,
  `master=${SINK_NAME}.monitor`,
  `source_properties='device.description="OmniCam Microphone" priority.session=0'`,
];

/**
 * Full volume, unmuted. WirePlumber restores a node's last volume by name, so one turn of the volume keys
 * while the feed was the default output would otherwise make the microphone quiet on every later run.
 */
export const LEVEL_ARGS = [
  ['set-sink-volume', SINK_NAME, '100%'],
  ['set-sink-mute', SINK_NAME, '0'],
  ['set-source-volume', SOURCE_NAME, '100%'],
  ['set-source-mute', SOURCE_NAME, '0'],
];

/**
 * The output to switch to when the feed became the default: the one before it if it is still there,
 * else the first other sink in `pactl list short sinks`; empty when there is none.
 */
export function replacementSink(shortSinks: string, previous: string): string {
  const names = shortSinks
    .split('\n')
    .map((l) => l.split('\t')[1])
    .filter((n): n is string => Boolean(n) && n !== SINK_NAME);
  return names.includes(previous) ? previous : (names[0] ?? '');
}

/**
 * OmniCam's modules in `pactl list short modules` (id, name, arguments, tab-separated), e.g. left by a
 * crash. The source comes first: it is built on the sink's monitor, so it goes before the sink.
 */
export function ownModules(shortList: string): number[] {
  const sources: number[] = [];
  const sinks: number[] = [];
  for (const line of shortList.split('\n')) {
    const [id, name, args = ''] = line.split('\t');
    if (!/^\d+$/.test(id ?? '')) continue;
    const has = (arg: string) => args.split(/\s+/).includes(arg);
    if (name === 'module-remap-source' && has(`source_name=${SOURCE_NAME}`)) sources.push(Number(id));
    if (name === 'module-null-sink' && has(`sink_name=${SINK_NAME}`)) sinks.push(Number(id));
  }
  return [...sources, ...sinks];
}

/** "Default Sink" / "Default Source" from `pactl info`, run with LC_ALL=C so the labels are English. */
export function parseDefaults(info: string): { sink: string; source: string } {
  const field = (label: string) => info.match(new RegExp(`^${label}:\\s*(.*)$`, 'm'))?.[1].trim() ?? '';
  return { sink: field('Default Sink'), source: field('Default Source') };
}

/**
 * A `pactl subscribe` line worth a fresh look: the defaults changed (a "server" change), or a sink,
 * source or module went away, which may have been ours.
 */
export function isRelevantEvent(line: string): boolean {
  return /^Event '(change)' on server\b/.test(line) || /^Event 'remove' on (sink|source|module) #/.test(line);
}
