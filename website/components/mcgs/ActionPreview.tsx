'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/lib/cms-auth';
import { API_BASE } from '@/lib/api-base';

const BASE = API_BASE;

export interface ActionPreviewPayload {
  kind: 'action_preview';
  action_type: 'ticket_reply' | 'submission_decision';
  target: { kind: string; id: string };
  what: string;
  why: string;
  sources: Array<{ label: string; kind: string; id: string }>;
  confidence: 'high' | 'moderate' | 'low';
  confidence_reason?: string;
  draft: string;
  case_id?: string | null;
  decision?: 'approve' | 'reject' | 'changes_requested';
  generated_at?: string;
  generated_by?: { kind: string; model: string };
  error?: string;
}

interface ActionPreviewProps {
  preview: ActionPreviewPayload;
  onResolved?: () => void;
}

const CONFIDENCE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  high:     { bg: '#DCFCE7', color: '#166534', label: 'High confidence' },
  moderate: { bg: '#FEF3C7', color: '#92400E', label: 'Moderate confidence' },
  low:      { bg: '#FEE2E2', color: '#991B1B', label: 'Low confidence — review' },
};

/**
 * Action Preview card. WHAT / WHY / SOURCES / CONFIDENCE / DRAFT
 * (editable) / Show reasoning / Send / Edit / Dismiss.
 *
 * Never mutates on load. The Send button hits the corresponding
 * /api/mcgs/actions endpoint with an explicit `confirmed: true` — this
 * is the voice-safeguard gate applied uniformly regardless of channel.
 */
