'use client';

import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * /admin/crm — CRM Navigator hub.
 *
 * Purpose: give admins a single, discoverable entry point to every
 * people-oriented workspace in MCGS. Historically this route was a
 * server-side redirect straight to Founding Members; the redirect
 * caused confusion because "CRM" is a domain, not a page. This hub
 * replaces the redirect with an honest launcher.
 *
 * Design notes
 * ------------
 * • Does NOT re-parent the sub-surfaces. Members, Enquiries, Campaigns,
 *   Segments and Support all keep their existing top-level routes
 *   (they remain reachable directly from the sidebar too). This page
 *   is purely a launcher — deleting it must not break any deep link.
 * • Purely static. No API calls, no auth checks beyond AdminShell's
 *   own guard, no loading state. Instant paint.
 * • Tile styling mirrors the existing hub visual language used on
 *   /admin/flyers and /admin/media so admins get the same shape they
 *   already know. "Soon" pill uses the same look as the sidebar's
 *   Soon pill for consistency.
 * • Order = frequency-of-use (Founding Members first, Members
 *   second) so muscle memory matches the sidebar order below the
 *   navigator.
 */

type Tile = {
  href: string;
  icon: string;
  label: string;
  description: string;
  soon?: boolean;
};

const TILES: Tile[] = [
  {
    href:        '/admin/crm/founding-members',
    icon:        '🌟',
    label:       'Founding Members',
    description: 'The people who registered before launch. Manage status, notes, tags. Send invitations. Permanently delete registrations from Advanced/Admin.',
  },
  {
    href:        '/admin/members',
    icon:        '👤',
    label:       'Members',
    description: 'Everyone with a FriendPlace account. Profiles, activity, moderation actions.',
  },
  {
    href:        '/admin/enquiries',
    icon:        '📥',
    label:       'Enquiries',
    description: 'Interest registrations, contact-form messages, general questions — all in one triaged inbox.',
  },
  {
    href:        '/admin/campaigns',
    icon:        '📮',
    label:       'Campaigns',
    description: 'Compose, preview and send emails to Founding Members and any saved Segment.',
  },
  {
    href:        '/admin/segments',
    icon:        '🦋',
    label:       'Segments',
    description: 'Group people by shared traits — location, referral, companion choice — for targeted campaigns.',
  },
  {
    href:        '/admin/support',
    icon:        '💬',
    label:       'Support & Feedback',
    description: 'One inbox for support tickets, contact-form submissions and feedback. George drafts suggested replies.',
    soon:        true,
  },
];

export default function CRMNavigatorPage() {
  return (
    <AdminShell title="CRM Navigator">
      <p style={intro}>
        Everything you need to understand and reach the people who make FriendPlace.
        Pick a workspace to dive into — each one opens in the same tab so you can
        come back to this hub via the sidebar.
      </p>
      <div style={grid}>
        {TILES.map((t) => (
          <Tile key={t.href} tile={t} />
        ))}
      </div>
    </AdminShell>
  );
}

function Tile({ tile }: { tile: Tile }) {
  const content = (
    <div style={tileCard}>
      <div style={tileHeader}>
        <span style={tileIcon} aria-hidden>{tile.icon}</span>
        <span style={tileLabel}>{tile.label}</span>
        {tile.soon && <span style={soonPill}>Soon</span>}
      </div>
      <p style={tileCopy}>{tile.description}</p>
      <span style={tileCta}>
        {tile.soon ? 'Preview →' : 'Open →'}
      </span>
    </div>
  );
  return (
    <Link href={tile.href} style={tileLink} aria-label={`Open ${tile.label}`}>
      {content}
    </Link>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const intro: React.CSSProperties = { color: '#475569', fontSize: 14, lineHeight: 1.6, margin: '4px 0 24px', maxWidth: 720 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 };
const tileLink: React.CSSProperties = { textDecoration: 'none', color: 'inherit', display: 'block' };
const tileCard: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: '18px 20px', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s', cursor: 'pointer' };
const tileHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const tileIcon: React.CSSProperties = { fontSize: 22, lineHeight: 1 };
const tileLabel: React.CSSProperties = { fontWeight: 800, fontSize: 16, color: '#0A2540', flex: '1 1 auto' };
const tileCopy: React.CSSProperties = { margin: 0, color: '#64748B', fontSize: 13, lineHeight: 1.55, flex: '1 1 auto' };
const tileCta: React.CSSProperties = { marginTop: 6, fontSize: 12, fontWeight: 800, color: '#0F766E', letterSpacing: '0.02em' };
const soonPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' };
