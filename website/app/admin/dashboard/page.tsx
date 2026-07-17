'use client';

import Link from 'next/link';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';

const CARDS = [
  { href: '/admin/home', title: 'Home page', body: 'Feature cards, hero copy and callouts on the landing page.', icon: '🏠' },
  { href: '/admin/about', title: 'About page', body: 'The story we tell about who FriendPlace is for.', icon: 'ℹ️' },
  { href: '/admin/faqs', title: 'FAQs', body: 'Common questions visitors ask before joining.', icon: '❓' },
  { href: '/admin/media', title: 'Media library', body: 'Reusable images you can drop into any editor.', icon: '🖼️' },
];

export default function DashboardPage() {
  return (
    <AdminShell title="Welcome back 🦋">
      <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, marginTop: -12, marginBottom: 32 }}>
        Edit the FriendPlace marketing website below. Changes go live within about a minute of saving — the site caches for 60 seconds to keep it fast.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
        {CARDS.map(c => (
          <Link key={c.href} href={c.href} style={{ ...adminStyles.card, textDecoration: 'none', display: 'block', marginBottom: 0 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{c.icon}</div>
            <h3 style={{ margin: 0, color: '#0A2540', fontSize: 18, fontWeight: 800 }}>{c.title}</h3>
            <p style={{ color: '#475569', fontSize: 14, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>{c.body}</p>
          </Link>
        ))}
      </div>

      <div style={{ ...adminStyles.card, marginTop: 32, background: 'linear-gradient(135deg, #14B8A6, #0EA5A0)', color: '#FFFFFF', border: 'none' }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#FFFFFF' }}>Coming soon</h3>
        <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9, fontSize: 14, lineHeight: 1.6 }}>
          Success Stories and Founding Members editors are next — they&apos;ll join this list once the current modules are stable.
        </p>
      </div>
    </AdminShell>
  );
}
