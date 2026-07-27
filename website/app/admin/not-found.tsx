import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * Segment-level 404 for the /admin/* namespace.
 *
 * Without this file, Next.js falls through to the root not-found
 * page — which wraps its output in the public SiteHeader/SiteFooter.
 * That's the "public marketing chrome behind a Mission Control 404"
 * bug an admin saw when clicking a deep link to /admin/support (a
 * route that hasn't been built yet).
 *
 * By putting the 404 inside <AdminShell> the sidebar/header stay
 * consistent and the admin can jump to any working surface via the
 * existing nav — they aren't dumped onto the public website.
 *
 * Note: this file is a Server Component (no 'use client') so it
 * renders during SSG. AdminShell will still hydrate its client-side
 * auth/session checks in the browser as normal.
 */
export default function AdminNotFound() {
  return (
    <AdminShell>
      <div
        style={{
          maxWidth: 620,
          margin: '48px auto',
          padding: '32px 28px',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          boxShadow: '0 4px 16px rgba(15,23,42,0.05)',
          textAlign: 'center',
          fontFamily: 'Public Sans, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            fontWeight: 800,
            color: '#94A3B8',
            marginBottom: 10,
          }}
        >
          Mission Control
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 900,
            color: '#0F172A',
            margin: 0,
            letterSpacing: '-0.01em',
            lineHeight: 1.25,
          }}
        >
          This admin area isn&rsquo;t available yet.
        </h1>
        <p
          style={{
            fontSize: 15,
            color: '#475569',
            lineHeight: 1.6,
            marginTop: 12,
            marginBottom: 24,
          }}
        >
          Head back to The Bridge or use the sidebar to continue.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <Link
            href="/admin/bridge"
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: 'linear-gradient(135deg,#14B8A6,#0F766E)',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: 14,
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(20,184,166,0.22)',
            }}
          >
            Go to The Bridge
          </Link>
          <Link
            href="/admin/dashboard"
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: '#FFFFFF',
              color: '#0F172A',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
              border: '1px solid #E2E8F0',
            }}
          >
            Dashboard (legacy)
          </Link>
        </div>
        <p
          style={{
            fontSize: 12,
            color: '#94A3B8',
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          If you reached this from a button in Mission Control, please{' '}
          <a
            href="mailto:hello@friendplace.com.au?subject=Mission%20Control%20missing%20page"
            style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'underline' }}
          >
            report it
          </a>{' '}
          so we can connect the missing page.
        </p>
      </div>
    </AdminShell>
  );
}
