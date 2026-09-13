'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { mcgsApi, subscribeToBridge, type Case, type Priority } from '@/lib/mcgs-api';
import { SignalCard } from './SignalCard';

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const OPEN_STATUSES = ['NEW', 'SEEN', 'IN_REVIEW', 'SNOOZED', 'ESCALATED'];

// Same six-category mapping the backend uses (services/mcgs/bridge_categories.py).
// If either side changes, update both.
const CATEGORY_PRODUCERS: Record<string, { label: string; producers: string[] }> = {
  event_approvals:   { label: 'Event Approvals',       producers: ['event_submission', 'event_moderation'] },
  notice_approvals:  { label: 'Notice Approvals',      producers: ['notice_moderation'] },
  member_complaints: { label: 'Member Complaints',     producers: ['member_complaint'] },
  safety_reviews:    { label: 'Safety / Ban Reviews',  producers: ['safety_review'] },
  app_feedback:      { label: 'App Feedback',          producers: ['app_feedback'] },
  support_tickets:   { label: 'Support Tickets',       producers: ['support_ticket'] },
};

// Filter chip labels — human-friendly, with a coloured dot glyph so admins
// can scan by severity at a glance. Order matches P0…P4.
const FILTERS: { key: 'all' | Priority; label: string; glyph?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'P0',  label: 'Critical',    glyph: '🔴' },
  { key: 'P1',  label: 'High',        glyph: '🟠' },
  { key: 'P2',  label: 'Normal',      glyph: '🟡' },
  { key: 'P3',  label: 'Low',         glyph: '🔵' },
  { key: 'P4',  label: 'Information', glyph: '🟢' },
];

export function SignalFeed() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | Priority>('all');
  const searchParams = useSearchParams();
  const categoryKey = searchParams?.get('category') || null;
  const category = categoryKey ? CATEGORY_PRODUCERS[categoryKey] : null;

  useEffect(() => {
    let alive = true;
    const listParams = {
      limit: 100,
      status: OPEN_STATUSES,
      producer: category?.producers,
    };
    (async () => {
      try {
        setLoading(true);
        const { items } = await mcgsApi.listCases(listParams);
        if (alive) { setCases(items); setLoading(false); }
      } catch (err) {
        console.error(err);
        if (alive) setLoading(false);
      }
    })();

    // Live updates via SSE (channel-agnostic Signal bus).
    const unsub = subscribeToBridge((ev) => {
      // For Phase 1 we do a light refetch on any signal/case event.
      // Later we'll patch in-place from the event payload.
      if (ev.type.startsWith('signal.') || ev.type.startsWith('case.')) {
        mcgsApi.listCases(listParams)
          .then(({ items }) => alive && setCases(items))
          .catch(() => { /* ignore transient errors */ });
      }
    });

    return () => { alive = false; unsub(); };
    // Re-subscribe when the category filter changes.
  }, [categoryKey]);

  const filtered = useMemo(() => {
    const list = filter === 'all' ? cases : cases.filter(c => c.priority === filter);
    return [...list].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.last_signal_at).getTime() - new Date(a.last_signal_at).getTime();
    });
  }, [cases, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginRight: 8 }}>
          {category ? `Signal Feed · ${category.label}` : 'Signal Feed'}
        </div>
        {category && (
          <a
            href={typeof window !== 'undefined' ? window.location.pathname : '/admin/bridge'}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: '#F1F5F9', color: '#334155', border: '1px solid #E2E8F0',
              textDecoration: 'none',
            }}
          >
            × Clear category filter
          </a>
        )}
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: filter === f.key ? '#0F172A' : '#FFFFFF',
              color: filter === f.key ? '#FFFFFF' : '#334155',
              border: '1px solid ' + (filter === f.key ? '#0F172A' : '#E2E8F0'),
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
            aria-pressed={filter === f.key}
          >
            {f.glyph && <span aria-hidden>{f.glyph}</span>}
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8' }}>
          {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'case' : 'cases'}`}
        </span>
      </div>

      {loading ? (
        <div style={{
          padding: 40, textAlign: 'center', color: '#64748B',
          background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0',
        }}>Loading signals…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center',
          background: '#F0FDFA', borderRadius: 16, border: '1px solid #CCFBF1',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🌿</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F766E', marginBottom: 4 }}>
            {category ? `Nothing in ${category.label}.` : 'Nothing needs you right now.'}
          </div>
          <div style={{ fontSize: 14, color: '#64748B' }}>Nicely done.</div>
        </div>
      ) : (
        filtered.map(c => (
          <SignalCard
            key={c.id}
            case_={c}
            onChanged={(u) => setCases(prev => prev.map(x => x.id === u.id ? u : x))}
          />
        ))
      )}
    </div>
  );
}
