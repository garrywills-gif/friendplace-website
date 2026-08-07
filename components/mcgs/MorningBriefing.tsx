'use client';

/**
 * MorningBriefing — Bridge card for MCGS Phase 2 Milestone B.
 *
 * Fetches today's Rhythm outputs, renders the morning briefing (if
 * present) as a pinned card. The Bridge is the source of truth — same
 * content will land in email/push in Milestone C, and this component
 * calls /seen so email dedup can respect "already read on the Bridge".
 *
 * Design principles honored (Garry, 19 July 2026):
 * - Rotating opener (rendered from `content_json.opener_line`).
 * - Relevance > completeness (sections that arrived empty aren't rendered).
 * - Always ends with "Where I'd start" (`recommendation`).
 * - Continuity line ("It stayed quiet overnight") when present.
 * - Milestones ("celebrated_moments") shown warmly, no confetti.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { rhythmsApi, type BriefingRow } from '@/lib/mcgs-api';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

interface Props {
  onAsk?: (message: string) => void;
}

// ---------- Rotating closing acknowledgements (Garry, 19 Jul 2026) ----------
// Appears sometimes (not every time) after "Got it, thanks" so George feels
// present without becoming performative.
const CLOSING_MESSAGES = [
  "I\u2019ll keep an eye on things.",
  "Have a great day.",
  "Just call if you need me.",
  "I\u2019ll let you know if anything important changes.",
  "I\u2019ll be here.",
  "Enjoy your morning.",
];

// Show ~65% of the time. Deterministic per briefing id so a single briefing
// always gives the same closing when re-opened (or no closing at all).
function pickClosing(briefingId: string): string | null {
  let h = 0;
  for (let i = 0; i < briefingId.length; i++) h = (h * 31 + briefingId.charCodeAt(i)) | 0;
  const bucket = ((h >>> 0) % 100);
  if (bucket >= 65) return null; // ~35% of the time: no closing at all
  const idx = ((h >>> 0) / 100 | 0) % CLOSING_MESSAGES.length;
  return CLOSING_MESSAGES[idx];
}

export function MorningBriefing({ onAsk }: Props) {
  const [briefing, setBriefing] = useState<BriefingRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const seenRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await rhythmsApi.today();
      const morning = res.items.find((r) => r.rhythm_type === 'morning') || null;
      setBriefing(morning);
      if (morning?.bridge_acknowledged_at) setDismissed(true);
    } catch (err) {
      setError((err as Error).message || 'Could not load your briefing');
    } finally {
      setLoading(false);
    }
  }, []);

  const compose = useCallback(async () => {
    try {
      setComposing(true);
      setError(null);
      const row = await rhythmsApi.composeMorning(false);
      setBriefing(row);
    } catch (err) {
      setError((err as Error).message || "George couldn't compose your briefing");
    } finally {
      setComposing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-mark seen once the briefing renders — this powers the
  // "don't re-email what Garry has already read on the Bridge" rule.
  useEffect(() => {
    if (!briefing || briefing.bridge_seen_at || seenRef.current) return;
    seenRef.current = true;
    rhythmsApi.markSeen(briefing.id).catch(() => {});
  }, [briefing]);

  const acknowledge = useCallback(async () => {
    if (!briefing) return;
    // Pick a rotating closing acknowledgement for this briefing. Appears
    // sometimes (not every time) so George feels present without being
    // performative (Garry, 19 Jul 2026).
    const line = pickClosing(briefing.id);
    if (line) setClosing(line);
    setDismissed(true);
    try {
      await rhythmsApi.acknowledge(briefing.id);
    } catch {
      // If it fails, no big deal — the pin is a soft UI hint.
    }
    // Fade the closing after a moment so it doesn't linger.
    if (line) {
      setTimeout(() => setClosing(null), 6000);
    }
  }, [briefing]);

  // 1. Loading skeleton — keep it quiet, don't yell "loading" at the user.
  if (loading) {
    return (
      <section style={skeletonCard} aria-live="polite" aria-busy="true">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ display: 'inline-flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }} aria-hidden><GeorgeButterflyMark size={26} /></span>
          <div style={{ flex: 1 }}>
            <div style={eyebrow}>MORNING BRIEFING</div>
            <div style={{ ...bodyText, color: '#94A3B8', marginTop: 8 }}>
              George is looking around before you arrive…
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 2. No briefing today yet — offer to compose one.
  if (!briefing) {
    return (
      <section style={emptyCard}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ display: 'inline-flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }} aria-hidden><GeorgeButterflyMark size={26} /></span>
          <div style={{ flex: 1 }}>
            <div style={eyebrow}>MORNING BRIEFING</div>
            <div style={{ ...bodyText, marginTop: 8 }}>
              No briefing yet for today. Once the scheduler is wired (Milestone C),
              this arrives at 7:00am on weekdays and 8:30am on weekends. In the
              meantime, ask George to compose one now.
            </div>
            {error && <div style={errText}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                onClick={compose}
                disabled={composing}
                style={{ ...primaryBtn, opacity: composing ? 0.6 : 1 }}
              >
                {composing ? 'Composing…' : 'Ask George to draft one now'}
              </button>
              {onAsk && (
                <button
                  onClick={() => onAsk('What needs my attention today?')}
                  style={pillBtn}
                >
                  What needs my attention today?
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 3. Acknowledged — collapsed pill so the Bridge feels clean. If
  //    George picked a warm closing for this briefing, render it as a
  //    quiet italic line above the pill until it fades.
  if (dismissed) {
    return (
      <div style={{ marginBottom: 20 }}>
        {closing && (
          <div style={closingLine} aria-live="polite">
            <span aria-hidden style={{ display: 'inline-flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}><GeorgeButterflyMark size={14} /></span>
            <span>{closing}</span>
            <span style={{ marginLeft: 8, color: '#94A3B8' }}>— George</span>
          </div>
        )}
        <section
          style={collapsedCard}
          onClick={() => { setDismissed(false); setClosing(null); }}
          role="button" tabIndex={0}
        >
          <span style={{ display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }} aria-hidden><GeorgeButterflyMark size={18} /></span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0F766E', letterSpacing: '0.03em' }}>
            MORNING BRIEFING · read
          </span>
          <span style={{ fontSize: 12, color: '#64748B', marginLeft: 'auto' }}>
            Tap to re-open
          </span>
        </section>
      </div>
    );
  }

  const c = briefing.content_json;
  const deliveredAt = briefing.delivered_at
    ? new Date(briefing.delivered_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  // 4. Full briefing — the North Star surface.
  return (
    <section style={briefingCard} aria-labelledby="morning-briefing-heading">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ display: 'inline-flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }} aria-hidden><GeorgeButterflyMark size={26} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div id="morning-briefing-heading" style={eyebrow}>MORNING BRIEFING</div>
            {deliveredAt && (
              <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>
                composed {deliveredAt}
              </span>
            )}
          </div>

          <div style={{ ...bodyText, marginTop: 10, fontSize: 16, fontWeight: 600, color: '#0F172A' }}>
            {c.opener_line}
          </div>

          {c.continuity_line && (
            <div style={{ ...bodyText, marginTop: 8, fontStyle: 'italic', color: '#334155' }}>
              {c.continuity_line}
            </div>
          )}

          {c.noticed_line && (
            <div style={noticedBox}>
              {c.noticed_line}
            </div>
          )}

          {c.sections?.map((s) => {
            if (!s.heading || !s.bullets?.length) return null;
            return (
              <div key={s.heading} style={{ marginTop: 14 }}>
                <div style={sectionHeading}>{s.heading}</div>
                <ul style={bulletList}>
                  {s.bullets.map((b, i) => (
                    <li key={i} style={bullet}>{b}</li>
                  ))}
                </ul>
              </div>
            );
          })}

          {(c.celebrated_moments || []).filter(Boolean).map((moment, i) => (
            <div key={i} style={celebratedRow}>
              <span aria-hidden style={{ fontSize: 14 }}>✨</span>
              <span>{moment}</span>
            </div>
          ))}

          {c.recommendation && (
            <div style={{ marginTop: 16 }}>
              <div style={sectionHeading}>{c.recommendation_heading || "Where I'd start"}</div>
              <div style={recBox}>{c.recommendation}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={acknowledge} style={primaryBtn}>
              Got it, thanks
            </button>
            {onAsk && (
              <button
                onClick={() => onAsk(c.recommendation || 'What needs my attention today?')}
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

const cardBase: React.CSSProperties = {
  background: 'linear-gradient(180deg,#FFFFFF,#F0FDFA)',
  border: '1px solid #CCFBF1',
  borderRadius: 16,
  padding: 20,
  marginBottom: 20,
  boxShadow: '0 4px 16px rgba(20,184,166,0.08)',
};
const briefingCard: React.CSSProperties = { ...cardBase };
const skeletonCard: React.CSSProperties = { ...cardBase, background: '#F8FAFC', border: '1px solid #E2E8F0' };
const emptyCard: React.CSSProperties = { ...cardBase, background: '#FFFFFF' };
const collapsedCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  background: '#F0FDFA', border: '1px solid #CCFBF1',
  borderRadius: 999, padding: '8px 16px', marginBottom: 0,
  cursor: 'pointer',
};
const closingLine: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  fontSize: 14, fontStyle: 'italic', color: '#0F766E',
  padding: '8px 4px 12px 4px',
  animation: 'fpFadeIn 300ms ease-out',
};

const eyebrow: React.CSSProperties = {
  fontSize: 13, fontWeight: 800, color: '#0F766E', letterSpacing: '0.05em',
};
const bodyText: React.CSSProperties = { fontSize: 15, color: '#0F172A', lineHeight: 1.6 };
const sectionHeading: React.CSSProperties = {
  fontSize: 13, fontWeight: 800, color: '#0F172A', letterSpacing: '0.02em', marginBottom: 6,
};
const bulletList: React.CSSProperties = { margin: 0, paddingLeft: 20 };
const bullet: React.CSSProperties = { ...bodyText, marginBottom: 4 };
const recBox: React.CSSProperties = {
  ...bodyText,
  background: '#FFFFFF',
  border: '1px solid #CCFBF1',
  borderRadius: 12,
  padding: '10px 14px',
  color: '#0F172A',
};
const celebratedRow: React.CSSProperties = {
  ...bodyText,
  display: 'flex', gap: 8, alignItems: 'flex-start',
  marginTop: 12,
  padding: '10px 12px',
  background: '#FEFCE8',
  border: '1px solid #FEF08A',
  borderRadius: 12,
  color: '#713F12',
};
const noticedBox: React.CSSProperties = {
  ...bodyText,
  marginTop: 14,
  padding: '10px 14px',
  background: '#FEFCE8',
  border: '1px solid #FEF08A',
  borderRadius: 12,
  color: '#713F12',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700,
  background: '#0F766E', color: '#FFFFFF', border: '1px solid #0F766E',
  cursor: 'pointer',
};
const pillBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: '#FFFFFF', border: '1px solid #CCFBF1', color: '#0F766E',
  cursor: 'pointer',
};
const errText: React.CSSProperties = {
  ...bodyText, color: '#B91C1C', background: '#FEF2F2',
  border: '1px solid #FECACA', padding: '8px 12px', borderRadius: 10,
  marginTop: 10, fontSize: 13,
};
