'use client';

import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * /admin/crm — CRM Navigator hub.
 *
 * iter159: reorganised into three top-level sections:
 *   • Members     — FriendPlace member relationships
 *   • Marketing   — FriendPlace promoting FriendPlace (P0 focus)
 *   • Business    — external businesses advertising through FriendPlace
 *
 * Existing routes are unchanged — this page purely regroups tiles for
 * discoverability. Deleting or renaming the hub must never break a deep
 * link into one of the sub-surfaces.
 */

type Tile = {
  href: string;
  icon: string;
  label: string;
  description: string;
  soon?: boolean;
};

type Section = {
  key: string;
  label: string;
  blurb: string;
  tiles: Tile[];
};

const SECTIONS: Section[] = [
  {
    key:   'members',
    label: 'Members',
    blurb: 'People with a FriendPlace relationship — Founding Members, members, and everyone we’ve heard from.',
    tiles: [
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
    ],
  },
  {
    key:   'marketing',
    label: 'Marketing',
    blurb: 'FriendPlace promoting FriendPlace — emails, flyers, campaigns and outreach.',
    tiles: [
      {
        href:        '/admin/marketing/send',
        icon:        '✉️',
        label:       'Send Email',
        description: 'Send a personalised FriendPlace email to anyone — name + email is all you need. Attach a flyer.',
      },
      {
        href:        '/admin/campaigns',
        icon:        '📮',
        label:       'Email Campaigns',
        description: 'Compose, preview and send emails to Founding Members and any saved Segment.',
      },
      {
        href:        '/admin/marketing/outreach',
        icon:        '🏢',
        label:       'Organisation Outreach',
        description: 'Retirement villages, community centres, libraries, councils, clubs — track outreach and share flyers.',
        soon:        true,
      },
      {
        href:        '/admin/flyers',
        icon:        '🍪',
        label:       'Flyer Publishing Centre',
        description: 'Design, preview, print and archive FriendPlace flyers. Attach them to marketing emails.',
      },
      {
        href:        '/admin/emails',
        icon:        '📬',
        label:       'Email Log',
        description: 'Every email FriendPlace has sent — status, Resend message ID, delivery events.',
      },
      {
        href:        '/admin/marketing/history',
        icon:        '📚',
        label:       'Send History',
        description: 'Every marketing email sent by FriendPlace — per recipient, per campaign.',
      },
    ],
  },
  {
    key:   'business',
    label: 'Business',
    blurb: 'External businesses that want to advertise or promote through FriendPlace.',
    tiles: [
      {
        href:        '/admin/business/advertisers',
        icon:        '🏪',
        label:       'Advertisers',
        description: 'Local businesses paying to appear on FriendPlace — profiles, contracts, campaigns.',
        soon:        true,
      },
      {
        href:        '/admin/business/inventory',
        icon:        '📊',
        label:       'Ad Inventory',
        description: 'Available ad slots, categories, pricing — the merchandising surface for advertisers.',
        soon:        true,
      },
      {
        href:        '/admin/business/reports',
        icon:        '📈',
        label:       'Advertiser Reports',
        description: 'Impressions, clicks, revenue — reporting back to advertisers on their performance.',
        soon:        true,
      },
    ],
  },
];

export default function CRMNavigatorPage() {
  return (
    <AdminShell title="CRM Navigator">
      <p style={intro}>
        Three sides of FriendPlace: the people who make it (<strong>Members</strong>),
        the outreach that grows it (<strong>Marketing</strong>), and the businesses
        that want to be part of it (<strong>Business</strong>).
      </p>
      {SECTIONS.map((section) => (
        <div key={section.key} style={{ marginTop: 28 }}>
          <div style={sectionHeader}>
            <span style={sectionLabel}>{section.label}</span>
            <span style={sectionBlurb}>{section.blurb}</span>
          </div>
          <div style={grid}>
            {section.tiles.map((t) => (
              <Tile key={t.href} tile={t} />
            ))}
          </div>
        </div>
      ))}
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

// ─── Styles ────────────────────────────────────────────────────
const intro: React.CSSProperties = { color: '#475569', fontSize: 14, lineHeight: 1.6, margin: '4px 0 8px', maxWidth: 720 };
const sectionHeader: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, borderBottom: '1px solid #E2E8F0', paddingBottom: 8 };
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#0F766E' };
const sectionBlurb: React.CSSProperties = { fontSize: 13, color: '#64748B', lineHeight: 1.5 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 };
const tileLink: React.CSSProperties = { textDecoration: 'none', color: 'inherit', display: 'block' };
const tileCard: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: '18px 20px', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s', cursor: 'pointer' };
const tileHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const tileIcon: React.CSSProperties = { fontSize: 22, lineHeight: 1 };
const tileLabel: React.CSSProperties = { fontWeight: 800, fontSize: 16, color: '#0A2540', flex: '1 1 auto' };
const tileCopy: React.CSSProperties = { margin: 0, color: '#64748B', fontSize: 13, lineHeight: 1.55, flex: '1 1 auto' };
const tileCta: React.CSSProperties = { marginTop: 6, fontSize: 12, fontWeight: 800, color: '#0F766E', letterSpacing: '0.02em' };
const soonPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' };
