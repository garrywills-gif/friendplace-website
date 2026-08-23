'use client';

/**
 * Award Butterfly Points modal — Mission Control member profile (iter164h).
 *
 * Admin fills out amount + reason, picks George or Georgia, then sees an
 * exact preview of the notification the member will receive before
 * confirming. The preview is fetched from the same backend builder that
 * powers the real dispatch, so what the admin reads is what the member
 * reads (no drift possible).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminStyles } from '@/components/admin/AdminShell';
import {
  butterflyPointsApi,
  type BpPersona,
  type BpPolicy,
  type BpPreview,
} from '@/lib/cms-api';

const PERSONA_META: Record<BpPersona, { name: string; avatar: string }> = {
  george:  { name: 'George',  avatar: '🦋' },
  georgia: { name: 'Georgia', avatar: '🦋' },
};

export function AwardPointsModal({
  memberId, memberFirstName, onClose, onAwarded,
}: {
  memberId: string;
  memberFirstName?: string;
  onClose: () => void;
  onAwarded: (msg: string) => void;
}) {
  const [policy, setPolicy] = useState<BpPolicy | null>(null);
  const [amount, setAmount] = useState<number>(10);
  const [reason, setReason] = useState<string>('');
  const [persona, setPersona] = useState<BpPersona>('george');
  const [preview, setPreview] = useState<BpPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    butterflyPointsApi.policy().then((p) => { if (live) setPolicy(p); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const reasonLen = reason.trim().length;
  const valid = useMemo(() => {
    if (!policy) return false;
    if (amount < policy.amount_min || amount > policy.amount_max) return false;
    if (reasonLen < policy.reason_min || reasonLen > policy.reason_max) return false;
    return true;
  }, [policy, amount, reasonLen]);

  const softWarn = policy && amount > policy.amount_soft_warn;

  // Debounced preview fetch — same builder as the real dispatch so the
  // admin's confirmation view can never drift from the member's inbox.
  useEffect(() => {
    if (!valid) { setPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        const p = await butterflyPointsApi.preview({ amount, reason: reason.trim(), persona });
        setPreview(p);
      } catch (e: any) {
        setPreview(null);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [amount, reason, persona, valid]);

  const submit = useCallback(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      await butterflyPointsApi.award(memberId, {
        amount, reason: reason.trim(), persona,
      });
      onAwarded(
        `🦋 Awarded ${amount} Butterfly ${amount === 1 ? 'point' : 'points'} — the notification is on its way.`,
      );
    } catch (e: any) {
      setErr(e?.message || 'Award failed');
    } finally { setSubmitting(false); }
  }, [amount, reason, persona, valid, submitting, memberId, onAwarded]);

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="award-points-modal">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#0A2540', fontSize: 20, fontWeight: 900 }}>
            🦋 Award Butterfly Points
          </h3>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>
        <p style={{ margin: 0, color: '#475569', fontSize: 13, lineHeight: 1.55 }}>
          Recognise {memberFirstName || 'this member'} for something they&apos;ve
          done in the community. The notification will come warmly from
          your chosen voice — George or Georgia. You&apos;ll see the exact
          message before it&apos;s sent.
        </p>

        <label style={{ ...adminStyles.label, marginTop: 16 }}>
          Points {policy && `(${policy.amount_min}–${policy.amount_max})`}
        </label>
        <input
          data-testid="award-points-amount"
          type="number"
          min={policy?.amount_min ?? 1}
          max={policy?.amount_max ?? 100}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, Math.min(100, Number(e.target.value) || 0)))}
          style={{ ...adminStyles.input, maxWidth: 140 }}
        />
        {softWarn && (
          <div style={softNote} data-testid="award-points-soft-warn">
            That&apos;s a generous amount — most recognitions sit between {policy!.amount_min} and {policy!.amount_soft_warn}. Fine to send if it&apos;s earned.
          </div>
        )}

        <label style={{ ...adminStyles.label, marginTop: 12 }}>
          Recognition voice
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['george', 'georgia'] as BpPersona[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPersona(p)}
              data-testid={`award-persona-${p}`}
              style={{
                ...pill,
                background: persona === p ? '#0D9488' : '#F1F5F9',
                color:      persona === p ? '#FFFFFF' : '#0F172A',
                borderColor: persona === p ? '#0D9488' : '#E2E8F0',
              }}
            >
              {PERSONA_META[p].avatar} {PERSONA_META[p].name}
            </button>
          ))}
        </div>

        <label style={{ ...adminStyles.label, marginTop: 12 }}>
          Reason ({policy?.reason_min ?? 5}–{policy?.reason_max ?? 300} characters — the member will read this)
        </label>
        <textarea
          data-testid="award-points-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, policy?.reason_max ?? 300))}
          placeholder="e.g. helping Margaret with her garden last Saturday"
          style={{ ...adminStyles.textarea, minHeight: 80 }}
        />
        <div style={{ fontSize: 11, color: reasonLen < (policy?.reason_min ?? 5) ? '#B91C1C' : '#94A3B8', marginTop: 4 }}>
          {reasonLen} / {policy?.reason_max ?? 300}
        </div>

        <div style={{ ...previewCard, marginTop: 16, opacity: preview ? 1 : 0.55 }} data-testid="award-preview-card">
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 800, color: '#0F766E', marginBottom: 6 }}>
            {memberFirstName || 'They'} will see
          </div>
          {preview ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0A2540' }}>{preview.title}</div>
              <div style={{ fontSize: 14, color: '#334155', marginTop: 6, lineHeight: 1.55 }}>{preview.body}</div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>
              Fill in a valid amount and reason to see the exact message.
            </div>
          )}
        </div>

        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={adminStyles.ghostBtn}>Cancel</button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            data-testid="award-points-confirm"
            style={{ ...adminStyles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
          >
            {submitting ? 'Awarding…' : `Award ${amount} & send`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small "Reverse award" modal — reason-only (audit-required). */
