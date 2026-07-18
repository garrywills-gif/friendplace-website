'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { clearAuth, getAdmin, isAuthed, type CmsAdmin } from '@/lib/cms-auth';
import { cmsApi } from '@/lib/cms-api';

const NAV: { href: string; label: string; icon: string; badgeKey?: 'submissions' }[] = [
  { href: '/admin/dashboard',        label: 'Dashboard',         icon: '📊' },
  { href: '/admin/home',             label: 'Home page',         icon: '🏠' },
  { href: '/admin/about',            label: 'About page',        icon: 'ℹ️' },
  { href: '/admin/faqs',             label: 'FAQs',              icon: '❓' },
  { href: '/admin/success-stories',  label: 'Success Stories',   icon: '📖' },
  { href: '/admin/founding-members', label: 'Founding Members',  icon: '👥' },
  { href: '/admin/events',           label: 'Events',            icon: '📅' },
  { href: '/admin/event-submissions',label: 'Event Submissions', icon: '📝', badgeKey: 'submissions' },
  { href: '/admin/media',            label: 'Media library',     icon: '🖼️' },
];

/**
 * Sidebar-shell layout used by every protected /admin page.
 * Also guards the route: if the token is missing or invalid, kicks the
 * user back to /admin/login.
 */
export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [admin, setLocalAdmin] = useState<CmsAdmin | null>(null);
  const [pendingSubmissions, setPendingSubmissions] = useState<number>(0);

  useEffect(() => {
    (async () => {
      if (!isAuthed()) { router.replace('/admin/login'); return; }
      try {
        const me = await cmsApi.me();
        setLocalAdmin(me);
      } catch {
        clearAuth();
        router.replace('/admin/login');
        return;
      }
      setReady(true);
    })();
     
  }, []);

  // Refresh the pending submissions badge whenever the route changes so
  // admins see an up-to-date count after approving / rejecting an entry.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await cmsApi.listEventSubmissions('pending');
        if (!cancelled) setPendingSubmissions(res.counts?.pending ?? 0);
      } catch {
        // Silent fail — badge just stays at last known value.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, pathname]);

  const signOut = () => {
    clearAuth();
    router.replace('/admin/login');
  };

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
        <p style={{ color: '#64748B' }}>Loading admin…</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'Public Sans, system-ui, sans-serif', display: 'flex' }}>
      <aside style={sidebar}>
        <Link href="/admin/dashboard" style={sidebarBrand}>
          <span style={{ fontSize: 34, lineHeight: 1 }}>🦋</span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.01em' }}>FriendPlace</div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#5EEAD4', fontWeight: 800, textTransform: 'uppercase', marginTop: 2 }}>Mission Control</div>
          </div>
        </Link>

        <nav style={{ flex: 1, marginTop: 32 }}>
          {NAV.map(item => {
            // Exact match OR next char is "/" so /admin/events doesn't also
            // light up when visiting /admin/event-submissions.
            const active =
              pathname === item.href ||
              (pathname?.startsWith(item.href + '/') ?? false);
            const badgeCount = item.badgeKey === 'submissions' ? pendingSubmissions : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`cms-nav-link${active ? ' cms-nav-link-active' : ''}`}
                style={navLink}
                data-active={active ? '1' : '0'}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {badgeCount > 0 && (
                  <span
                    aria-label={`${badgeCount} pending`}
                    style={navBadge}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '16px 20px' }}>
          <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>Signed in as</div>
          <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 14, marginBottom: 12, wordBreak: 'break-all' }}>{admin?.email}</div>
          <button onClick={signOut} className="cms-sign-out" style={signOutBtn}>Sign out</button>
        </div>
      </aside>

      <main style={mainCol}>
        {title && <h1 style={pageTitle}>{title}</h1>}
        {children}
      </main>
    </div>
  );
}

const sidebar: React.CSSProperties = {
  width: 260,
  background: 'linear-gradient(180deg, #0A2540 0%, #0F2E52 100%)',
  color: '#FFFFFF',
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 0 0',
  position: 'sticky',
  top: 0,
  alignSelf: 'flex-start',
  height: '100vh',
};
const sidebarBrand: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', padding: '0 20px', color: '#FFFFFF', textDecoration: 'none' };
const navLink: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', padding: '12px 20px', fontSize: 15, fontWeight: 700, textDecoration: 'none' };
const navBadge: React.CSSProperties = {
  minWidth: 22,
  height: 22,
  padding: '0 7px',
  borderRadius: 999,
  background: 'linear-gradient(135deg, #F97316, #EF4444)',
  color: '#FFFFFF',
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: '0.02em',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(249,115,22,0.4)',
};
const signOutBtn: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#FFFFFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const mainCol: React.CSSProperties = { flex: 1, padding: '32px 40px 64px', maxWidth: 1200, width: '100%' };
const pageTitle: React.CSSProperties = { fontSize: 28, color: '#0A2540', fontWeight: 900, marginTop: 0, marginBottom: 24 };

// Reusable button/panel styles for admin editor pages.
export const adminStyles = {
  card: {
    background: '#FFFFFF',
    padding: 28,
    borderRadius: 20,
    border: '1px solid #E2E8F0',
    marginBottom: 24,
  } as React.CSSProperties,
  cardTitle: { fontSize: 18, color: '#0A2540', fontWeight: 800, marginTop: 0, marginBottom: 16 } as React.CSSProperties,
  helper: { color: '#64748B', fontSize: 13, marginTop: 6 } as React.CSSProperties,
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 6 } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1.5px solid #CBD5E1',
    fontSize: 15,
    fontFamily: 'inherit',
    background: '#FFFFFF',
    color: '#0A2540',
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1.5px solid #CBD5E1',
    fontSize: 15,
    fontFamily: 'inherit',
    background: '#FFFFFF',
    color: '#0A2540',
    outline: 'none',
    minHeight: 90,
    resize: 'vertical',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  primaryBtn: {
    padding: '12px 22px',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #14B8A6, #0EA5A0)',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(20,184,166,0.25)',
  } as React.CSSProperties,
  ghostBtn: {
    padding: '10px 18px',
    borderRadius: 12,
    border: '1.5px solid #CBD5E1',
    background: '#FFFFFF',
    color: '#0A2540',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  } as React.CSSProperties,
  dangerBtn: {
    padding: '10px 18px',
    borderRadius: 12,
    border: '1.5px solid rgba(239,68,68,0.3)',
    background: '#FFFFFF',
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  } as React.CSSProperties,
  toast: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    padding: '14px 22px',
    borderRadius: 14,
    background: '#0A2540',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 700,
    boxShadow: '0 12px 32px rgba(10,37,64,0.35)',
    zIndex: 1000,
  } as React.CSSProperties,
};
