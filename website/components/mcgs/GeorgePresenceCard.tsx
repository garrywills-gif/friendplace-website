'use client';

import { useEffect, useState } from 'react';

interface GeorgePresenceProps {
  onAsk?: (message?: string) => void;
}

const SUGGESTIONS = [
  "What needs my attention?",
  "Any safety concerns I should know about?",
  "How is FriendPlace performing this week?",
  "How many members joined in the last 7 days?",
];

/**
 * George's ambient presence card — sits in the right rail of The
 * Bridge (and any other MCGS view where the layout has room). Keeps
 * George visible as a companion, not hidden behind a button.
 */
export function GeorgePresenceCard({ onAsk }: GeorgePresenceProps) {
  const [suggestion, setSuggestion] = useState<string>(SUGGESTIONS[0]);

  useEffect(() => {
    // Rotate suggestions gently so the card feels alive.
    const id = setInterval(() => {
      setSuggestion(s => {
        const i = SUGGESTIONS.indexOf(s);
        return SUGGESTIONS[(i + 1) % SUGGESTIONS.length];
      });
    }, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={butterflyCircle} aria-hidden>🦋</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0F172A' }}>George</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            Grounded in live data. Always here if you need me.
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 14, padding: '10px 12px',
        background: '#F0FDFA', border: '1px solid #CCFBF1',
        borderRadius: 10, fontSize: 13, color: '#0F172A', lineHeight: 1.5,
      }}>
        Try: <em>“{suggestion}”</em>
      </div>

      <button
        type="button"
        onClick={() => onAsk?.(suggestion)}
        style={askBtn}
      >
        Ask George
      </button>

      <div style={helpRow}>
        <span>Tip: press <kbd style={kbd}>⌘K</kbd> from anywhere to focus the Ask George bar.</span>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16,
  padding: 18, boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
};
const butterflyCircle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 22, flexShrink: 0,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 22, filter: 'drop-shadow(0 4px 8px rgba(20,184,166,0.35))',
};
const askBtn: React.CSSProperties = {
  width: '100%', padding: '10px 14px', marginTop: 12,
  borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 14,
  color: '#FFFFFF', background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  cursor: 'pointer',
};
const helpRow: React.CSSProperties = {
  marginTop: 12, fontSize: 11, color: '#94A3B8', lineHeight: 1.5,
};
const kbd: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
  border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 5px',
  background: '#F8FAFC', color: '#334155',
};
