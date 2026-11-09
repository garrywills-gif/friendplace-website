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
  type CRMFoundingMembersStats, type MemberRow,
} from '@/lib/cms-api';

type AppSnapshot = {
  total: number;
  newToday: number | null;
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
    return { total, newToday: null, latest: null };
  }

  const members = [...first.items];
  if (total > 0 && members.length === 0) {
    return { total, newToday: null, latest: null };
  }
  // Advance by the number actually returned; the API may cap page size.
  while (members.length < total) {
    const page = await cmsApi.listMembers({ status: 'real', limit: PAGE_SIZE, skip: members.length });
    if (!page.items.length) return { total, newToday: null, latest: null };
    members.push(...page.items);
  }

  const sydneyDay = (date: Date) => new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const today = sydneyDay(new Date());
  const valid = members.filter(m => m.created_at && !Number.isNaN(Date.parse(m.created_at)));
  const newToday = valid.filter(m => sydneyDay(new Date(m.created_at!)) === today).length;
  const latest = valid.reduce<MemberRow | null>((best, m) =>
    !best || Date.parse(m.created_at!) > Date.parse(best.created_at!) ? m : best, null);

  return { total, newToday, latest };
}

export function FoundingMembersCard() {
  const [crm, setCrm] = useState<CRMFoundingMembersStats | null>(null);
  const [app, setApp] = useState<AppSnapshot | null>(null);
  const [crmError, setCrmError] = useState(false);
  const [appError, setAppError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [crmResult, appResult] = await Promise.allSettled([
          foundingMembersCrmApi.stats(),
          getAppSnapshot(),
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
            <div style={eyebrow}>FriendPlace CRM</div>
            <div style={title}>Membership Growth</div>
          </div>
        </div>
        <Link href="/admin/members" style={openLink}>View app members →</Link>
      </div>

      <div style={statsGrid}>
        <Link href="/admin/crm/founding-members" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatTile label="Website registrations" value={crmError ? undefined : crm?.total} hint="CRM · all leads" />
        </Link>
        <Link href="/admin/members" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatTile label="Joined app" value={appError ? undefined : app?.total} hint="Real app accounts" />
        </Link>
        <Link href="/admin/members" style={{ textDecoration: 'none', color: 'inherit' }}>
          <StatTile label="New app members today" value={appError ? undefined : app?.newToday ?? undefined} hint="Sydney time · excluding test/demo" />
        </Link>
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
      {(crmError || appError) && (
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

function StatTile({ label, value, hint }: { label: string; value: number | undefined; hint: string }) {
  return (
    <div style={statTile}>
      <div style={statLabel}>{label}</div>
      <div style={statNumber}>{typeof value === 'number' ? value.toLocaleString('en-AU') : '—'}</div>
      <div style={statHint}>{hint}</div>
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
  display: 'block', background: '#FFFFFF', border: '1px solid #E2E8F0',
  borderRadius: 16, padding: 18, boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
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
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8,
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
