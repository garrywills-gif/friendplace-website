'use client';

/**
 * Membership Growth card on The Bridge.
 * Website leads come from the CRM; app membership comes from real app accounts,
 * not the CRM "Joined" status (which can lag behind the actual app).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  cmsApi, foundingMembersCrmApi,
  type CRMFoundingMembersStats, type MemberRow, type MemberActivitySummary,
} from '@/lib/cms-api';

type AppSnapshot = {
  total: number;
  newToday: number | null;
  newWeek: number | null;
  latest: MemberRow | null;
};

// Fetch complete real-member pages for accurate "today" and "latest" metrics.
// At large scale we will need a dedicated backend stats endpoint rather than
// repeatedly downloading member records. Never show guessed partial figures.
const PAGE_SIZE = 100;
const MAX_CLIENT_ROWS = 1000;

async function getAppSnapshot(): Promise<AppSnapshot> {
  const first = await cmsApi.listMembers({ status: 'real', limit: PAGE_SIZE, skip: 0 });
  const total = first.total;
  if (total > MAX_CLIENT_ROWS) {
    return { total, newToday: null, newWeek: null, latest: null };
  }

  const members = [...first.items];
  if (total > 0 && members.length === 0) {
    return { total, newToday: null, newWeek: null, latest: null };
  }
  // Advance by the number actually returned; the API may cap page size.
  while (members.length < total) {
    const page = await cmsApi.listMembers({ status: 'real', limit: PAGE_SIZE, skip: members.length });
    if (!page.items.length) return { total, newToday: null, newWeek: null, latest: null };
    members.push(...page.items);
  }

  const sydneyDay = (date: Date) => new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const today = sydneyDay(new Date());
  const valid = members.filter(m => m.created_at && !Number.isNaN(Date.parse(m.created_at)));
  const newToday = valid.filter(m => sydneyDay(new Date(m.created_at!)) === today).length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newWeek = valid.filter(m => Date.parse(m.created_at!) >= weekAgo).length;
  const latest = valid.reduce<MemberRow | null>((best, m) =>
    !best || Date.parse(m.created_at!) > Date.parse(best.created_at!) ? m : best, null);

  return { total, newToday, newWeek, latest };
}

export function FoundingMembersCard() {
  const [crm, setCrm] = useState<CRMFoundingMembersStats | null>(null);
  const [app, setApp] = useState<AppSnapshot | null>(null);
  const [activity, setActivity] = useState<MemberActivitySummary | null>(null);
  const [crmError, setCrmError] = useState(false);
  const [appError, setAppError] = useState(false);
  const [activityError, setActivityError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [crmResult, appResult, activityResult] = await Promise.allSettled([
          foundingMembersCrmApi.stats(),
          getAppSnapshot(),
          cmsApi.memberActivitySummary(),
        ]);
        if (cancelled) return;
        if (crmResult.status === 'fulfilled') {
          setCrm(crmResult.value);
          setCrmError(false);
        } else {
          setCrmError(true);
        }
        if (appResult.status === 'fulfilled') {
          setApp(appResult.value);
          setAppError(false);
        } else {
          setAppError(true);
        }
        if (activityResult.status === 'fulfilled') {
          setActivity(activityResult.value);
          setActivityError(false);
        } else {
          setActivity(null);
          setActivityError(true);
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const latest = app?.latest;
  const latestName = latest
    ? (latest.display_name || [latest.first_name, latest.last_name].filter(Boolean).join(' ') || latest.username || 'Member')
    : null;
  const latestWhen = latest?.created_at ? relTime(latest.created_at) : '';

  return (
    <section style={card} aria-label="FriendPlace membership growth">
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 21 }}>🦋</span>
          <div>
            <div style={eyebrow}>FriendPlace App</div>
            <div style={title}>App Membership Growth</div>
          </div>
        </div>
        <Link href="/admin/members" style={openLink}>View app members →</Link>
      </div>

      <div style={statsGrid}>
        <Link href="/admin/members" style={{ ...statLink, gridColumn: '1 / -1' }}>
          <StatTile label="Total app members" value={appError ? undefined : app?.total} hint="Genuine FriendPlace members · test and demo accounts excluded" primary />
        </Link>
        <Link href="/admin/members" style={statLink}>
          <StatTile label="Online now" value={activityError ? undefined : activity?.online_now} hint="App activity in the last 5 minutes · excluding admin and test accounts" />
        </Link>
        <Link href="/admin/members" style={statLink}>
          <StatTile label="Active today" value={activityError ? undefined : activity?.active_today} hint="Unique genuine members · Sydney time" />
        </Link>
        <Link href="/admin/members" style={statLink}>
          <StatTile label="Active in 7 days" value={activityError ? undefined : activity?.active_7d} hint="Unique genuine members · last 7 days" />
        </Link>
        <Link href="/admin/members" style={statLink}>
          <StatTile label="Joined today" value={appError ? undefined : app?.newToday ?? undefined} hint="Sydney calendar day" />
        </Link>
        <Link href="/admin/members" style={statLink}>
          <StatTile label="Joined in 7 days" value={appError ? undefined : app?.newWeek ?? undefined} hint="New genuine app members" />
        </Link>
      </div>
      <p style={{ fontSize: 11, color: '#64748B', margin: '9px 0 0' }}>Online now follows the app’s 5-minute presence rule. Activity counts refresh every minute and exclude demo, test and admin accounts. A dash means activity data is unavailable.</p>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <span style={{ color: '#475569', fontSize: 12, fontWeight: 700 }}>
            {app && app.total >= 100 ? '🎉 First milestone achieved — 100 members' : 'First milestone · 100 app members'}
          </span>
          <span style={{ color: '#0F766E', fontSize: 12, fontWeight: 800 }}>
            {appError || !app ? '—' : `${Math.min(100, Math.round(app.total))} / 100`}
          </span>
        </div>
        <div style={{ background: '#E2E8F0', borderRadius: 99, height: 8, marginTop: 7, overflow: 'hidden' }}>
          <div style={{ background: '#0D9488', height: '100%', borderRadius: 99, width: `${app ? Math.min(100, app.total) : 0}%` }} />
        </div>
      </div>

      <div style={latestRow}>
        <div style={{ minWidth: 0 }}>
          <div style={latestLabel}>Latest app member</div>
          {latest && latestName ? (
            <Link href={`/admin/members/${encodeURIComponent(latest.id)}`} style={{ ...latestNameStyle, textDecoration: 'none' }}>
              {latestName}
            </Link>
          ) : (
            <div style={latestNameStyle}>{app?.total === 0 ? 'No members yet' : '—'}</div>
          )}
        </div>
        {latestWhen && <div style={latestTime}>{latestWhen}</div>}
      </div>
      <div style={crmFooter}>
        <span>Website interest registrations</span>
        <Link href="/admin/crm/founding-members" style={{ color: '#0F766E', fontWeight: 800, textDecoration: 'none' }}>
          {crmError || !crm ? '—' : crm.total.toLocaleString('en-AU')} · View CRM →
        </Link>
      </div>
      {(crmError || appError || activityError) && (
        <p style={{ fontSize: 12, color: '#B45309', margin: '10px 0 0' }}>
          Some figures could not be refreshed. Try reloading the Bridge.
        </p>
      )}
      {app && app.total > MAX_CLIENT_ROWS && (
        <p style={{ fontSize: 11, color: '#64748B', margin: '10px 0 0' }}>
          Daily and latest app figures need a server-side statistics endpoint once membership exceeds 1,000.
        </p>
      )}
    </section>
  );
}

function StatTile({ label, value, hint, primary = false }: { label: string; value: number | undefined; hint: string; primary?: boolean }) {
  return (
    <div style={{ ...statTile, ...(primary ? { background: 'linear-gradient(135deg, #0F766E, #14B8A6)', borderColor: '#0F766E' } : {}) }}>
      <div style={{ ...statLabel, ...(primary ? { color: '#CCFBF1' } : {}) }}>{label}</div>
      <div style={{ ...statNumber, ...(primary ? { color: '#FFFFFF', fontSize: 48, letterSpacing: '-0.035em' } : {}) }}>{typeof value === 'number' ? value.toLocaleString('en-AU') : '—'}</div>
      <div style={{ ...statHint, ...(primary ? { color: '#F0FDFA' } : {}) }}>{hint}</div>
    </div>
  );
}

function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const card: React.CSSProperties = {
  display: 'block', background: '#FFFFFF', border: '1px solid #DCEBE9',
  borderRadius: 18, padding: 20, boxShadow: '0 3px 12px rgba(15,118,110,0.07)',
  color: '#0F172A', marginBottom: 16,
};
const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  flexWrap: 'wrap', gap: 10, marginBottom: 14,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
  fontWeight: 800, color: '#94A3B8',
};
const title: React.CSSProperties = {
  fontSize: 17, fontWeight: 800, color: '#0F172A', marginTop: 2,
};
const openLink: React.CSSProperties = {
  color: '#0F766E', fontSize: 12, fontWeight: 800, textDecoration: 'none',
};
const statsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10,
};
const statLink: React.CSSProperties = {
  display: 'block', textDecoration: 'none', color: 'inherit', minWidth: 0,
};
const statTile: React.CSSProperties = {
  background: 'linear-gradient(140deg, #CCFBF1 0%, #F0FDFA 100%)',
  border: '1px solid rgba(20,184,166,0.28)',
  borderRadius: 12, padding: 12, height: '100%', boxSizing: 'border-box',
};
const statLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.03em', textTransform: 'uppercase',
  fontWeight: 800, color: '#0F766E', minHeight: 28,
};
const statNumber: React.CSSProperties = {
  fontSize: 29, fontWeight: 900, color: '#0A2540', marginTop: 3, lineHeight: 1.1,
};
const statHint: React.CSSProperties = {
  fontSize: 10, color: '#64748B', marginTop: 6,
};
const latestRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  gap: 12, marginTop: 14, paddingTop: 12, borderTop: '1px dashed #E2E8F0',
};
const latestLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontWeight: 800, color: '#94A3B8',
};
const latestNameStyle: React.CSSProperties = {
  display: 'inline-block', fontSize: 14, fontWeight: 800, color: '#0A2540',
  marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const latestTime: React.CSSProperties = {
  fontSize: 11, color: '#64748B', fontWeight: 700, whiteSpace: 'nowrap',
};

const crmFooter: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap',
  alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12,
  borderTop: '1px dashed #E2E8F0', color: '#64748B', fontSize: 12,
};
