'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { cmsApi, repliesApi, type StaleRepliesResponse } from '@/lib/cms-api';
import { getAdmin } from '@/lib/cms-auth';

type Stats = Awaited<ReturnType<typeof cmsApi.stats>>;

/**
 * Quick Actions strip.
 *
 * Live shortcuts route to the relevant editor; disabled ones stay
 * visible (in muted styling) so Garry can *see* what's coming without
 * being able to click through to a broken page. As each future module
 * ships, flipping `enabled: true` here lights the button up — no other
 * change needed on the dashboard.
 */
const QUICK_ACTIONS: Array<{
  icon: string;
  label: string;
  href: string;
  hint: string;
  enabled: boolean;
}> = [
  { icon: '➕', label: 'Add FAQ',            href: '/admin/faqs?new=1',   hint: 'Jump to FAQs & focus a fresh row',    enabled: true  },
  { icon: '🖼️', label: 'Upload Image',        href: '/admin/media?upload=1', hint: 'Open the Media Library uploader', enabled: true  },
  { icon: '📖', label: 'Add Success Story',  href: '/admin/success-stories?new=1', hint: 'Draft a new success story',   enabled: true  },
  { icon: '👥', label: 'Add Founding Member', href: '/admin/founding-members?new=1', hint: 'Draft a new founding member', enabled: true  },
  { icon: '📅', label: 'Add Event',          href: '/admin/events',       hint: 'Coming soon',                        enabled: false },
];

