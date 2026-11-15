import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { cameraIndex } from '../src/main/pairing-guard.ts';
import { elevatedScript, encoded, launcherScript, UAC_CANCELLED } from '../src/platform/extra-cameras-win.ts';
import { rotationOf, rotationPatch } from '../src/shared/ipc.ts';

describe('each camera has its own rotation', () => {
  test('camera 1 keeps the old setting; a missing entry is 0', () => {
    assert.equal(rotationOf({ rotation: 90, extraRotations: [] }, 0), 90);
    assert.equal(rotationOf({ rotation: 90, extraRotations: [] }, 2), 0);
    assert.equal(rotationOf({ rotation: 0, extraRotations: [0, 270, 0] }, 2), 270);
  });

  test('turning one camera leaves the others alone', () => {
    assert.deepEqual(rotationPatch({ extraRotations: [90] }, 0, 180), { rotation: 180 });
    assert.deepEqual(rotationPatch({ extraRotations: [90] }, 3, 270), { extraRotations: [90, 0, 270] });
  });
});

describe('cameraIndex: which camera a phone may have', () => {
  test('no camera named is camera 1, as every phone before extra cameras', () => {
    assert.equal(cameraIndex(undefined, false), 0);
    assert.equal(cameraIndex(null, true), 0);
  });

  test('camera 1 always exists', () => {
    assert.equal(cameraIndex(1, false), 0);
    assert.equal(cameraIndex('1', false), 0);
  });

  test('cameras 2 to 4 exist only while Extra cameras is on', () => {
    for (const n of [2, 3, 4]) {
      assert.equal(cameraIndex(n, true), n - 1);
      assert.equal(cameraIndex(String(n), true), n - 1);
      assert.equal(cameraIndex(n, false), null);
      assert.equal(cameraIndex(String(n), false), null);
    }
  });

  test('anything else is refused, never rounded to a camera', () => {
    for (const bad of [0, 5, -1, 1.5, NaN, Infinity, '0', '5', '02', '2 ', ' 2', '2.0', '1e0', '', 'x', true, {}, [2], '__proto__']) {
      assert.equal(cameraIndex(bad, true), null, JSON.stringify(bad));
    }
  });
});

describe('extra cameras on Windows: the elevated regsvr32 step', () => {
  const root = 'C:\\Windows';

  test('lists the extra cameras with both DLLs, each with the regsvr32 of its own bitness', () => {
    const script = elevatedScript(true, 'C:\\Program Files\\OmniCam\\resources\\native', root);
    assert.match(script, /'C:\\Windows\\System32\\regsvr32\.exe' -ArgumentList \('\/s \/n \/i:extra "' \+ 'C:\\Program Files\\OmniCam\\resources\\native\\omnicam_vcam\.dll' \+ '"'\)/);
    assert.match(script, /'C:\\Windows\\SysWOW64\\regsvr32\.exe' -ArgumentList \('\/s \/n \/i:extra "' \+ 'C:\\Program Files\\OmniCam\\resources\\native\\x86\\omnicam_vcam\.dll' \+ '"'\)/);
    assert.match(script, /exit \$code$/);
  });

  test('removing them unlists only the extra cameras', () => {
    const script = elevatedScript(false, 'C:\\x', root);
    assert.equal(script.match(/\/s \/u \/n \/i:extra/g)?.length, 2);
  });

  test("a quote in the install path can't end the string it is in", () => {
    const script = elevatedScript(true, "C:\\Users\\O'Brien'; calc; '\\native", root);
    assert.ok(script.includes("'C:\\Users\\O''Brien''; calc; ''\\native\\omnicam_vcam.dll'"));
    // Every quote of the path is doubled: none is left on its own to close the string early.
    assert.equal(script.includes("O'Brien"), false);
  });

  test('the launcher passes the elevated script encoded, and reports a dismissed prompt', () => {
    const elevated = elevatedScript(true, 'C:\\x', root);
    const launcher = launcherScript('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', elevated);
    assert.ok(launcher.includes(`-EncodedCommand ${encoded(elevated)}'`));
    assert.match(launcher, /-Verb RunAs/);
    assert.ok(launcher.includes(`catch { exit ${UAC_CANCELLED} }`));
    assert.equal(Buffer.from(encoded(elevated), 'base64').toString('utf16le'), elevated);
  });
});
