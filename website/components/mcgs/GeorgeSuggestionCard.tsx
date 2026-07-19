'use client';

/**
 * A quiet suggestion card that lives on the Bridge and offers to help
 * the admin create an event. Selecting it opens the dedicated chat
 * surface at /admin/george/new-event, keeping the Bridge uncluttered.
 *
 * Locked with Garry (19 July 2026):
 *  - Conversation happens in its own room, not embedded on the Bridge.
 *  - The Bridge should feel like Mission Control; the workspace is for
 *    focused creation with George.
 */

import Link from 'next/link';

export function GeorgeSuggestionCard() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <div style={butterflyCircle} aria-hidden>🦋</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
          Would you like to create something today?
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.55, marginBottom: 12 }}>
        If you&rsquo;ve got an event forming in your head, tell me about it and
        I&rsquo;ll put a full draft together for you to look at.
      </div>
      <Link
        href="/admin/george/new-event"
        style={btn}
      >
        Talk to George about an event
      </Link>
      <Link
        href="/admin/george"
        style={secondaryLink}
      >
        Or open George&rsquo;s Workspace
      </Link>
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
  marginTop: 8, fontSize: 12, color: '#0F766E',
  fontWeight: 700,
};
