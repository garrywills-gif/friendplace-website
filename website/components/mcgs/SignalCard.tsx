'use client';

import { mcgsApi, type Case, type SignalStatus } from '@/lib/mcgs-api';
import { useState } from 'react';

interface SignalCardProps {
  case_: Case;
  onChanged?: (c: Case) => void;
}

const PRIORITY_STYLES: Record<string, { glyph: string; bg: string; border: string; label: string }> = {
  P0: { glyph: '🔴', bg: '#FEF2F2', border: '#FCA5A5', label: 'Critical' },
  P1: { glyph: '🟠', bg: '#FFF7ED', border: '#FED7AA', label: 'High' },
  P2: { glyph: '🟡', bg: '#FEFCE8', border: '#FDE68A', label: 'Medium' },
  P3: { glyph: '🟢', bg: '#F0FDF4', border: '#BBF7D0', label: 'Info' },
  P4: { glyph: '⚪', bg: '#F8FAFC', border: '#E2E8F0', label: 'Ambient' },
};

const CONFIDENCE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  high:     { bg: '#DCFCE7', color: '#166534', label: 'High confidence' },
  moderate: { bg: '#FEF3C7', color: '#92400E', label: 'Moderate confidence' },
  low:      { bg: '#FEE2E2', color: '#991B1B', label: 'Low confidence — review' },
};

export function SignalCard({ case_, onChanged }: SignalCardProps) {
  const p = PRIORITY_STYLES[case_.priority] || PRIORITY_STYLES.P3;
  const george = case_.george_read;
  const conf = george?.confidence ? CONFIDENCE_STYLES[george.confidence] : null;
  const [busy, setBusy] = useState<null | 'review' | 'resolve' | 'dismiss'>(null);

  async function act(to: SignalStatus, kind: 'review' | 'resolve' | 'dismiss') {
    if (busy) return;
    setBusy(kind);
    try {
      const updated = await mcgsApi.transitionCase(case_.id, to, { resolved_action: kind });
      onChanged?.(updated);
    } catch (err) {
      console.error(err);
      alert(`Couldn't update: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const deepLink = case_.case_key.startsWith('event_submission:')
    ? `/admin/event-submissions`
    : case_.case_key.startsWith('support_ticket:')
      ? `/admin/support` // placeholder — no page yet, still readable
      : undefined;

  return (
    <div style={{
      background: '#FFFFFF', borderLeft: `4px solid ${p.border}`,
      border: '1px solid #E2E8F0', borderLeftWidth: 4,
      borderRadius: 12, padding: 16, marginBottom: 12,
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          background: p.bg, color: '#0F172A', border: `1px solid ${p.border}`,
          borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 800,
          letterSpacing: '0.04em', display: 'inline-flex', gap: 6, alignItems: 'center',
          flexShrink: 0,
        }}>
          <span aria-hidden>{p.glyph}</span> {case_.priority} · {p.label}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>{case_.subject}</div>
          {case_.signal_ids.length > 1 && (
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
              {case_.signal_ids.length} related signals grouped
            </div>
          )}
        </div>
      </div>

      {george?.tldr && (
        <div style={{
          marginTop: 12, background: '#F0FDFA', border: '1px solid #CCFBF1',
          borderRadius: 10, padding: '10px 12px',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 14 }} aria-hidden>🦋</span>
            <span style={{ fontWeight: 700, fontSize: 12, color: '#0F766E', letterSpacing: '0.02em' }}>
              GEORGE&apos;S READ
            </span>
            {conf && (
              <span style={{
                background: conf.bg, color: conf.color, borderRadius: 6,
                padding: '2px 8px', fontSize: 10, fontWeight: 800, letterSpacing: '0.02em',
              }}>{conf.label}</span>
            )}
          </div>
          <div style={{ fontSize: 14, color: '#0F172A', lineHeight: 1.5 }}>{george.tldr}</div>
          {george.suggested_action && (
            <div style={{ fontSize: 12, color: '#0F766E', marginTop: 6, fontStyle: 'italic' }}>
              Suggested: {george.suggested_action}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {deepLink && (
          <a href={deepLink} style={btnPrimary}>Open</a>
        )}
        <button onClick={() => act('IN_REVIEW', 'review')} disabled={!!busy} style={btnGhost}>
          {busy === 'review' ? '…' : 'Mark reviewing'}
        </button>
        <button onClick={() => act('RESOLVED', 'resolve')} disabled={!!busy} style={btnGhost}>
          {busy === 'resolve' ? '…' : 'Resolve'}
        </button>
        <button onClick={() => act('DISMISSED', 'dismiss')} disabled={!!busy} style={btnMuted}>
          {busy === 'dismiss' ? '…' : 'Dismiss'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
          {relTime(case_.last_signal_at)}
        </span>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const btnPrimary: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)', color: '#FFFFFF',
  textDecoration: 'none', border: 'none', display: 'inline-block',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
  background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A',
  cursor: 'pointer',
};
const btnMuted: React.CSSProperties = {
  ...btnGhost, color: '#94A3B8',
};
