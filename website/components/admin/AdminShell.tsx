'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { clearAuth, getAdmin, isAuthed, type CmsAdmin } from '@/lib/cms-auth';
import { cmsApi } from '@/lib/cms-api';
import { AskGeorgeBar } from '@/components/mcgs/AskGeorgeBar';
import { GeorgeButterfly } from '@/components/george/GeorgeButterfly';

/**
 * Sidebar structure — grouped by domain. Items marked `soon: true`
 * light up a small "Soon" pill so admins can see the migration
 * roadmap without needing to open the audit doc. Each of those routes
 * points at a real placeholder page that explains what's coming.
 */
type NavItem = {
  href: string;
  label: string;
  icon: string;
  badgeKey?: 'submissions';
  soon?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Mission Control',
    items: [
      { href: '/admin/bridge',    label: 'The Bridge',           icon: '🌉' },
      { href: '/admin/george',    label: "George's Workspace",   icon: '🦋' },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/members',          label: 'Members',          icon: '👤', soon: true },
      { href: '/admin/enquiries',        label: 'Enquiries',        icon: '📥' },
      { href: '/admin/reports',          label: 'Reports',          icon: '🚩', soon: true },
      { href: '/admin/support',          label: 'Support',          icon: '💬', soon: true },
      { href: '/admin/groups/pending',   label: 'Pending groups',   icon: '👥', soon: true },
      { href: '/admin/events',           label: 'Events',           icon: '📅' },
      { href: '/admin/event-submissions',label: 'Event submissions',icon: '📝', badgeKey: 'submissions' },
      { href: '/admin/announcements',    label: 'Announcements',    icon: '📣', soon: true },
    ],
  },
  {
    label: 'Website',
    items: [
      { href: '/admin/home',             label: 'Home page',        icon: '🏠' },
      { href: '/admin/about',            label: 'About page',       icon: 'ℹ️' },
      { href: '/admin/faqs',             label: 'FAQs',             icon: '❓' },
      { href: '/admin/success-stories',  label: 'Success stories',  icon: '📖' },
      { href: '/admin/founding-members', label: 'Founding members', icon: '🌱' },
      { href: '/admin/media',            label: 'Media library',    icon: '🖼️' },
      { href: '/admin/emails',           label: 'Email templates',  icon: '✉️' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/admin/analytics',        label: 'Analytics',        icon: '📈', soon: true },
      { href: '/admin/audit-log',        label: 'Audit log',        icon: '🧾' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/knowledge',        label: 'Knowledge',        icon: '📚' },
      { href: '/admin/launch',           label: 'Launch',           icon: '🚀' },
      { href: '/admin/security',         label: 'Security',         icon: '🛡️' },
      { href: '/admin/admins',           label: 'Admins',           icon: '👑', soon: true },
      { href: '/admin/settings',         label: 'Settings',         icon: '⚙️', soon: true },
      { href: '/admin/dashboard',        label: 'Dashboard (legacy)', icon: '📊' },
    ],
  },
];

// Flat view retained for the pending-submissions badge lookup below.
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

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
        <Link href="/admin/bridge" style={sidebarBrand}>
          <span style={{ fontSize: 34, lineHeight: 1 }}>🦋</span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.01em' }}>FriendPlace</div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#5EEAD4', fontWeight: 800, textTransform: 'uppercase', marginTop: 2 }}>Mission Control</div>
          </div>
        </Link>

        <nav style={{ flex: 1, marginTop: 24, paddingBottom: 12, overflowY: 'auto' }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={navGroupHeading}>{group.label}</div>
              {group.items.map((item) => {
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
                    {item.soon && !active && <span style={soonPill}>Soon</span>}
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
            </div>
          ))}
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '16px 20px' }}>
          <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>Signed in as</div>
          <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 15, marginBottom: 12, wordBreak: 'break-word' }}>
            {admin?.display_name || admin?.email || 'Admin'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href="/admin/account"
              className={`cms-footer-btn${(pathname === '/admin/account' || pathname?.startsWith('/admin/account/')) ? ' cms-footer-btn-active' : ''}`}
              style={{
                ...footerBtn,
                background: (pathname === '/admin/account' || pathname?.startsWith('/admin/account/')) ? 'rgba(94,234,212,0.15)' : 'transparent',
                borderColor: (pathname === '/admin/account' || pathname?.startsWith('/admin/account/')) ? '#5EEAD4' : 'rgba(255,255,255,0.2)',
                textDecoration: 'none',
              }}
              aria-label="Account settings"
            >
              <span aria-hidden style={{ fontSize: 14 }}>⚙️</span>
              <span>Account</span>
            </Link>
            <button onClick={signOut} className="cms-sign-out" style={{ ...footerBtn, cursor: 'pointer', flex: 1 }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main style={mainCol}>
        <AskGeorgeBar />
        <div style={{ padding: '24px 40px 64px' }}>
          {title && <h1 style={pageTitle}>{title}</h1>}
          {children}
        </div>
      </main>
      {/*
       * George's butterfly. Present on every authenticated admin page.
       * The arrival animation fires at most once per calendar day (with a
       * warmer welcome after ≥ 3 days away). After it lands he simply
       * rests in the corner, quietly keeping company.
       */}
      <GeorgeButterfly actorId={admin?.id} />
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
const navLink: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 20px', fontSize: 14, fontWeight: 700, textDecoration: 'none' };
const navGroupHeading: React.CSSProperties = {
  padding: '6px 20px 6px',
  fontSize: 10,
  letterSpacing: '0.12em',
  color: '#5EEAD4',
  textTransform: 'uppercase',
  fontWeight: 800,
  opacity: 0.75,
};
const soonPill: React.CSSProperties = {
  padding: '2px 7px',
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#0F172A',
  background: '#FBBF24',
  borderRadius: 999,
  fontWeight: 900,
};
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
const footerBtn: React.CSSProperties = {
  flex: 1,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'transparent',
  color: '#FFFFFF',
  fontSize: 13,
  fontWeight: 700,
  display: 'inline-flex',
  gap: 6,
  alignItems: 'center',
  justifyContent: 'center',
};
const mainCol: React.CSSProperties = { flex: 1, maxWidth: 1400, width: '100%' };
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
