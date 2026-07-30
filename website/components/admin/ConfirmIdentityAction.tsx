'use client';

import { useEffect, useState } from 'react';
import type { MemberRow } from '@/lib/cms-api';

/**
 * The single, non-negotiable safeguard before any consequential
 * moderation action. Renders the member's identity card, an optional
 * reason input, and — for delete — a typed Member-ID confirmation.
 *
 * The primary button is DISABLED until the admin has "read" the
 * identifiers (2-step confirm): they must first click "I have checked
 * these details", then the destructive button unlocks. Cancel is the
 * default focus target.
 *
 * Usage:
 *
 *   <ConfirmIdentityAction
 *     open={intent === 'suspend'}
 *     onClose={() => setIntent(null)}
 *     onConfirm={({reason, durationHours}) => api.suspend(...)}
 *     member={member}
 *     action="suspend"
 *   />
 */
export type ModAction = 'warn' | 'suspend' | 'ban' | 'restore' | 'delete';

export interface ConfirmIdentityActionProps {
  open: boolean;
  member: MemberRow;
  action: ModAction;
  /** For suspend: initial hours (default 24). */
  initialHours?: number;
  /** Optional pre-filled reason (e.g. from a report). */
  initialReason?: string;
  /** Optional report id to link the outcome to. */
  reportId?: string;
  onClose(): void;
  onConfirm(payload: {
    reason: string;
    durationHours?: number;
    confirmMemberId?: string;
  }): Promise<void>;
}

const ACTION_META: Record<ModAction, {
  title: string;
  verb: string;
  primary: string;
  danger: boolean;
  requiresReason: boolean;
  requiresTypedId: boolean;
  colour: string;
}> = {
  warn:    { title: 'Warn member',    verb: 'warn',    primary: 'Send warning',       danger: false, requiresReason: true,  requiresTypedId: false, colour: '#F59E0B' },
  suspend: { title: 'Suspend member', verb: 'suspend', primary: 'Confirm suspension', danger: true,  requiresReason: true,  requiresTypedId: false, colour: '#DC2626' },
  ban:     { title: 'Ban member',     verb: 'ban',     primary: 'Confirm ban',        danger: true,  requiresReason: true,  requiresTypedId: false, colour: '#7F1D1D' },
  restore: { title: 'Restore member', verb: 'restore', primary: 'Restore',            danger: false, requiresReason: false, requiresTypedId: false, colour: '#0F766E' },
  delete:  { title: 'Delete member',  verb: 'delete',  primary: 'Delete permanently', danger: true,  requiresReason: true,  requiresTypedId: true,  colour: '#7F1D1D' },
};

