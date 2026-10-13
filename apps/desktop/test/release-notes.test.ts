import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { changelogSection, markdownToHtml } from '../build/release-notes.ts';

const CHANGELOG = `# Changelog

## Unreleased

- Something new.

## 1.2.0 — 2026-09-01

A short intro that
wraps.

### New
- **Bold lead.** Text that wraps
  onto a second line, with *italics*, \`code\` and a [link](https://example.com/a?b=1&c=2).
- Second <thing>.

### Fixes
- A fix.

## 1.1.0 — 2026-08-01

- Older.
`;

describe('changelogSection', () => {
  test('the version asked for, without its heading or the next section', () => {
    const s = changelogSection(CHANGELOG, '1.2.0');
    assert.ok(s.startsWith('A short intro'));
    assert.ok(s.includes('- A fix.'));
    assert.ok(!s.includes('Older') && !s.includes('Something new') && !/^## /m.test(s));
  });

  test('the last section runs to the end, and a missing version is empty', () => {
    assert.equal(changelogSection(CHANGELOG, '1.1.0'), '- Older.');
    assert.equal(changelogSection(CHANGELOG, '1.0.0'), '');
    assert.equal(changelogSection(CHANGELOG, '1.2'), '', 'a prefix is not a version');
  });
});

describe('markdownToHtml', () => {
  const html = markdownToHtml(changelogSection(CHANGELOG, '1.2.0'));

  test('paragraphs and bullets join their wrapped lines', () => {
    assert.ok(html.includes('<p>A short intro that wraps.</p>'));
    assert.ok(html.includes('Text that wraps onto a second line'));
  });

  test('headings, lists and inline marks', () => {
    assert.equal((html.match(/<h3>/g) ?? []).length, 2);
    assert.equal((html.match(/<ul>/g) ?? []).length, 2);
    assert.equal((html.match(/<li>/g) ?? []).length, 3);
    assert.ok(html.includes('<strong>Bold lead.</strong>'));
    assert.ok(html.includes('<em>italics</em>') && html.includes('<code>code</code>'));
    assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=2">link</a>'));
  });

  test('text never becomes markup', () => {
    assert.ok(html.includes('Second &lt;thing&gt;.'));
  });

  test('the real CHANGELOG: every bullet of a released version comes through', () => {
    const real = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const section = changelogSection(real, '1.3.0');
    const real13 = markdownToHtml(section);
    assert.equal((real13.match(/<li>/g) ?? []).length, (section.match(/^- /gm) ?? []).length);
    assert.ok(real13.includes('<h3>New</h3>'));
  });
});
