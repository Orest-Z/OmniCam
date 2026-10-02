import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AttemptBudget, resolvePhoneFile, tokenMatches } from '../src/main/pairing-guard.ts';

describe('tokenMatches', () => {
  const token = 'q1W2e3R4t5Y6u7I8o9P0aA'; // same shape as the app's: 16 random bytes, base64url

  test('accepts the exact token', () => {
    assert.equal(tokenMatches(token, token), true);
  });

  test('rejects a different token of the same length', () => {
    assert.equal(tokenMatches(token.replace('q', 'x'), token), false);
  });

  test('rejects shorter, longer and empty tokens', () => {
    assert.equal(tokenMatches(token.slice(1), token), false);
    assert.equal(tokenMatches(token + 'x', token), false);
    assert.equal(tokenMatches('', token), false);
  });

  test('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, [token], Buffer.from(token)]) {
      assert.equal(tokenMatches(value, token), false);
    }
  });

  test('rejects, without throwing, a token of equal length in characters but not in bytes', () => {
    // 22 UTF-16 units like the real token, but "é" is two UTF-8 bytes: this used to make
    // timingSafeEqual throw, and the server answered 500 instead of 403.
    const sameLength = 'é'.repeat(token.length);
    assert.equal(sameLength.length, token.length);
    assert.doesNotThrow(() => tokenMatches(sameLength, token));
    assert.equal(tokenMatches(sameLength, token), false);
  });
});

describe('resolvePhoneFile', () => {
  let parent: string;
  let root: string;

  before(() => {
    parent = mkdtempSync(join(tmpdir(), 'omnicam-test-'));
    root = join(parent, 'phone');
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    writeFileSync(join(root, 'app.js'), '');
    // A sibling whose name starts with the root's: a string-prefix check would let it through.
    mkdirSync(join(parent, 'phone-old'));
    writeFileSync(join(parent, 'phone-old', 'secret.txt'), 'nope');
    writeFileSync(join(parent, 'secret.txt'), 'nope');
  });

  after(() => rmSync(parent, { recursive: true, force: true }));

  test('serves index.html for /', () => {
    assert.equal(resolvePhoneFile(root, '/'), join(root, 'index.html'));
  });

  test('serves a file that exists', () => {
    assert.equal(resolvePhoneFile(root, '/app.js'), join(root, 'app.js'));
  });

  test('works with a trailing separator on the root', () => {
    assert.equal(resolvePhoneFile(root + '/', '/app.js'), join(root, 'app.js'));
  });

  test('falls back to index.html for an extension-less deep link', () => {
    assert.equal(resolvePhoneFile(root, '/some/deep/link'), join(root, 'index.html'));
  });

  test('refuses a missing file with an extension', () => {
    assert.equal(resolvePhoneFile(root, '/missing.js'), null);
  });

  test('never serves a directory', () => {
    // An existing directory is not a file: it falls back to the page instead of streaming a directory.
    assert.equal(resolvePhoneFile(root, '/assets'), join(root, 'index.html'));
  });

  test('stays inside the root on traversal attempts', () => {
    for (const path of [
      '/../secret.txt',
      '/../../secret.txt',
      '/assets/../../secret.txt',
      '/..\\secret.txt',
      '/../phone-old/secret.txt',
      '\\..\\secret.txt',
    ]) {
      const file = resolvePhoneFile(root, path);
      assert.ok(file === null || file.startsWith(join(root, '/')), `${path} resolved to ${file}`);
      assert.ok(!file?.endsWith('secret.txt'), `${path} reached ${file}`);
    }
  });
});

describe('AttemptBudget', () => {
  test('allows up to the burst inside the window, then refuses', () => {
    const budget = new AttemptBudget(3, 60_000);
    assert.deepEqual([0, 1, 2, 3].map((i) => budget.allow('10.0.0.2', 1000 + i)), [true, true, true, false]);
  });

  test('allows again once old attempts leave the window', () => {
    const budget = new AttemptBudget(2, 60_000);
    budget.allow('10.0.0.2', 0);
    budget.allow('10.0.0.2', 1);
    assert.equal(budget.allow('10.0.0.2', 59_999), false);
    assert.equal(budget.allow('10.0.0.2', 60_001), true);
  });

  test('refused attempts do not extend the lockout', () => {
    const budget = new AttemptBudget(1, 60_000);
    budget.allow('10.0.0.2', 0);
    for (let t = 1; t < 60_000; t += 5_000) budget.allow('10.0.0.2', t); // a phone retrying while locked out
    assert.equal(budget.allow('10.0.0.2', 60_000), true);
  });

  test('clients have separate budgets', () => {
    const budget = new AttemptBudget(1, 60_000);
    assert.equal(budget.allow('10.0.0.2', 0), true);
    assert.equal(budget.allow('10.0.0.3', 0), true);
    assert.equal(budget.allow('10.0.0.2', 1), false);
  });

  test('forgets idle clients so the map stays bounded', () => {
    const budget = new AttemptBudget(5, 1_000, 4);
    for (let i = 0; i < 10; i++) budget.allow(`10.0.0.${i}`, 0);
    budget.allow('10.0.1.1', 5_000);
    assert.equal(budget.trackedClients, 1);
  });

  test('cycling through addresses cannot clear a busy client', () => {
    const budget = new AttemptBudget(1, 60_000, 4);
    budget.allow('10.0.0.2', 0);
    for (let i = 0; i < 50; i++) budget.allow(`192.168.1.${i}`, 10);
    assert.equal(budget.allow('10.0.0.2', 20), false);
  });
});
