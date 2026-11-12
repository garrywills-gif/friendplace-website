'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { foundingMembersCrmApi, type CRMFoundingMember, type MemberProfile } from '@/lib/cms-api';
import { formatShortDate } from './MemberRowCard';

type AppMember = MemberProfile['user'];
type Lookup = { status: 'loading' | 'found' | 'none' | 'error'; record?: CRMFoundingMember };
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: '20px 24px', marginTop: 20 };
const label: React.CSSProperties = { color: '#64748B', fontSize: 12, fontWeight: 700, marginBottom: 4 };
const value: React.CSSProperties = { color: '#0A2540', fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '18px 24px', marginTop: 18 };

function textValue(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null;
}
function firstValue(member: AppMember, keys: string[]): string | null {
  for (const key of keys) {
    const found = textValue(member[key]);
    if (found) return found;
  }
  return null;
}
function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div style={label}>{title}</div><div style={value}>{children}</div></div>;
}
function dateText(value: unknown): string {
  const date = textValue(value);
  return date ? formatShortDate(date) : 'Not recorded';
}

export function MemberDetailsPanel({ member }: { member: AppMember }) {
  const [match, setMatch] = useState<Lookup>({ status: 'loading' });
  const email = textValue(member.email)?.toLowerCase() || '';
  useEffect(() => {
    let active = true;
    setMatch({ status: email ? 'loading' : 'none' });
    if (!email) return;
    foundingMembersCrmApi.list({ q: email, limit: 30 })
      .then(result => {
        if (!active) return;
        const exact = (result.rows || []).filter(row => row.email?.trim().toLowerCase() === email);
        // Do not claim a match when there are multiple registrations with the same email.
        setMatch(exact.length === 1 ? { status: 'found', record: exact[0] } : exact.length > 1 ? { status: 'error' } : { status: 'none' });
      })
      .catch(() => { if (active) setMatch({ status: 'error' }); });
    return () => { active = false; };
  }, [email]);

  const crm = match.record;
  const number = textValue(member.membership_number_display) || 'Pending';
  const kind = member.membership_kind === 'founding' ? 'Founding Member' : member.membership_kind === 'member' ? 'Regular Member' : 'Number pending';
  const signIn = firstValue(member, ['auth_provider', 'sign_in_provider', 'login_provider', 'provider', 'signup_method']);
  const appLocation = firstValue(member, ['suburb', 'city', 'state', 'state_country', 'location']);
  return (
    <section style={card} data-testid="member-details-section">
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0A2540' }}>Member details</div>
      <div style={{ fontSize: 13, marginTop: 4, color: '#64748B' }}>App account details and any matching website registration, all in one place.</div>
      <div style={grid}>
        <Field title="Membership">{kind}</Field>
        <Field title="Member number">{number}</Field>
        <Field title="App joined">{dateText(member.created_at)}</Field>
        <Field title="Email">{member.email || 'Not recorded'}</Field>
        <Field title="Email confirmation">{member.email_verified === true ? 'Confirmed' : member.email_verified === false ? 'Not confirmed' : 'Not available'}</Field>
        <Field title="Sign-in method">{signIn || 'Not recorded'}</Field>
        <Field title="App location">{appLocation || 'Not recorded'}</Field>
        <Field title="Last app activity">{dateText(member.last_active)}</Field>
        <Field title="Website registration">{match.status === 'loading' ? 'Checking CRM…' : match.status === 'found' ? 'Matching registration found' : match.status === 'none' ? 'No matching website registration' : 'Unable to confirm — check CRM'}</Field>
        {crm && <Field title="Website registered">{dateText(crm.created_at)}</Field>}
        {crm && <Field title="Website suburb / location">{[crm.suburb, crm.state || crm.state_country].filter(Boolean).join(', ') || 'Not recorded'}</Field>}
        {crm && <Field title="Website heard from">{crm.heard_from || crm.source || 'Not recorded'}</Field>}
        {crm && <Field title="CRM invitation status">{crm.status || 'Not recorded'}</Field>}
        {crm && <Field title="Original website number">{crm.member_number_display || (crm.founder_number != null ? '#' + String(crm.founder_number).padStart(4, '0') : 'Not recorded')}</Field>}
      </div>
      <div style={{ marginTop: 18, borderTop: '1px solid #E2E8F0', paddingTop: 14, fontSize: 13, color: '#64748B' }}>
        {crm ? (
          <span>Website registration found by exact email match. <Link href={'/admin/crm/founding-members?q=' + encodeURIComponent(email)} style={{ color: '#0F766E', fontWeight: 700 }}>Open CRM registration details</Link></span>
        ) : match.status === 'none' ? (
          <span>App account only — no CRM registration is required. Where they discovered FriendPlace is not known from this record.</span>
        ) : match.status === 'error' ? (
          <span>CRM details could not be reliably matched. App membership remains unaffected.</span>
        ) : <span>Checking for an existing website registration…</span>}
      </div>
    </section>
  );
}
