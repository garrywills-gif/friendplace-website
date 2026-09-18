'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  // iter156 drill-down fix (Garry, 7 Aug 2026): the six category
  // tiles at the top of the Bridge link to `?category=<key>` and this
  // feed filters accordingly — but the feed lives BELOW several other
  // cards, so clicking a tile felt like nothing happened (the URL
  // updated, the feed re-fetched, but it was off-screen). Now:
  //   • When a category filter arrives (either from a tile click or a
  //     direct URL load with `?category=…`), we smooth-scroll this
  //     feed section into view once the drill-down result is on
  //     screen. `sectionRef` anchors it; a small delay lets the fetch
  //     settle so we don't scroll to a "Loading…" placeholder.
  //   • The first case card in a drilled-down feed briefly glows so
  //     the eye lands where the number `1` promised — makes the
  //     drill-down feel deliberate, not accidental.
  const sectionRef = useRef<HTMLDivElement>(null);
  const [highlightFirst, setHighlightFirst] = useState(false);

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

  // Drill-down affordance — scroll the feed into view + briefly glow
  // the first result whenever a category filter is active. Runs on
  // both tile-click navigations and direct URL loads. Guarded by
  // `loading` so we scroll to real content, not the loading skeleton.
  useEffect(() => {
    if (!categoryKey) { setHighlightFirst(false); return; }
    if (loading) return;
    const el = sectionRef.current;
    if (!el) return;
    // Small delay so the browser can lay out the freshly-rendered
    // results before we measure their position. `block: 'start'`
    // lines the heading up under the sticky Ask George bar.
    const t = window.setTimeout(() => {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch { el.scrollIntoView(); } // older browsers
    }, 60);
    setHighlightFirst(true);
    const clear = window.setTimeout(() => setHighlightFirst(false), 2200);
    return () => { window.clearTimeout(t); window.clearTimeout(clear); };
  }, [categoryKey, loading, cases.length]);

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
    <div ref={sectionRef} id="bridge-signal-feed" style={{ scrollMarginTop: 84 }}>
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
        filtered.map((c, idx) => {
          const isDrillFirst = idx === 0 && highlightFirst && !!category;
          return (
            <div
              key={c.id}
              style={isDrillFirst ? {
                borderRadius: 14,
                boxShadow: '0 0 0 3px rgba(14,165,233,0.32)',
                transition: 'box-shadow 260ms ease-out',
              } : { transition: 'box-shadow 260ms ease-out' }}
            >
              <SignalCard
                case_={c}
                onChanged={(u) => setCases(prev => prev.map(x => x.id === u.id ? u : x))}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
