'use client';

/**
 * MiddayPulse — Bridge card for MCGS Phase 2 Milestone D.
 *
 * Silent by default. Renders only when a Midday Pulse has fired today
 * (i.e. something material changed since the Morning Briefing). Never
 * takes up Bridge real estate when there's nothing to say — silence is
 * a feature.
 */

import { useCallback, useEffect, useState } from 'react';
import { rhythmsApi, type BriefingRow } from '@/lib/mcgs-api';

interface Props {
  onAsk?: (message: string) => void;
}

export function MiddayPulse({ onAsk }: Props) {
  const [pulse, setPulse] = useState<BriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await rhythmsApi.today();
      const midday = res.items.find((r) => r.rhythm_type === 'midday') || null;
      setPulse(midday);
      if (midday?.bridge_acknowledged_at) setDismissed(true);
    } catch {
      /* silent — the card just doesn't render */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const acknowledge = useCallback(async () => {
    if (!pulse) return;
    setDismissed(true);
    try { await rhythmsApi.acknowledge(pulse.id); } catch { /* no-op */ }
  }, [pulse]);

  // Silence is a feature: no pulse, no card.
  if (loading || !pulse || dismissed) return null;

  const c = pulse.content_json as unknown as {
    heading?: string;
    opener_line: string;
    body_line?: string | null;
    recommendation?: string;
    recommendation_heading?: string;
    reassurance_line?: string | null;
  };
  const heading = (c.heading || 'A quick update').toUpperCase();
  const at = pulse.delivered_at
    ? new Date(pulse.delivered_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <section style={pulseCard} aria-labelledby="midday-pulse-heading">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22 }} aria-hidden>🦋</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div id="midday-pulse-heading" style={eyebrow}>{heading}</div>
            {at && (
              <span style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>{at}</span>
            )}
          </div>
          <div style={{ ...bodyText, marginTop: 8, fontSize: 15, color: '#0F172A' }}>
            {c.opener_line}
          </div>
          {c.body_line && (
            <div style={{ ...bodyText, marginTop: 6, color: '#334155' }}>
              {c.body_line}
            </div>
          )}
          {c.recommendation && (
            <div style={{ marginTop: 12 }}>
              <div style={sectionHeading}>{c.recommendation_heading || 'One thing I\u2019d do'}</div>
              <div style={recBox}>{c.recommendation}</div>
            </div>
          )}
          {c.reassurance_line && (
            <div style={reassureLine}>
              {c.reassurance_line}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={acknowledge} style={primaryBtn}>Got it</button>
            {onAsk && (
              <button
                onClick={() => onAsk(c.recommendation || 'Tell me more about what changed since this morning.')}
                style={pillBtn}
              >
                Ask George more
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Styles (softer amber accent so it reads as a nudge, not an alert) ----------

const pulseCard: React.CSSProperties = {
  background: 'linear-gradient(180deg,#FFFFFF,#FEF3C7)',
  border: '1px solid #FDE68A',
  borderRadius: 16,
  padding: 18,
  marginBottom: 20,
  boxShadow: '0 4px 16px rgba(180,83,9,0.06)',
};
const eyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, color: '#B45309', letterSpacing: '0.05em',
};
const bodyText: React.CSSProperties = { fontSize: 15, color: '#0F172A', lineHeight: 1.6 };
const sectionHeading: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, color: '#0F172A', letterSpacing: '0.02em', marginBottom: 6,
};
const recBox: React.CSSProperties = {
  ...bodyText,
  background: '#FFFFFF',
  border: '1px solid #FDE68A',
  borderRadius: 12,
  padding: '10px 14px',
};
const reassureLine: React.CSSProperties = {
  ...bodyText,
  marginTop: 12,
  fontSize: 14,
  fontStyle: 'italic',
  color: '#78350F',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700,
  background: '#B45309', color: '#FFFFFF', border: '1px solid #B45309',
  cursor: 'pointer',
};
const pillBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: '#FFFFFF', border: '1px solid #FDE68A', color: '#B45309',
  cursor: 'pointer',
};
