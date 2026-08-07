'use client';

import { AdminShell } from '@/components/admin/AdminShell';
import Link from 'next/link';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

/**
 * George's Workspace — landing page.
 *
 * Only "Create Event" is live in Milestone A. The rest are placeholders
 * so the workspace can grow into Group creation, Announcements,
 * Invitations, Newsletters, Volunteer Requests, etc. (Garry, 19 July 2026)
 */
interface Capability {
  href?: string;
  title: string;
  desc: string;
  emoji: string;
  soon?: boolean;
}

const CAPABILITIES: Capability[] = [
  { href: '/admin/george/new-event', title: 'Create Event',        desc: 'Talk to me and I\u2019ll put a complete event together.', emoji: '🎉' },
  { title: 'Draft Announcement',     desc: 'Compose a warm note to the community when the time comes.',  emoji: '📣', soon: true },
  { title: 'Create Group',           desc: 'Set up a new group for members with a shared interest.',    emoji: '👥', soon: true },
  { title: 'Invite Members',         desc: 'Write a personal invitation for people we\u2019d love to see.', emoji: '✉️', soon: true },
  { title: 'Plan Community Activity', desc: 'Bigger than a single event \u2014 a whole programme.',        emoji: '🌱', soon: true },
  { title: 'Generate Newsletter',    desc: 'Pull together this week\u2019s highlights in your voice.',    emoji: '📰', soon: true },
  { title: 'Volunteer Request',      desc: 'Ask for help in a way that feels good to say yes to.',       emoji: '🤝', soon: true },
];

export default function GeorgeWorkspacePage() {
  return (
    <AdminShell>
      <div style={container}>
        <header style={hero}>
          <div style={butterflyRow}>
            <div style={butterflyDisc}><GeorgeButterflyMark size={40} /></div>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                Working with George
              </div>
              <h1 style={{ fontSize: 30, margin: '2px 0 4px', color: '#0F172A', letterSpacing: '-0.015em' }}>
                George&rsquo;s Workspace
              </h1>
              <p style={{ fontSize: 15, color: '#475569', margin: 0, lineHeight: 1.6, maxWidth: 640 }}>
                A quiet place to work with me on the pieces that bring your community
                together. Start something, and I&rsquo;ll take care of the shape of it &mdash;
                you just tell me what you have in mind.
              </p>
            </div>
          </div>
        </header>

        <div style={grid}>
          {CAPABILITIES.map(c => (
            <CapabilityCard key={c.title} c={c} />
          ))}
        </div>

        <div style={foot}>
          <Link href="/admin/bridge" style={backLink}>&larr; Back to the Bridge</Link>
        </div>
      </div>
    </AdminShell>
  );
}

function CapabilityCard({ c }: { c: Capability }) {
  const disabled = !!c.soon || !c.href;
  const inner = (
    <div style={{ ...card, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      <div style={cardIcon} aria-hidden>{c.emoji}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>{c.title}</div>
          {c.soon && <span style={soonPill}>Coming soon</span>}
        </div>
        <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>{c.desc}</div>
      </div>
      {!disabled && (
        <div style={arrow} aria-hidden>&rarr;</div>
      )}
    </div>
  );
  if (disabled || !c.href) return <div>{inner}</div>;
  return <Link href={c.href} style={{ textDecoration: 'none' }}>{inner}</Link>;
}

const container: React.CSSProperties = { maxWidth: 1000, margin: '0 auto' };
const hero: React.CSSProperties = { marginBottom: 20 };
const butterflyRow: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 16,
};
const butterflyDisc: React.CSSProperties = {
  width: 56, height: 56, borderRadius: 28,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 28, filter: 'drop-shadow(0 6px 14px rgba(20,184,166,0.35))',
};
const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginTop: 8,
};
const card: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14,
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14,
  padding: '14px 16px',
  boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
  transition: 'transform 200ms ease, box-shadow 220ms ease, border-color 200ms ease',
};
const cardIcon: React.CSSProperties = {
  fontSize: 26, width: 48, height: 48, borderRadius: 14,
  background: '#F0FDFA', border: '1px solid #CCFBF1',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};
const soonPill: React.CSSProperties = {
  fontSize: 10, color: '#94A3B8', background: '#F1F5F9',
  padding: '2px 6px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
};
const arrow: React.CSSProperties = {
  fontSize: 20, color: '#14B8A6', fontWeight: 800,
};
const foot: React.CSSProperties = { marginTop: 24, textAlign: 'center' };
const backLink: React.CSSProperties = {
  fontSize: 13, color: '#64748B', textDecoration: 'none',
};
