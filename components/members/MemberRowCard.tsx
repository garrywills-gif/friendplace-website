'use client';

import { type MemberRow } from '@/lib/cms-api';

/**
 * MemberRowCard — one row in the members list. Renders the identity
 * block (avatar · name · handle · email · id · joined) plus quick
 * moderation-state chips (Banned / Suspended / Restricted / Flagged /
 * Founding / Demo / Admin). Kept read-only — all destructive actions
 * live on the profile page behind identity confirmation.
 */
export function MemberRowCard({ member }: { member: MemberRow }) {
  const displayName = memberDisplayName(member);
  const badges = statusBadgesFor(member);
  const initials = (displayName || member.email || '?').trim().slice(0, 2).toUpperCase();

  return (
    <article style={card}>
      <div style={avatarBox} aria-hidden>
        {member.avatar ? (
          <img src={member.avatar} alt="" style={avatarImg} />
        ) : (
          <span style={avatarInitials}>{initials}</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={identityRow}>
          <span style={nameText}>{displayName || '(no display name)'}</span>
          {member.username && <span style={handleText}>@{member.username}</span>}
          <code style={idChip}>{member.id.slice(0, 8)}…</code>
        </div>
        <div style={emailRow}>
          <span style={emailText}>{member.email || '(no email)'}</span>
          {member.created_at && (
            <span style={joinedText}>
              · joined {formatShortDate(member.created_at)}
            </span>
          )}
        </div>
      </div>

      <div style={badgesBox}>
        {badges.map((b) => (
          <span key={b.label} style={{ ...badgeBase, background: b.bg, color: b.fg, borderColor: b.border }}>
            {b.label}
          </span>
        ))}
      </div>

      <span style={chevron} aria-hidden>›</span>
    </article>
  );
}

// Public helpers reused by the profile page and identity dialog.
export function memberDisplayName(m: Partial<MemberRow>): string {
  return (
    m.display_name?.trim()
    || [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
    || m.username?.trim()
    || m.email?.trim()
    || m.id
    || ''
  );
}

export function formatShortDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return iso; }
}

type Badge = { label: string; bg: string; fg: string; border: string };

export function statusBadgesFor(m: MemberRow): Badge[] {
  const b: Badge[] = [];
  if (m.banned)             b.push({ label: 'Banned',      bg: '#FEE2E2', fg: '#7F1D1D', border: '#FCA5A5' });
  if (m.suspended_until && new Date(m.suspended_until) > new Date())
                            b.push({ label: 'Suspended',   bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA' });
  if (m.restricted && !m.banned && !m.suspended_until)
                            b.push({ label: 'Restricted',  bg: '#FEF3C7', fg: '#78350F', border: '#FBBF24' });
  if (m.flagged_for_review) b.push({ label: 'Flagged',     bg: '#FEF3C7', fg: '#78350F', border: '#FCD34D' });
  if (m.profile_hidden)     b.push({ label: 'Profile hidden', bg: '#F1F5F9', fg: '#334155', border: '#CBD5E1' });
  if (m.is_admin)           b.push({ label: 'Admin',       bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' });
  if (m.is_founding)        b.push({ label: 'Founding',    bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' });
  if (m.is_demo)            b.push({ label: 'Demo',        bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' });
  return b;
}

// ─── styles ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  alignItems: 'center',
  padding: '12px 16px',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  cursor: 'pointer',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
};
const avatarBox: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 22,
  background: '#F1F5F9', color: '#0F172A',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: 14, flexShrink: 0, overflow: 'hidden',
};
const avatarImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
const avatarInitials: React.CSSProperties = { letterSpacing: '0.02em' };
const identityRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' };
const nameText: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#0F172A' };
const handleText: React.CSSProperties = { fontSize: 13, color: '#64748B' };
const idChip: React.CSSProperties = { background: '#F1F5F9', color: '#334155', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, fontWeight: 600 };
const emailRow: React.CSSProperties = { display: 'flex', gap: 4, alignItems: 'baseline', marginTop: 2, flexWrap: 'wrap' };
const emailText: React.CSSProperties = { fontSize: 13, color: '#475569' };
const joinedText: React.CSSProperties = { fontSize: 12, color: '#94A3B8' };
const badgesBox: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 };
const badgeBase: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid', textTransform: 'uppercase', letterSpacing: '0.04em' };
const chevron: React.CSSProperties = { color: '#CBD5E1', fontSize: 24, marginLeft: 4, flexShrink: 0 };
