'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { cmsApi } from '@/lib/cms-api';
import { getAdmin } from '@/lib/cms-auth';

type Stats = Awaited<ReturnType<typeof cmsApi.stats>>;

const MODULE_CARDS = [
  { href: '/admin/home',  title: 'Home page',     body: 'Feature cards, hero copy and callouts on the landing page.',   icon: '🏠' },
  { href: '/admin/about', title: 'About page',    body: 'The story we tell about who FriendPlace is for.',              icon: 'ℹ️' },
  { href: '/admin/faqs',  title: 'FAQs',          body: 'Common questions visitors ask before joining.',                icon: '❓' },
  { href: '/admin/media', title: 'Media library', body: 'Reusable images you can drop into any editor.',                icon: '🖼️' },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const admin = typeof window !== 'undefined' ? getAdmin() : null;
  const firstName =
    admin?.display_name && admin.display_name.trim()
      ? admin.display_name.trim().split(/\s+/)[0]
      : (admin?.email?.split('@')[0] || 'friend');

  useEffect(() => {
    (async () => {
      try { setStats(await cmsApi.stats()); } catch { /* silent — dashboard still renders */ }
    })();
  }, []);

  return (
    <AdminShell title="FriendPlace Mission Control">
      <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, marginTop: -12, marginBottom: 28 }}>
        Welcome back, {firstName}. Manage your website, content and media from one place.
      </p>

      {/* Live summary strip */}
      <div style={summaryGrid}>
        <SummaryCard emoji="📝" label="Website pages" value={stats?.pages_count} tone="teal" />
        <SummaryCard emoji="🖼️" label="Media library" value={stats?.media_count} tone="navy" />
        <SummaryCard emoji="❓" label="FAQs" value={stats?.faqs_count} tone="teal" />
        <SummaryCard emoji="👥" label="Founding members" value={stats?.founder_signups_count} tone="navy" />
        <StatusCard status={stats?.status} />
      </div>

      {/* Module tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginTop: 32 }}>
        {MODULE_CARDS.map(c => (
          <Link
            key={c.href}
            href={c.href}
            className="cms-dash-card"
            style={{ ...adminStyles.card, textDecoration: 'none', display: 'block', marginBottom: 0 }}
          >
            <div className="cms-dash-card-icon" style={{ fontSize: 32, marginBottom: 12 }}>{c.icon}</div>
            <h3 style={{ margin: 0, color: '#0A2540', fontSize: 18, fontWeight: 800 }}>{c.title}</h3>
            <p style={{ color: '#475569', fontSize: 14, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>{c.body}</p>
          </Link>
        ))}
      </div>

      <div style={{ ...adminStyles.card, marginTop: 32, background: 'linear-gradient(135deg, #14B8A6, #0EA5A0)', color: '#FFFFFF', border: 'none' }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#FFFFFF' }}>Coming to Mission Control</h3>
        <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.95, fontSize: 14, lineHeight: 1.6 }}>
          Success Stories · Founding Members · Events · Partnerships · Analytics · Settings — arriving after we ship the current modules.
        </p>
      </div>
    </AdminShell>
  );
}

/** Compact stat tile — colour-coded by tone. */
function SummaryCard({ emoji, label, value, tone }: {
  emoji: string; label: string; value: number | undefined; tone: 'teal' | 'navy';
}) {
  const isTeal = tone === 'teal';
  return (
    <div className="cms-summary-card" style={{
      ...summaryCardBase,
      background: isTeal ? 'linear-gradient(140deg, #CCFBF1 0%, #F0FDFA 100%)' : '#FFFFFF',
      borderColor: isTeal ? 'rgba(20,184,166,0.28)' : '#E2E8F0',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{emoji}</div>
      <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: isTeal ? '#0F766E' : '#64748B' }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: '#0A2540', marginTop: 4, lineHeight: 1.1 }}>
        {value === undefined ? '—' : value}
      </div>
    </div>
  );
}

/** Website status pill — Live / Private / Maintenance. */
function StatusCard({ status }: { status?: Stats['status'] }) {
  const s = status || { label: 'Loading…', color: 'amber' as const, dot: '⚪' };
  const palette: Record<Stats['status']['color'], { bg: string; border: string; ring: string; text: string }> = {
    amber: { bg: 'linear-gradient(140deg, #FEF3C7 0%, #FFFBEB 100%)', border: 'rgba(245,158,11,0.35)', ring: '#F59E0B', text: '#92400E' },
    green: { bg: 'linear-gradient(140deg, #DCFCE7 0%, #F0FDF4 100%)', border: 'rgba(16,185,129,0.35)', ring: '#10B981', text: '#065F46' },
    red:   { bg: 'linear-gradient(140deg, #FEE2E2 0%, #FEF2F2 100%)', border: 'rgba(239,68,68,0.35)',  ring: '#EF4444', text: '#991B1B' },
  };
  const p = palette[s.color] || palette.amber;
  return (
    <div className="cms-summary-card" style={{
      ...summaryCardBase, background: p.bg, borderColor: p.border,
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🌐</div>
      <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: p.text }}>
        Website status
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{
          width: 10, height: 10, borderRadius: 999, background: p.ring,
          boxShadow: `0 0 0 4px ${p.ring}22`, display: 'inline-block',
        }} />
        <span style={{ fontSize: 18, fontWeight: 900, color: '#0A2540' }}>{s.label}</span>
      </div>
    </div>
  );
}

const summaryGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
};
const summaryCardBase: React.CSSProperties = {
  padding: 20,
  borderRadius: 18,
  border: '1px solid #E2E8F0',
  background: '#FFFFFF',
  minHeight: 130,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
};