const MODULE_CARDS = [
  { href: '/admin/home',  title: 'Home page',     body: 'Feature cards, hero copy and callouts on the landing page.',   icon: '🏠' },
  { href: '/admin/about', title: 'About page',    body: 'The story we tell about who FriendPlace is for.',              icon: 'ℹ️' },
  { href: '/admin/faqs',  title: 'FAQs',          body: 'Common questions visitors ask before joining.',                icon: '❓' },
  { href: '/admin/media', title: 'Media library', body: 'Reusable images you can drop into any editor.',                icon: '🖼️' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [stale, setStale] = useState<StaleRepliesResponse | null>(null);
  const admin = typeof window !== 'undefined' ? getAdmin() : null;
  const firstName =
    admin?.display_name && admin.display_name.trim()
      ? admin.display_name.trim().split(/\s+/)[0]
      : (admin?.email?.split('@')[0] || 'friend');

  useEffect(() => {
    (async () => {
      try { setStats(await cmsApi.stats()); } catch { /* silent — dashboard still renders */ }
    })();
    // iter164g: fetch the 7-day stale-reply count. Non-blocking — if
    // the endpoint fails we simply don't show the card.
    (async () => {
      try { setStale(await repliesApi.stale({ days: 7, limit: 5 })); } catch { /* silent */ }
    })();
  }, []);

  return (
    <AdminShell title="FriendPlace Mission Control">
      <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, marginTop: -12, marginBottom: 20 }}>
        Welcome back, {firstName}. Manage your website, content and media from one place.
      </p>

      {/* Quick Actions — small icon strip. Kept compact so it doesn't
          compete with the summary tiles for attention. */}
      <div style={quickActionsRow}>
        {QUICK_ACTIONS.map(a => {
          const btnStyle: React.CSSProperties = {
            ...quickActionBtn,
            opacity: a.enabled ? 1 : 0.5,
            cursor: a.enabled ? 'pointer' : 'not-allowed',
          };
          if (a.enabled) {
            return (
              <button
                key={a.label}
                type="button"
                className="cms-quick-action"
                style={btnStyle}
                onClick={() => router.push(a.href)}
                title={a.hint}
              >
                <span style={{ fontSize: 22 }}>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          }
          return (
            <button
              key={a.label}
              type="button"
              style={btnStyle}
              disabled
              title={a.hint}
            >
              <span style={{ fontSize: 22 }}>{a.icon}</span>
              <span>{a.label}</span>
              <span style={quickActionBadge}>Soon</span>
            </button>
          );
        })}
      </div>

      {/* iter164g: Stale replies nudge — shown ONLY when the 7-day
          reply backlog is non-empty. George's quiet reminder, never
          nagging, never auto-sending anything. Non-empty count → a
          soft amber card; empty state → nothing (the dashboard should
          not shout when the inbox is clear). */}
      {stale && stale.count > 0 && (
        <StaleRepliesCard stale={stale} />
      )}

      {/* Live summary strip */}
      <div style={summaryGrid}>
        <SummaryCard emoji="📝" label="Website pages"     value={stats?.pages_count} tone="teal" />
        <SummaryCard emoji="🖼️" label="Media library"     value={stats?.media_count} tone="navy" />
        <SummaryCard emoji="❓" label="FAQs"              value={stats?.faqs_count} tone="teal" />
        <SummaryCard emoji="📖" label="Success stories"   value={stats?.success_stories_count} tone="navy" />
        <SummaryCard emoji="👥" label="Founding members"  value={stats?.founding_members_count_editable} tone="teal" />
      </div>

      {/* Expanded System Status card */}
      <SystemStatusPanel system={stats?.system} />

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

/** Expanded System Status card — one wide panel, five signals. */
function SystemStatusPanel({ system }: { system?: Stats['system'] }) {
  const loading = !system;
  const website = system?.website;
  const api = system?.api;
  const database = system?.database;

  const websiteTone = website?.color || 'amber';
  const websitePalette = STATUS_PALETTE[websiteTone];

  const apiOk = api?.ok ?? true;
  const dbOk  = database?.ok ?? true;

  return (
    <div style={systemPanel}>
      <div style={systemPanelHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🩺</span>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 800, color: '#64748B' }}>System status</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0A2540', marginTop: 2 }}>
              Everything you need to know at a glance
            </div>
          </div>
        </div>
        <div style={systemVersionPill}>
          <span style={{ opacity: 0.75 }}>📦</span>
          <span>v{system?.app_version || '—'}</span>
        </div>
      </div>

      <div style={systemGrid}>
        <StatusRow
          icon="🌐" label="Website"
          value={loading ? '…' : (website?.label || '—')}
          dotColor={websitePalette.ring}
          tint={websitePalette.tint}
        />
        <StatusRow
          icon="⚡" label="API"
          value={loading ? '…' : (api?.label || '—')}
          dotColor={apiOk ? '#10B981' : '#EF4444'}
          tint={apiOk ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)'}
        />
        <StatusRow
          icon="🗄️" label="Database"
          value={loading ? '…' : (database?.label || '—')}
          dotColor={dbOk ? '#10B981' : '#EF4444'}
          tint={dbOk ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)'}
        />
        <StatusRow
          icon="🚀" label="Last publish"
          value={loading ? '…' : relativeTime(system?.last_publish_at)}
          dotColor="#14B8A6"
          tint="rgba(20,184,166,0.10)"
        />
      </div>
    </div>
  );
}

function StatusRow({ icon, label, value, dotColor, tint }: {
  icon: string; label: string; value: string; dotColor: string; tint: string;
}) {
  return (
    <div style={{ ...statusRow, background: tint }}>
      <span style={{ fontSize: 18, opacity: 0.85 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0A2540', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </div>
      </div>
      <span style={{
        width: 10, height: 10, borderRadius: 999, background: dotColor,
        boxShadow: `0 0 0 4px ${dotColor}22`, flexShrink: 0,
      }} />
    </div>
  );
}

/** ISO → "2 minutes ago" / "just now" / "3 days ago". */
/** ISO → "2 minutes ago" / "just now" / "3 days ago". */
function relativeTime(iso?: string): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.round(diff / 1000);
  if (s < 30) return 'Just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// iter164g: Stale-replies nudge card
// ---------------------------------------------------------------------------
//
// Rendered on the Mission Control dashboard when the 7-day reply
// backlog is non-empty. Warm amber card, oldest three sender names,
// single primary link to the Replies inbox. Nothing auto-sends;
// George's role is to remind, not to act.

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const diffMs = Date.now() - then;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function StaleRepliesCard({ stale }: { stale: StaleRepliesResponse }) {
  const preview = stale.replies.slice(0, 3);
  const remainder = Math.max(0, stale.count - preview.length);
  return (
    <div
      data-testid="stale-replies-card"
      style={{
        marginTop: 4,
        marginBottom: 20,
        padding: 20,
        borderRadius: 18,
        border: '1px solid rgba(245,158,11,0.35)',
        background: 'linear-gradient(140deg, #FFFBEB 0%, #FEF3C7 100%)',
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: 28, lineHeight: 1 }}>⏰</div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 800, color: '#92400E' }}>
          Stale replies · {stale.days}-day nudge
        </div>
        <div style={{ marginTop: 4, color: '#0A2540', fontSize: 17, fontWeight: 800, lineHeight: 1.35 }}>
          {stale.count} {stale.count === 1 ? 'reply has' : 'replies have'}
          {' '}been waiting on you for more than {stale.days} days.
        </div>
        <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 20, color: '#475569', fontSize: 14, lineHeight: 1.6 }}>
          {preview.map((r) => {
            const d = daysSince(r.received_at);
            return (
              <li key={r.id} data-testid={`stale-row-${r.id}`}>
                <strong style={{ color: '#0A2540' }}>{r.from_name || r.from_email}</strong>
                {r.subject ? <> — <em>{r.subject}</em></> : null}
                <span style={{ color: '#92400E', fontWeight: 700 }}> · {d}d</span>
              </li>
            );
          })}
          {remainder > 0 && (
            <li style={{ color: '#64748B' }}>
              …and {remainder} more waiting.
            </li>
          )}
        </ul>
      </div>
      <Link
        href="/admin/replies?filter=awaiting"
        data-testid="stale-replies-open-link"
        style={{
          ...adminStyles.primaryBtn,
          background: '#B45309',
          borderColor: '#B45309',
          textDecoration: 'none',
          display: 'inline-block',
          whiteSpace: 'nowrap',
        }}
      >
        Open Replies inbox →
      </Link>
    </div>
  );
}

