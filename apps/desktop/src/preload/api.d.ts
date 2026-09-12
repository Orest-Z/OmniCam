import type { UiApi } from '../shared/ipc';

declare global {
  interface Window {
    omnicam: UiApi;
    omnicamVcamError: { on(cb: (msg: string) => void): () => void };
  }
}

export {};
