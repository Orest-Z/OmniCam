// WebCodecs / Insertable Streams types not (yet) in TypeScript's DOM lib.
interface PlaneLayout {
  offset: number;
  stride: number;
}

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<VideoFrame>;
}
