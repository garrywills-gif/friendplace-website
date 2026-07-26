'use client';

/**
 * A quiet suggestion card that lives on any surface where George could
 * plausibly offer help. Selecting it opens the dedicated conversation
 * surface at `/admin/george/new-event` (in Mission Control) or the
 * equivalent on other surfaces — pass `href` if you want to override.
 */

import Link from 'next/link';

interface Props {
  href?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  headline?: string;
  body?: string;
  primaryLabel?: string;
}

export function GeorgeSuggestionCard({
  href = '/admin/george/new-event',
  secondaryHref = '/admin/george',
  secondaryLabel = "Or open George’s Workspace",
  headline = 'Would you like to create something today?',
  body = "If you’ve got an event forming in your head, tell me about it and I’ll put a full draft together for you to look at.",
  primaryLabel = 'Talk to George about an event',
}: Props) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <div style={butterflyCircle} aria-hidden>🦋</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{headline}</div>
      </div>
      <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.55, marginBottom: 12 }}>{body}</div>
      <Link href={href} style={btn}>{primaryLabel}</Link>
      {secondaryHref && (
        <Link href={secondaryHref} style={secondaryLink}>{secondaryLabel}</Link>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'linear-gradient(180deg,#F0FDFA 0%,#FFFFFF 100%)',
  border: '1px solid #CCFBF1', borderRadius: 16,
  padding: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
};
const butterflyCircle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 17, flexShrink: 0,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 18, filter: 'drop-shadow(0 4px 8px rgba(20,184,166,0.35))',
};
const btn: React.CSSProperties = {
  display: 'block', textAlign: 'center', textDecoration: 'none',
  padding: '10px 14px', borderRadius: 10,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', fontWeight: 800, fontSize: 13,
};
const secondaryLink: React.CSSProperties = {
  display: 'block', textAlign: 'center', textDecoration: 'none',
  marginTop: 8, fontSize: 12, color: '#0F766E', fontWeight: 700,
};