// ---------- Style objects -------------------------------------------------

const STATUS_PALETTE: Record<'amber' | 'green' | 'red', { ring: string; tint: string }> = {
  amber: { ring: '#F59E0B', tint: 'rgba(245,158,11,0.12)' },
  green: { ring: '#10B981', tint: 'rgba(16,185,129,0.10)' },
  red:   { ring: '#EF4444', tint: 'rgba(239,68,68,0.12)' },
};

const quickActionsRow: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 20,
};

const quickActionBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  borderRadius: 999,
  border: '1.5px solid #E2E8F0',
  background: '#FFFFFF',
  color: '#0A2540',
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
  boxShadow: '0 2px 6px rgba(10,37,64,0.04)',
};

const quickActionBadge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#94A3B8',
  background: '#F1F5F9',
  padding: '2px 8px',
  borderRadius: 999,
  marginLeft: 4,
};

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

const systemPanel: React.CSSProperties = {
  marginTop: 18,
  padding: 20,
  borderRadius: 20,
  border: '1px solid #E2E8F0',
  background: 'linear-gradient(160deg, #FFFFFF 0%, #F8FAFC 100%)',
};

const systemPanelHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
  flexWrap: 'wrap',
  gap: 12,
};

const systemVersionPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 12px',
  borderRadius: 999,
  background: '#F1F5F9',
  color: '#0A2540',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
};

const systemGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
};

const statusRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px',
  borderRadius: 14,
  border: '1px solid rgba(226,232,240,0.7)',
  minHeight: 62,
};
