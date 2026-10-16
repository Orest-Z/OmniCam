// A phone without a phone: opens the phone page in Chromium with its fake camera (a moving pattern)
// and fake microphone (beeps), and starts streaming at once (&auto=1). Dev tool, never packaged.
// Usage: npx electron apps/desktop/test/e2e/fake-phone.cjs '<phone URL from the dev log>' [camera|both|mic]
const { app, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [url, mode = 'camera'] = process.argv.slice(2);
if (!url || !['camera', 'both', 'mic'].includes(mode)) {
  console.error("usage: electron fake-phone.cjs '<phone URL>' [camera|both|mic]");
  process.exit(2);
}

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
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
});
app.on('window-all-closed', () => app.quit());
