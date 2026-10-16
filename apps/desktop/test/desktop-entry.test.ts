import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { autostartEntry, autostartPath, execLine, quoteExecArg } from '../src/platform/desktop-entry.ts';
import { parseBooleanReply } from '../src/platform/dbus.ts';

describe('quoteExecArg', () => {
  test('plain paths and flags stay as they are', () => {
    assert.equal(quoteExecArg('/opt/OmniCam/omnicam'), '/opt/OmniCam/omnicam');
    assert.equal(quoteExecArg('--hidden'), '--hidden');
  });

  test('reserved characters quote the argument', () => {
    assert.equal(quoteExecArg('/home/a/My Apps/OmniCam.AppImage'), '"/home/a/My Apps/OmniCam.AppImage"');
    assert.equal(quoteExecArg("/home/o'neil/x"), `"/home/o'neil/x"`);
    assert.equal(quoteExecArg('/a(1)/x'), '"/a(1)/x"');
    assert.equal(quoteExecArg(''), '""');
  });

  test('inside quotes ", `, $ and \\ take a backslash', () => {
    assert.equal(quoteExecArg('/a/$HOME/"x"/`y`/b\\c'), '"/a/\\$HOME/\\"x\\"/\\`y\\`/b\\\\c"');
  });

  test('% is doubled so it never reads as a field code', () => {
    assert.equal(quoteExecArg('/a/100%u'), '/a/100%%u');
  });
});

describe('execLine', () => {
  test('backslashes are escaped once more for the string value', () => {
    // The spec's own example: a literal backslash in a quoted argument is written as four.
    assert.equal(execLine(['/a\\b']), '"/a\\\\\\\\b"');
    assert.equal(execLine(['/a/$x']), '"/a/\\\\$x"');
  });

  test('joins arguments with spaces', () => {
    assert.equal(execLine(['/home/a/OmniCam-2.1.0.AppImage', '--hidden']), '/home/a/OmniCam-2.1.0.AppImage --hidden');
    assert.equal(execLine(['/home/a/My Apps/o.AppImage', '--hidden']), '"/home/a/My Apps/o.AppImage" --hidden');
  });
});

describe('autostartEntry', () => {
  test('a complete entry that starts hidden', () => {
    const text = autostartEntry(['/opt/OmniCam/omnicam', '--hidden']);
    assert.match(text, /^\[Desktop Entry\]\n/);
    assert.match(text, /\nType=Application\n/);
    assert.match(text, /\nName=OmniCam\n/);
    assert.match(text, /\nExec=\/opt\/OmniCam\/omnicam --hidden\n/);
    assert.match(text, /\nX-GNOME-Autostart-enabled=true\n$/);
  });
});

describe('autostartPath', () => {
  test('XDG_CONFIG_HOME when it is absolute, ~/.config otherwise', () => {
    assert.equal(autostartPath('/home/a/cfg', '/home/a'), '/home/a/cfg/autostart/omnicam.desktop');
    assert.equal(autostartPath('/home/a/cfg/', '/home/a'), '/home/a/cfg/autostart/omnicam.desktop');
    assert.equal(autostartPath(undefined, '/home/a'), '/home/a/.config/autostart/omnicam.desktop');
    assert.equal(autostartPath('', '/home/a'), '/home/a/.config/autostart/omnicam.desktop');
    assert.equal(autostartPath('cfg', '/home/a'), '/home/a/.config/autostart/omnicam.desktop');
  });
});

describe('parseBooleanReply', () => {
  test("gdbus's GVariant tuple", () => {
    assert.equal(parseBooleanReply('(true,)\n'), true);
    assert.equal(parseBooleanReply('(false,)\n'), false);
  });

  test('anything else is false', () => {
    assert.equal(parseBooleanReply(''), false);
    assert.equal(parseBooleanReply('Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown'), false);
    assert.equal(parseBooleanReply('(true, false)'), false);
  });
});
