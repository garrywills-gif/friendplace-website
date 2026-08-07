'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * Reusable "Coming in Slice N" placeholder. Every unfinished migration
 * slice gets a real route so the sidebar never 404s, and Garry can see
 * exactly what's coming next.
 *
 * We deliberately keep this deep and plain-text rather than a fancy
 * marketing card — it's meant to inspire *building*, not looking.
 */
export function ComingSoon({
  slice,
  title,
  description,
  parity,
  improvements,
  audit,
}: {
  slice: number;
  title: string;
  description: string;
  parity: string[];
  improvements: string[];
  audit: string; // link back to the exact matrix entry
}) {
  return (
    <AdminShell title={title}>
      <div style={wrap}>
        <div style={eyebrow}>
          <span style={pill}>Slice {slice}</span>
          <span style={eyebrowLabel}>Coming next in the MCGS migration</span>
        </div>

        <p style={lede}>{description}</p>

        <div style={twoCol}>
          <section style={col}>
            <h2 style={h2}>Feature parity we're bringing across</h2>
            <ul style={list}>{parity.map((p) => <li key={p} style={li}>{p}</li>)}</ul>
          </section>

          <section style={col}>
            <h2 style={h2}>Improvements we're making while migrating</h2>
            <ul style={list}>{improvements.map((i) => <li key={i} style={li}>{i}</li>)}</ul>
          </section>
        </div>

        <p style={footNote}>
          Full context lives in the{' '}
          <Link href="/admin/audit-log" style={link}>audit-log foundation</Link>
          {' '}and the migration matrix at{' '}
          <code style={code}>{audit}</code>. As each item ships this page will be
          replaced with the real screen.
        </p>
      </div>
    </AdminShell>
  );
}

// Tiny inline styles so the placeholder stays self-contained.
const wrap: React.CSSProperties = { maxWidth: 960, marginTop: -8 };
const eyebrow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 };
const pill: React.CSSProperties = {
  fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase',
  padding: '4px 10px', borderRadius: 999, color: '#0F172A',
  background: 'linear-gradient(180deg, #FEFCE8 0%, #FEF3C7 100%)',
  border: '1px solid #FBBF24',
};
const eyebrowLabel: React.CSSProperties = { fontSize: 12, color: '#64748B', fontWeight: 700 };
const lede: React.CSSProperties = { color: '#475569', fontSize: 16, lineHeight: 1.55, margin: '4px 0 24px' };
const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 };
const col: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: '18px 20px' };
const h2: React.CSSProperties = { fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0F172A', marginTop: 0, marginBottom: 10 };
const list: React.CSSProperties = { margin: 0, paddingLeft: 20 };
const li: React.CSSProperties = { color: '#334155', fontSize: 14, lineHeight: 1.55, margin: '4px 0' };
const footNote: React.CSSProperties = { color: '#64748B', fontSize: 13, marginTop: 8 };
const link: React.CSSProperties = { color: '#0F766E', fontWeight: 700, textDecoration: 'underline' };
const code: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

// Small helper — kept intentionally unused externally now that each
// placeholder page renders <ComingSoon /> directly (Next.js's server /
// client boundary doesn't allow a factory returning a client component
// from a server-component page).