export function ConfirmIdentityAction({
  open, member, action, initialHours = 24, initialReason = '',
  reportId, onClose, onConfirm,
}: ConfirmIdentityActionProps) {
  const meta = ACTION_META[action];
  const [reason, setReason] = useState(initialReason);
  const [hours, setHours] = useState(initialHours);
  const [confirmId, setConfirmId] = useState('');
  const [identityChecked, setIdentityChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setHours(initialHours);
      setConfirmId('');
      setIdentityChecked(false);
      setSubmitting(false);
      setError(null);
    }
  }, [open, initialReason, initialHours]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = member.display_name || `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.username || member.email || '—';
  const initials = (displayName || '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  const restrictionFlags: string[] = [];
  if (member.banned) restrictionFlags.push('Banned');
  if (member.suspended_until) restrictionFlags.push(`Suspended until ${formatShort(member.suspended_until)}`);
  if (member.restricted && !member.banned && !member.suspended_until) restrictionFlags.push('Restricted');
  if (member.flagged_for_review) restrictionFlags.push('Flagged for review');
  if (member.profile_hidden) restrictionFlags.push('Profile hidden');
  if (member.is_admin) restrictionFlags.push('Admin');

  const reasonOk = !meta.requiresReason || reason.trim().length >= 3;
  const idOk = !meta.requiresTypedId || confirmId.trim() === member.id;
  const canSubmit = identityChecked && reasonOk && idOk && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        reason: reason.trim(),
        durationHours: action === 'suspend' ? Math.max(1, hours) : undefined,
        confirmMemberId: action === 'delete' ? confirmId.trim() : undefined,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
      setSubmitting(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose} role="presentation">
      <div style={dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header style={header}>
          <h2 id="confirm-title" style={{ ...title, color: meta.colour }}>{meta.title}</h2>
          <button type="button" onClick={onClose} aria-label="Cancel" style={closeBtn}>✕</button>
        </header>

        <p style={intro}>
          You are about to <strong style={{ color: meta.colour }}>{meta.verb}</strong>{' '}
          the following member. Please confirm the identifiers below match the correct person.
        </p>

        {/* Identity block */}
        <div style={identityCard}>
          <div style={avatar}>
            {member.avatar
              ? <img src={member.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span>{initials || '?'}</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={identityName}>{displayName}</div>
            {member.username && <div style={identitySub}>@{member.username}</div>}
            <div style={identityRow}>
              <IdentityField label="Member ID" value={member.id} mono />
              {member.email && <IdentityField label="Email" value={member.email} />}
            </div>
            <div style={identityRow}>
              {member.created_at && <IdentityField label="Joined" value={formatShort(member.created_at)} />}
              {member.last_active && <IdentityField label="Last active" value={formatShort(member.last_active)} />}
            </div>
            {restrictionFlags.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {restrictionFlags.map((f) => (
                  <span key={f} style={flagPill}>{f}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Duration picker for suspensions */}
        {action === 'suspend' && (
          <label style={fieldLabel}>
            Duration
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {[24, 168, 720].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHours(h)}
                  style={{ ...chip, ...(hours === h ? chipOn : {}) }}
                >
                  {h === 24 ? '24 hours' : h === 168 ? '7 days' : '30 days'}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={hours}
                onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))}
                style={{ ...input, width: 96 }}
                aria-label="Custom hours"
              />
              <span style={{ color: '#64748B', fontSize: 12, alignSelf: 'center' }}>hours</span>
            </div>
          </label>
        )}

        {/* Reason */}
        {meta.requiresReason && (
          <label style={fieldLabel}>
            Reason <span style={{ color: '#DC2626' }}>*</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={action === 'delete'
                ? 'Reason for permanent deletion (e.g. right-to-erasure request from member)…'
                : 'A short reason the member will see in their notification…'}
              style={textarea}
              autoFocus={!meta.requiresTypedId}
            />
          </label>
        )}

        {/* Typed Member-ID confirmation for delete */}
        {meta.requiresTypedId && (
          <label style={fieldLabel}>
            Type the Member ID to confirm deletion
            <input
              type="text"
              value={confirmId}
              onChange={(e) => setConfirmId(e.target.value.trim())}
              placeholder={member.id}
              style={{ ...input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              spellCheck={false}
              autoComplete="off"
            />
            <span style={{ fontSize: 12, color: idOk ? '#0F766E' : '#94A3B8', marginTop: 4 }}>
              {idOk ? '✓ Member ID matches' : `Expected: ${member.id}`}
            </span>
          </label>
        )}

        {/* Identity-checked gate */}
        <label style={identityCheckRow}>
          <input
            type="checkbox"
            checked={identityChecked}
            onChange={(e) => setIdentityChecked(e.target.checked)}
          />
          <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 700 }}>
            I have checked these identifiers and confirm this is the correct member.
          </span>
        </label>

        {reportId && (
          <div style={reportBadge}>
            🔗 Linked to report <code style={code}>{reportId}</code> — will auto-resolve on confirm.
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}

        <footer style={footer}>
          <button type="button" onClick={onClose} style={cancelBtn} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...primaryBtn,
              background: canSubmit ? meta.colour : '#CBD5E1',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Working…' : meta.primary}
          </button>
        </footer>
      </div>
    </div>
  );
}

function IdentityField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ minWidth: 0, flex: '1 1 200px' }}>
      <div style={identityLabel}>{label}</div>
      <div style={{ ...identityValue, ...(mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 } : {}) }}>
        {value}
      </div>
    </div>
  );
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return iso; }
}

// ─── styles ────────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 };
const dialog: React.CSSProperties = { width: '100%', maxWidth: 560, background: '#FFFFFF', borderRadius: 16, boxShadow: '0 20px 60px rgba(15,23,42,0.35)', padding: 20, maxHeight: '90vh', overflowY: 'auto' };
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 };
const title: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 900 };
const closeBtn: React.CSSProperties = { background: 'none', border: 0, fontSize: 18, cursor: 'pointer', color: '#64748B', padding: 4 };
const intro: React.CSSProperties = { color: '#334155', fontSize: 14, margin: '6px 0 14px', lineHeight: 1.5 };
const identityCard: React.CSSProperties = { display: 'flex', gap: 14, padding: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, marginBottom: 14 };
const avatar: React.CSSProperties = { width: 56, height: 56, borderRadius: 999, background: '#0F3D6E', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, overflow: 'hidden', flexShrink: 0 };
const identityName: React.CSSProperties = { fontSize: 16, fontWeight: 900, color: '#0F172A' };
const identitySub: React.CSSProperties = { fontSize: 12, color: '#64748B', marginBottom: 6 };
const identityRow: React.CSSProperties = { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 };
const identityLabel: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B', fontWeight: 800 };
const identityValue: React.CSSProperties = { fontSize: 13, color: '#0F172A', fontWeight: 700, wordBreak: 'break-word' };
const flagPill: React.CSSProperties = { padding: '2px 8px', fontSize: 11, fontWeight: 800, background: '#FEE2E2', color: '#991B1B', borderRadius: 999 };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, color: '#475569', marginBottom: 12 };
const textarea: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, resize: 'vertical', fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0, color: '#0F172A', fontWeight: 400 };
const input: React.CSSProperties = { display: 'block', width: '100%', marginTop: 6, padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, textTransform: 'none', letterSpacing: 0, color: '#0F172A', fontWeight: 400 };
const chip: React.CSSProperties = { padding: '6px 10px', fontSize: 13, background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 999, cursor: 'pointer', fontWeight: 700, color: '#475569' };
const chipOn: React.CSSProperties = { background: '#0F3D6E', color: '#FFFFFF', borderColor: '#0F3D6E' };
const identityCheckRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: '#FEFCE8', border: '1px solid #FBBF24', borderRadius: 10, marginBottom: 12, cursor: 'pointer' };
const reportBadge: React.CSSProperties = { padding: '8px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, fontSize: 12, color: '#1E40AF', marginBottom: 12 };
const errorBox: React.CSSProperties = { padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, fontSize: 13, color: '#B91C1C', marginBottom: 12 };
const footer: React.CSSProperties = { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 };
const cancelBtn: React.CSSProperties = { padding: '10px 18px', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 10, fontSize: 14, fontWeight: 700, color: '#475569', cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '10px 18px', border: 0, borderRadius: 10, fontSize: 14, fontWeight: 800, color: '#FFFFFF', transition: 'background 120ms ease' };
const code: React.CSSProperties = { background: '#DBEAFE', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