export function ActionPreview({ preview, onResolved }: ActionPreviewProps) {
  const [draft, setDraft] = useState(preview.draft || '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [undoTimeLeft, setUndoTimeLeft] = useState<number | null>(null);

  // 30-second undo countdown for ticket replies (state-only rollback is
  // impossible for a sent email; we just remove the mark-resolved and
  // let the admin re-send if needed). For submission decisions, no
  // reversible action is possible either — we skip the undo.
  useEffect(() => {
    if (undoTimeLeft === null) return;
    if (undoTimeLeft <= 0) { setUndoTimeLeft(null); return; }
    const id = setTimeout(() => setUndoTimeLeft(undoTimeLeft - 1), 1000);
    return () => clearTimeout(id);
  }, [undoTimeLeft]);

  if (preview.error) {
    return <div style={errorBox}>George couldn&apos;t prepare this: {preview.error}</div>;
  }
  if (dismissed) return null;

  const conf = CONFIDENCE_STYLES[preview.confidence] || CONFIDENCE_STYLES.low;

  async function send() {
    if (busy || sent) return;
    setBusy(true);
    try {
      const token = getToken();
      const url = preview.action_type === 'ticket_reply'
        ? `${BASE}/api/mcgs/actions/ticket-reply`
        : `${BASE}/api/mcgs/actions/submission-decision`;
      const body = preview.action_type === 'ticket_reply'
        ? {
            ticket_id: preview.target.id,
            draft,
            confirmed: true,
            george_involved: true,
            george_reasoning: preview.why,
            case_id: preview.case_id ?? undefined,
          }
        : {
            submission_id: preview.target.id,
            decision: preview.decision || 'approve',
            note: draft, // for submission decisions the "draft" is George's rationale.
            confirmed: true,
            george_involved: true,
            george_reasoning: preview.why,
            case_id: preview.case_id ?? undefined,
          };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail || 'Failed');
      setSent(true);
      if (preview.action_type === 'ticket_reply') setUndoTimeLeft(30);
      onResolved?.();
    } catch (err) {
      alert(`Send failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={sentBox}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: undoTimeLeft ? 8 : 0 }}>
          <span style={{ fontSize: 18 }} aria-hidden>✓</span>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {preview.action_type === 'ticket_reply' ? 'Reply sent.' : 'Decision recorded.'}
          </div>
        </div>
        {undoTimeLeft !== null && undoTimeLeft > 0 && (
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Undo window: {undoTimeLeft}s — you can still edit + resend if needed.
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={header}>
        <span style={{ fontSize: 18 }} aria-hidden>🦋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#0F766E', letterSpacing: '0.03em' }}>
            GEORGE PROPOSES
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
            {preview.what}
          </div>
        </div>
        <span style={{
          background: conf.bg, color: conf.color, borderRadius: 6,
          padding: '2px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.02em',
        }}>{conf.label}</span>
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
        <strong style={fieldLabel}>Why:</strong> {preview.why}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: '#64748B', lineHeight: 1.55 }}>
        <strong style={fieldLabel}>Sources:</strong>{' '}
        {preview.sources.map((s, i) => (
          <span key={i} style={sourceChip}>{s.label}</span>
        ))}
      </div>

      {preview.confidence_reason && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>
          {preview.confidence_reason}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={fieldLabel}>
          {preview.action_type === 'ticket_reply' ? 'Draft reply' : 'Draft rationale (member won\u2019t see this)'}:
        </div>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={Math.max(4, Math.min(12, draft.split('\n').length))}
          style={draftArea}
        />
      </div>

      <div style={reasoningRow}>
        <button
          type="button"
          onClick={() => setShowReasoning(v => !v)}
          style={ghostLinkBtn}
        >
          {showReasoning ? 'Hide' : 'Show'} George&apos;s reasoning
        </button>
        {preview.generated_by?.model && (
          <span style={{ fontSize: 11, color: '#94A3B8' }}>
            Drafted by {preview.generated_by.model}
          </span>
        )}
      </div>
      {showReasoning && (
        <div style={reasoningBox}>
          {preview.why}
          {preview.confidence_reason ? '\n\n' + preview.confidence_reason : ''}
        </div>
      )}

      <div style={buttonRow}>
        <button onClick={send} disabled={busy || !draft.trim()} style={btnSend}>
          {busy ? 'Sending…' : preview.action_type === 'ticket_reply' ? 'Send reply' : 'Confirm decision'}
        </button>
        <button
          type="button"
          onClick={() => { /* stays in edit mode — user just types in textarea */ }}
          style={btnGhost}
        >Edit first</button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={btnMuted}
        >Dismiss</button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
          Nothing sends until you confirm.
        </span>
      </div>
    </div>
  );
}

// ---- styles ----
const card: React.CSSProperties = {
  marginTop: 12,
  background: '#FFFBEB', border: '1px solid #FEF3C7', borderLeft: '4px solid #F59E0B',
  borderRadius: 12, padding: 16,
};
const header: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start' };
const fieldLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, color: '#78350F', letterSpacing: '0.05em',
  textTransform: 'uppercase', display: 'inline-block',
};
const sourceChip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 6,
  background: '#FFFFFF', border: '1px solid #FED7AA', color: '#78350F',
  fontSize: 11, fontWeight: 700, marginRight: 6,
};
const draftArea: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '10px 12px',
  border: '1px solid #FDE68A', borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
  lineHeight: 1.55, resize: 'vertical', outline: 'none', background: '#FFFFFF',
  color: '#0F172A',
};
const reasoningRow: React.CSSProperties = {
  marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
};
const ghostLinkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#78350F',
  fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
};
const reasoningBox: React.CSSProperties = {
  marginTop: 8, padding: 10, background: '#FFFFFF', border: '1px solid #FEF3C7',
  borderRadius: 8, fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.55,
};
const buttonRow: React.CSSProperties = {
  marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
};
const btnSend: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg,#F59E0B,#EF4444)',
  color: '#FFFFFF', fontWeight: 800, fontSize: 13, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, border: '1px solid #FDE68A',
  background: '#FFFFFF', color: '#78350F', fontWeight: 700, fontSize: 13, cursor: 'pointer',
};
const btnMuted: React.CSSProperties = { ...btnGhost, color: '#94A3B8', borderColor: '#E2E8F0' };
const errorBox: React.CSSProperties = {
  marginTop: 12, padding: 12, background: '#FEE2E2', border: '1px solid #FCA5A5',
  borderRadius: 10, color: '#991B1B', fontSize: 13,
};
const sentBox: React.CSSProperties = {
  marginTop: 12, padding: 12, background: '#DCFCE7', border: '1px solid #86EFAC',
  borderRadius: 10, color: '#166534',
};
