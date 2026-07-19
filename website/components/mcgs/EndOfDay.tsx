'use client';

/**
 * EndOfDay — Bridge card for MCGS Phase 2 Milestone E.
 *
 * The evening rhythm — reflection and closure. Cool indigo/dusk styling
 * so The Bridge reads as three emotional temperatures across the day:
 *   morning = calm guidance (teal)
 *   midday  = gentle nudge   (amber, only when needed)
 *   evening = reflection     (dusk indigo)
 *
 * Silent when the day has been explicitly skipped (Garry stayed active
 * past the cutoff) — the "considerate, not scheduler" rule applies to
 * the UI as much as the backend.
 */

import { useCallback, useEffect, useState } from 'react';
import { rhythmsApi, type BriefingRow } from '@/lib/mcgs-api';

interface Props {
  onAsk?: (message: string) => void;
}

interface EodContent {
  heading?: string;
  opener_line?: string | null;
  today_line?: string;
  acknowledgment_line?: string | null;
  community_line?: string | null;
  open_line?: string | null;
  sign_off_line?: string;
}

export function EndOfDay({ onAsk }: Props) {
  const [eod, setEod] = useState<BriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await rhythmsApi.today();
      const wrap = res.items.find(
        (r) => r.rhythm_type === 'eod' && r.status !== 'skipped',
      ) || null;
      setEod(wrap);
      if (wrap?.bridge_acknowledged_at) setDismissed(true);
    } catch {
      /* silent — the card just doesn't render */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const acknowledge = useCallback(async () => {
    if (!eod) return;
    setDismissed(true);
    try { await rhythmsApi.acknowledge(eod.id); } catch { /* no-op */ }
  }, [eod]);

  if (loading || !eod || dismissed) return null;

  const c = (eod.content_json as unknown as EodContent) || {};
  const heading = (c.heading || 'Before you go\u2026').toUpperCase();
  const at = eod.delivered_at
    ? new Date(eod.delivered_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <section style={eodCard} aria-labelledby="eod-heading">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22 }} aria-hidden>🌙</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div id="eod-heading" style={eyebrow}>{heading}</div>
            {at && (
              <span style={{ fontSize: 11, color: '#C7D2FE', fontWeight: 600 }}>{at}</span>
            )}
          </div>

          {c.opener_line && (
            <div style={{ ...bodyText, marginTop: 10, fontSize: 15, fontStyle: 'italic', color: '#E0E7FF' }}>
              {c.opener_line}
            </div>
          )}

          {c.today_line && (
            <div style={{ ...bodyText, marginTop: 12 }}>
              {c.today_line}
            </div>
          )}

          {c.acknowledgment_line && (
            <div style={ackLine}>
              {c.acknowledgment_line}
            </div>
          )}

          {c.community_line && (
            <div style={{ ...bodyText, marginTop: 10, color: '#FEF3C7', fontStyle: 'italic' }}>
              ✨ {c.community_line}
            </div>
          )}

          {c.open_line && (
            <div style={{ ...bodyText, marginTop: 10, color: '#C7D2FE' }}>
              {c.open_line}
            </div>
          )}

          {c.sign_off_line && (
            <div style={signOff}>
              {c.sign_off_line}
              <span style={{ marginLeft: 8, color: '#A5B4FC' }}>— George</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button onClick={acknowledge} style={primaryBtn}>Good night</button>
            {onAsk && (
              <button
                onClick={() => onAsk('Give me a fuller wrap of today.')}
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

// ---------- Styles ----------

const eodCard: React.CSSProperties = {
  background: 'linear-gradient(180deg,#312E81,#1E1B4B)',
  border: '1px solid #4338CA',
  borderRadius: 16,
  padding: 20,
  marginBottom: 20,
  boxShadow: '0 6px 20px rgba(30,27,75,0.35)',
  color: '#E0E7FF',
};
const eyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, color: '#C7D2FE', letterSpacing: '0.05em',
};
const bodyText: React.CSSProperties = { fontSize: 15, color: '#E0E7FF', lineHeight: 1.6 };
const signOff: React.CSSProperties = {
  ...bodyText,
  marginTop: 14,
  paddingTop: 12,
  borderTop: '1px solid #4338CA',
  fontStyle: 'italic',
  color: '#C7D2FE',
};
const ackLine: React.CSSProperties = {
  ...bodyText,
  marginTop: 12,
  padding: '10px 14px',
  background: 'rgba(199, 210, 254, 0.12)',
  border: '1px solid #4338CA',
  borderRadius: 12,
  color: '#E0E7FF',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700,
  background: '#E0E7FF', color: '#312E81', border: '1px solid #E0E7FF',
  cursor: 'pointer',
};
const pillBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: 'transparent', border: '1px solid #4338CA', color: '#C7D2FE',
  cursor: 'pointer',
};
