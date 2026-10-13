/**
 * "What's new" for the version being built: its CHANGELOG.md section as HTML, baked into the UI by
 * electron.vite.config.ts and shown once after an update. CHANGELOG.md uses a small part of Markdown:
 * ### headings, paragraphs, "- " bullets whose lines wrap, **bold**, *italic*, `code` and https links.
 * The UI rebuilds the result from its text (ReleaseNotes.tsx), so it is not trusted as HTML there either.
 */

/** The section under "## <version>", up to the next "## ", without its heading; empty if there is none. */
export function changelogSection(changelog: string, version: string): string {
  const heading = new RegExp(`^##\\s+${version.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}(?![\\w.]).*$`, 'm').exec(changelog);
  if (!heading) return '';
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = rest.search(/^##\s/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  let inList = false;
  let block: { tag: 'li' | 'p'; text: string } | null = null;
  const close = (endList: boolean) => {
    if (block) out.push(`<${block.tag}>${inline(block.text)}</${block.tag}>`);
    block = null;
    if (endList && inList) out.push('</ul>');
    if (endList) inList = false;
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      close(true);
      out.push(`<h3>${inline(heading[1])}</h3>`);
    } else if (bullet) {
      close(false);
      if (!inList) out.push('<ul>');
      inList = true;
      block = { tag: 'li', text: bullet[1] };
    } else if (!line.trim()) {
      close(true);
    } else if (block) {
      block.text += ' ' + line.trim(); // a wrapped line continues its bullet or paragraph
    } else {
      close(true);
      block = { tag: 'p', text: line.trim() };
    }
  }
  close(true);
  return out.join('\n');
}
