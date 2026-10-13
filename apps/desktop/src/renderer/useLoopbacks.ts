import { useEffect, useState } from 'react';
import { defaultIsLoopback, loopbackOutputs } from '../shared/audio-sink';

export interface Loopbacks {
  /** Virtual cables the phone's sound can be played into (the same list the engine picks from). */
  outputs: MediaDeviceInfo[];
  /** Windows plays its sound into a cable, so apps would hear all of it through the phone's microphone. */
  isDefault: boolean;
}

/** The virtual cables on this computer, following devices as they are added or removed. Null until read. */
export function useLoopbacks(): Loopbacks | null {
  const [loopbacks, setLoopbacks] = useState<Loopbacks | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => alive && setLoopbacks({ outputs: loopbackOutputs(d), isDefault: defaultIsLoopback(d) }))
        .catch(() => alive && setLoopbacks({ outputs: [], isDefault: false }));
    read();
    navigator.mediaDevices.addEventListener('devicechange', read);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', read);
    };
  }, []);
  return loopbacks;
}