export function ReverseAwardModal({
  memberId, ledgerId, ledgerSummary, onClose, onReversed,
}: {
  memberId: string;
  ledgerId: string;
  ledgerSummary: string;
  onClose: () => void;
  onReversed: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = reason.trim().length;
  const canSubmit = trimmed >= 5 && trimmed <= 300 && !submitting;
  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setErr(null);
    try {
      await butterflyPointsApi.reverse(memberId, ledgerId, { reason: reason.trim() });
      onReversed('Award reversed — the original stays in the audit trail.');
    } catch (e: any) {
      setErr(e?.message || 'Reversal failed');
    } finally { setSubmitting(false); }
  };
  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="reverse-award-modal">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#0A2540', fontSize: 20, fontWeight: 900 }}>
            Reverse this award?
          </h3>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>
        <p style={{ margin: 0, color: '#475569', fontSize: 13, lineHeight: 1.55 }}>
          {ledgerSummary}
        </p>
        <p style={{ marginTop: 10, color: '#475569', fontSize: 13, lineHeight: 1.55 }}>
          A reversal adds a new negative entry to the audit trail. The original
          award is preserved. Badges the member has already earned are kept.
        </p>
        <label style={{ ...adminStyles.label, marginTop: 12 }}>
          Reason for reversal (5–300 characters, kept for audit)
        </label>
        <textarea
          data-testid="reverse-award-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 300))}
          placeholder="e.g. Awarded twice by mistake — this is the duplicate."
          style={{ ...adminStyles.textarea, minHeight: 80 }}
        />
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={adminStyles.ghostBtn}>Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            data-testid="reverse-award-confirm"
            style={{ ...adminStyles.dangerBtn, opacity: canSubmit ? 1 : 0.5 }}
          >
            {submitting ? 'Reversing…' : 'Reverse award'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------- styles ----------------------------------------------------------

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
};
const card: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 16, padding: 24,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 24px 60px rgba(10,37,64,0.35)',
};
const closeBtn: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 20, color: '#64748B',
};
const pill: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 999,
  border: '1.5px solid #E2E8F0', background: '#FFFFFF',
  color: '#0F172A', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const softNote: React.CSSProperties = {
  marginTop: 6, padding: '8px 12px', borderRadius: 10,
  background: '#FEF3C7', color: '#92400E',
  fontSize: 12, fontWeight: 600, lineHeight: 1.45,
};
const previewCard: React.CSSProperties = {
  border: '1px solid rgba(20,184,166,0.35)',
  borderRadius: 14, padding: '12px 14px',
  background: 'linear-gradient(140deg, #F0FDFA 0%, #ECFEFF 100%)',
};
