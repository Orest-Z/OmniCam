import { Fragment, type ReactNode } from 'react';
import { Sparkles, Trash2, Wrench, type LucideIcon } from 'lucide-react';
import type { ReleaseNote } from '../../shared/ipc';

/** An icon for each kind of CHANGELOG heading. */
const KINDS: [RegExp, LucideIcon][] = [
  [/new|added/i, Sparkles],
  [/fix/i, Wrench],
  [/remov/i, Trash2],
];

/**
 * What the versions on offer bring, as a feed inside the app. The notes are GitHub's HTML of each
 * CHANGELOG section, from the internet: they are parsed inert (DOMParser runs no scripts and loads
 * nothing) and rebuilt from their text and a handful of tags, never inserted as HTML.
 */
export function ReleaseNotes({ notes }: { notes: ReleaseNote[] }) {
  return (
    <div className="notes">
      {notes.map((n) => (
        <section key={n.version}>
          {notes.length > 1 && <h4 className="ver">OmniCam {n.version}</h4>}
          {render(new DOMParser().parseFromString(n.html, 'text/html').body)}
        </section>
      ))}
    </div>
  );
}

function render(node: Node, key = 0): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const kids = [...el.childNodes].map((child, i) => render(child, i));
  switch (el.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4': {
      const Icon = KINDS.find(([re]) => re.test(el.textContent ?? ''))?.[1];
      return (
        <h5 key={key} className="kind">
          {Icon && <Icon />}
          {el.textContent?.trim()}
        </h5>
      );
    }
    case 'P':
      return <p key={key}>{kids}</p>;
    case 'UL':
      return <ul key={key}>{kids}</ul>;
    case 'OL':
      return <ol key={key}>{kids}</ol>;
    case 'LI':
      return <li key={key}>{kids}</li>;
    case 'STRONG':
    case 'B':
      return <strong key={key}>{kids}</strong>;
    case 'EM':
    case 'I':
      return <em key={key}>{kids}</em>;
    case 'CODE':
      return <code key={key}>{kids}</code>;
    case 'BR':
      // GitHub keeps CHANGELOG.md's hard wraps as line breaks; here the text reflows to the dialog instead.
      return ' ';
    case 'A': {
      // Web links open in the browser; GitHub's heading anchors and anything else keep only their text.
      const href = el.getAttribute('href') ?? '';
      return /^https:\/\//.test(href) ? (
        <button key={key} className="link" onClick={() => void window.omnicam.openExternal(href)}>
          {kids}
        </button>
      ) : (
        <Fragment key={key}>{kids}</Fragment>
      );
    }
    default:
      // div, span, svg, img…: their text only (an image never loads).
      return <Fragment key={key}>{kids}</Fragment>;
  }
}
