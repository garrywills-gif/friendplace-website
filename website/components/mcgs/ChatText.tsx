'use client';

/**
 * ChatText — renders George's assistant text with two safety layers:
 *
 *   1. Markdown-style action links `[LABEL](#action:type[?params])` are
 *      turned into inline clickable buttons that trigger the associated
 *      router action instead of showing raw markdown to Garry. This
 *      fixes the iter158 bug where George was streaming
 *      "[Open in Flyer Publishing Centre](#action:open_flyer_centre)"
 *      as literal text.
 *
 *   2. Plain Markdown links `[LABEL](url)` are rendered as normal
 *      anchors (target=_blank) so any real URLs George emits still
 *      work — but we do NOT parse bold/italic/headings, because
 *      George's system prompt asks him to speak in plain prose.
 *
 * Anything the parser doesn't recognise is passed through verbatim so
 * whitespace, punctuation, ellipses and the streaming cursor keep
 * working exactly as before.
 *
 * The action registry is intentionally small and centralised — every
 * `#action:` type must be listed here or it's stripped as unknown.
 */

import React, { Fragment, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// ---- Action registry ------------------------------------------------------
// New George actions must be registered here + in the backend prompt.
// The registry maps `type` (the bit after `#action:`) to a builder
// that returns the router URL to navigate to. Any params are parsed
// from the query-string portion (`type?a=1&b=2`) and passed in.
const ACTION_URL_BUILDERS: Record<string, (params: URLSearchParams) => string | null> = {
  // Open the Flyer Publishing Centre for a specific template + layout.
  open_flyer_centre: (p) => {
    const key = p.get('template') || p.get('key') || 'founding_member_invite';
    const layout = p.get('layout') || 'poster_a4';
    const fields = p.get('fields') || '';
    const qs = new URLSearchParams({ open: 'preview', layout });
    if (fields) qs.set('fields', fields);
    return `/admin/flyers/${encodeURIComponent(key)}?${qs.toString()}`;
  },
  // Open the marketing Send Email screen (optionally pre-filled).
  open_send_email: (p) => {
    const qs = new URLSearchParams();
    for (const [k, v] of p.entries()) qs.set(k, v);
    const s = qs.toString();
    return s ? `/admin/marketing/send?${s}` : '/admin/marketing/send';
  },
  // Generic navigate action.
  navigate: (p) => p.get('to') || p.get('url') || null,
};

const ACTION_LINK_RE = /\[([^\]]+?)\]\(#action:([a-z_][a-z0-9_]*)(\?[^)]*)?\)/gi;
const PLAIN_LINK_RE  = /\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/gi;

export function ChatText({ content }: { content: string }) {
  const router = useRouter();
  if (!content) return null;

  const tokens = parse(content);

  return (
    <Fragment>
      {tokens.map((tok, i) => {
        if (tok.kind === 'text') return <Fragment key={i}>{tok.value}</Fragment>;
        if (tok.kind === 'action') {
          const build = ACTION_URL_BUILDERS[tok.type];
          const url = build ? build(new URLSearchParams(tok.query)) : null;
          if (!url) {
            // Unknown or malformed action — fall back to plain label so
            // Garry never sees raw #action: syntax.
            return <Fragment key={i}>{tok.label}</Fragment>;
          }
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                try { router.push(url); } catch { try { window.location.assign(url); } catch { /* noop */ } }
              }}
              style={inlineActionBtn}
              aria-label={tok.label}
            >{tok.label} →</button>
          );
        }
        // Plain markdown link — render as external anchor.
        return (
          <a
            key={i}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            style={anchorStyle}
          >{tok.label}</a>
        );
      })}
    </Fragment>
  );
}

// ---- Tokeniser ------------------------------------------------------------
type Tok =
  | { kind: 'text';   value: string }
  | { kind: 'action'; label: string; type: string; query: string }
  | { kind: 'link';   label: string; href: string };

function parse(content: string): Tok[] {
  // Collect all matches from both regexes, in order. We can't do it in
  // a single regex without capturing-group gymnastics, so we scan both
  // and merge by index.
  type Hit = { start: number; end: number; tok: Tok };
  const hits: Hit[] = [];
  content.replace(ACTION_LINK_RE, (match, label, type, query, offset: number) => {
    hits.push({
      start: offset,
      end:   offset + match.length,
      tok:   { kind: 'action', label, type: String(type).toLowerCase(), query: (query || '').replace(/^\?/, '') },
    });
    return match;
  });
  content.replace(PLAIN_LINK_RE, (match, label, href, offset: number) => {
    // Skip if this range is already covered by an action-link hit
    // (an unlikely double-match anyway — action links have `#action:` not http).
    if (hits.some((h) => offset >= h.start && offset < h.end)) return match;
    hits.push({
      start: offset,
      end:   offset + match.length,
      tok:   { kind: 'link', label, href },
    });
    return match;
  });
  hits.sort((a, b) => a.start - b.start);

  const out: Tok[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) {
      out.push({ kind: 'text', value: content.slice(cursor, h.start) });
    }
    out.push(h.tok);
    cursor = h.end;
  }
  if (cursor < content.length) {
    out.push({ kind: 'text', value: content.slice(cursor) });
  }
  return out;
}

// ---- Styles ---------------------------------------------------------------
const inlineActionBtn: React.CSSProperties = {
  display: 'inline-block',
  background: '#0D9488',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  padding: '4px 12px',
  fontSize: 13,
  fontWeight: 700,
  margin: '0 2px',
  cursor: 'pointer',
  lineHeight: 1.3,
  verticalAlign: 'baseline',
};
const anchorStyle: React.CSSProperties = {
  color: '#0F766E',
  textDecoration: 'underline',
  fontWeight: 600,
};
