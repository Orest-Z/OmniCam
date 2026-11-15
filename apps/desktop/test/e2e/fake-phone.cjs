// A phone without a phone: opens the phone page in Chromium with its fake camera (a moving pattern)
// and fake microphone (beeps), and starts streaming at once (&auto=1). Dev tool, never packaged.
// Usage: npx electron apps/desktop/test/e2e/fake-phone.cjs '<phone URL from the dev log>' [camera|both|mic] [fps] [preset]
// fps: the fake camera's frame rate (Chromium's default is 20). preset: 480p, 720p, 720p60, 1080p or 4k, picked on the
// page once it streams, as a person would; `60 720p60` exercises the 60 fps path.
// Add &cam=2 (3, 4) to the URL to feed an extra camera; run one fake phone per camera.
// Add &link=1 to the URL to send over the media link instead of WebRTC.
// The URL can come from OMNICAM_PHONE_URL instead, leaving [camera|both|mic] [fps] [preset] as the arguments: some
// shells and launchers refuse to start a program with a URL on its command line.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const args = process.argv.slice(2);
const url = process.env.OMNICAM_PHONE_URL || args.shift();
const [mode = 'camera', fps = '', preset = ''] = args;
const PRESETS = ['', '480p', '720p', '720p60', '1080p', '4k'];
if (!url || (fps && !/^[1-9]\d?$/.test(fps)) || !PRESETS.includes(preset) || !['camera', 'both', 'mic'].includes(mode)) {
  console.error("usage: electron fake-phone.cjs '<phone URL>' [camera|both|mic] [fps] [preset]");
  process.exit(2);
}

if (fps) app.commandLine.appendSwitch('use-fake-device-for-media-stream', `fps=${fps}`);
else app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('ignore-certificate-errors'); // OmniCam's certificate is self-signed
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Its own profile, so it never shares a lock or storage with OmniCam or another fake phone.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'omnicam-fake-phone-')));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 420, height: 820, title: 'Fake phone', webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => console.log(`[phone] ${e.message}`));
  // The page keeps its mode in localStorage: set it, then load again with auto=1 to start.
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`localStorage.setItem('omnicam.mode', ${JSON.stringify(mode)})`);
  const start = new URL(url);
  start.searchParams.set('auto', '1');
  await win.loadURL(start.toString());
  console.log(`fake phone streaming (${mode})`);
  if (preset) {
    // Once the camera runs: the page's own resolution picker, so the phone tells the desktop as usual.
    await new Promise((r) => setTimeout(r, 4000));
    await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('res'); r.value = ${JSON.stringify(preset)}; r.dispatchEvent(new Event('change')); })()`);
    console.log(`fake phone switched to ${preset}`);
  }
});
app.on('window-all-closed', () => app.quit());
