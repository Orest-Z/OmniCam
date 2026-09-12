import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, DesktopToPhone, PhoneToDesktop } from '@omnicam/protocol';
import {
  UI_CONTROL,
  UI_DISCONNECT,
  UI_GET_STATE,
  UI_OPEN_EXTERNAL,
  UI_OPEN_LOGS,
  UI_PREVIEW_FRAME,
  UI_ROTATE_TOKEN,
  UI_SET_PREVIEW,
  UI_SET_SETTINGS,
  UI_STATE,
  UI_VCAM_ERROR,
  type PreviewFrame,
  type StatePatch,
  type UiApi,
} from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: UiApi = {
  getState: () => ipcRenderer.invoke(UI_GET_STATE),
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(UI_SET_SETTINGS, patch),
  control: (msg: DesktopToPhone) => ipcRenderer.invoke(UI_CONTROL, msg),
  rotateToken: () => ipcRenderer.invoke(UI_ROTATE_TOKEN),
  disconnect: () => ipcRenderer.invoke(UI_DISCONNECT),
  setPreview: (enabled: boolean) => ipcRenderer.invoke(UI_SET_PREVIEW, enabled),
  openExternal: (url: string) => ipcRenderer.invoke(UI_OPEN_EXTERNAL, url),
  openLogs: () => ipcRenderer.invoke(UI_OPEN_LOGS),
  onState: (cb) => subscribe<StatePatch>(UI_STATE, cb),
  onPreviewFrame: (cb) => subscribe<PreviewFrame>(UI_PREVIEW_FRAME, cb),
  onPhoneMessage: (cb) => subscribe<PhoneToDesktop>('ui:phone-message', cb),
};

contextBridge.exposeInMainWorld('omnicam', api);
contextBridge.exposeInMainWorld('omnicamVcamError', {
  on: (cb: (msg: string) => void) => subscribe<string>(UI_VCAM_ERROR, cb),
});
