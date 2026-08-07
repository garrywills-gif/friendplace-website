'use client';

import { type MemberRow } from '@/lib/cms-api';
import { memberDisplayName, statusBadgesFor, formatShortDate } from './MemberRowCard';

/**
 * MemberIdentityHeader — the top-of-profile identity block. Renders
 * exactly what the ConfirmIdentityAction dialog also renders, so the
 * admin sees consistent information on the page and in every safeguard
 * confirmation. First line of defence against acting on the wrong ID.
 */
export function MemberIdentityHeader({ member }: { member: MemberRow }) {
  const name = memberDisplayName(member);
  const badges = statusBadgesFor(member);
  const initials = (name || member.email || '?').trim().slice(0, 2).toUpperCase();

  const suspendedActive = !!(member.suspended_until && new Date(member.suspended_until) > new Date());
  const suspendedUntilText = suspendedActive
    ? new Date(member.suspended_until as string).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <section style={box}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={avatarBox}>
          {member.avatar ? (
            <img src={member.avatar} alt="" style={avatarImg} />
          ) : (
            <span style={avatarInitials}>{initials}</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h1 style={nameH}>{name}</h1>
            {member.username && <span style={handle}>@{member.username}</span>}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 4, flexWrap: 'wrap' }}>
            <span style={metaLine}>{member.email || '(no email on file)'}</span>
            <span style={metaLine}>·</span>
            <code style={idChip}>{member.id}</code>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap', fontSize: 12, color: '#64748B' }}>
            {member.created_at && <span>Joined {formatShortDate(member.created_at)}</span>}
            {member.last_active && <span>Last active {formatShortDate(member.last_active)}</span>}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {badges.length === 0 ? (
              <span style={{ ...badge, background: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0' }}>
                Good standing
              </span>
            ) : badges.map((b) => (
              <span key={b.label} style={{ ...badge, background: b.bg, color: b.fg, borderColor: b.border }}>
                {b.label}
              </span>
            ))}
          </div>

          {suspendedUntilText && (
            <div style={suspendedLine}>
              Suspension in effect until <strong>{suspendedUntilText}</strong>
              {member.restricted_reason && <> · <em>{member.restricted_reason}</em></>}
            </div>
          )}
          {member.banned && member.restricted_reason && (
            <div style={bannedLine}>
              Banned — <em>{member.restricted_reason}</em>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const box: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  padding: '18px 20px',
};
const avatarBox: React.CSSProperties = {
  width: 72, height: 72, borderRadius: 36,
  background: '#F1F5F9', color: '#0F172A',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 800, fontSize: 22, flexShrink: 0, overflow: 'hidden',
};
const avatarImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
const avatarInitials: React.CSSProperties = { letterSpacing: '0.02em' };
const nameH: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 800, color: '#0F172A' };
const handle: React.CSSProperties = { fontSize: 14, color: '#64748B' };
const metaLine: React.CSSProperties = { fontSize: 14, color: '#334155' };
const idChip: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '2px 8px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 600 };
const badge: React.CSSProperties = { padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, border: '1px solid', textTransform: 'uppercase', letterSpacing: '0.04em' };
const suspendedLine: React.CSSProperties = { marginTop: 10, background: '#FEF3C7', color: '#78350F', border: '1px solid #FBBF24', borderRadius: 8, padding: '8px 12px', fontSize: 13 };
const bannedLine: React.CSSProperties = { marginTop: 10, background: '#FEE2E2', color: '#7F1D1D', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 12px', fontSize: 13 };
