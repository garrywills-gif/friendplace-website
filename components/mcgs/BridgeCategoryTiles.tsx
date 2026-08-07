'use client';

/**
 * Bridge Category Tiles — six-tile workload summary above the SignalFeed.
 *
 * iter155 Phase 3. Same visual style as `FoundingMembersCard` (light card,
 * bold number, one-line subtitle). Each tile is clickable and filters the
 * SignalFeed below to that category via a `?category=<key>` URL param.
 *
 * Live refresh:
 *   - Polls /api/mcgs/bridge/summary every 30s.
 *   - Also refetches on every SSE Signal / Case event via subscribeToBridge.
 *
 * Categories: Event Approvals · Notice Approvals · Member Complaints ·
 *             Safety / Ban Reviews · App Feedback · Support Tickets.
 * Positive milestone signals are excluded from every tile count — the
 * backend returns them separately under ``milestones``.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mcgsApi, subscribeToBridge, type BridgeSummary, type BridgeCategoryTile } from '@/lib/mcgs-api';

// Glyph + subtle accent per tile — kept minimal so numbers dominate.
const TILE_STYLE: Record<string, { glyph: string; accent: string }> = {
  event_approvals:   { glyph: '📅', accent: '#EA580C' },
  notice_approvals:  { glyph: '📌', accent: '#0EA5E9' },
  member_complaints: { glyph: '⚑',  accent: '#DC2626' },
  safety_reviews:    { glyph: '🛡',  accent: '#7C3AED' },
  app_feedback:      { glyph: '💬', accent: '#059669' },
  support_tickets:   { glyph: '✉️',  accent: '#0F172A' },
};

function humaniseAge(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `oldest ${d}d`;
  if (h >= 1) return `oldest ${h}h`;
  if (m >= 1) return `oldest ${m}m`;
  return `oldest <1m`;
}

export function BridgeCategoryTiles() {
  const [summary, setSummary] = useState<BridgeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeKey = searchParams?.get('category') || null;

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const s = await mcgsApi.bridgeSummary();
        if (!cancelled) { setSummary(s); setError(null); }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load Bridge summary');
      }
    };

    void load();
    // Gentle 30s poll — the SSE hook below will trigger fresher updates
    // whenever anything actually changes.
    interval = setInterval(load, 30_000);

    const unsub = subscribeToBridge((ev) => {
      if (ev.type.startsWith('signal.') || ev.type.startsWith('case.')) {
        void load();
      }
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      unsub();
    };
  }, []);

  const categories = summary?.categories ?? [];
  const total = summary?.total_actionable ?? 0;
  const milestones = summary?.milestones?.open ?? 0;

  return (
    <section aria-label="Bridge workload summary" style={wrap}>
      <div style={headerRow}>
        <div>
          <div style={eyebrow}>What needs your attention</div>
          <div style={heading}>
            {summary
              ? (total === 0
                  ? 'Nothing needs your attention right now.'
                  : `${total} open item${total === 1 ? '' : 's'} across six operational queues.`)
              : 'Loading…'}
          </div>
          {milestones > 0 && (
            <div style={milestonesNote}>
              {milestones} positive milestone{milestones === 1 ? '' : 's'} — informational only.
            </div>
          )}
          {error && <div style={errorNote}>{error}</div>}
        </div>
      </div>

      <div style={grid}>
        {categories.map(cat => (
          <TileLink key={cat.key} cat={cat} active={activeKey === cat.key} pathname={pathname} />
        ))}
      </div>
    </section>
  );
}

function TileLink({
  cat, active, pathname,
}: { cat: BridgeCategoryTile; active: boolean; pathname: string | null }) {
  const style = TILE_STYLE[cat.key] || { glyph: '•', accent: '#0F172A' };
  const zero = cat.open === 0;
  const url = active
    ? (pathname || '/admin/bridge')
    : `${pathname || '/admin/bridge'}?category=${cat.key}`;

  // iter156 drill-down (Garry, 7 Aug 2026): the tile is a real
  // <Link> so keyboard / middle-click / open-in-new-tab all still
  // work, but on a plain left-click we also nudge the Signal Feed
  // into view immediately — the feed lives below Morning Briefing
  // and the CRM card so, without this, the URL updated but the
  // filtered result stayed off-screen and admins thought the tile
  // was inert. `scroll={false}` disables Next's default top-scroll
  // so our targeted scroll wins.
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Respect modifier keys and non-primary buttons — those should
    // behave like a normal link (new tab / new window).
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // Defer to next tick so the client-side navigation commits
    // first; then the feed is already re-fetching for the new
    // category and our scroll lands on the right anchor.
    window.setTimeout(() => {
      const el = typeof document !== 'undefined'
        ? document.getElementById('bridge-signal-feed')
        : null;
      if (!el) return;
      try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch { el.scrollIntoView(); }
    }, 30);
  };

  return (
    <Link
      href={url}
      scroll={false}
      onClick={handleClick}
      style={{
        ...tile,
        borderColor: active ? style.accent : '#E2E8F0',
        boxShadow: active
          ? `0 0 0 2px ${style.accent}22, 0 1px 3px rgba(15,23,42,0.06)`
          : '0 1px 3px rgba(15,23,42,0.04)',
      }}
      aria-pressed={active}
    >
      <div style={tileTop}>
        <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>{style.glyph}</span>
        <span style={{ ...tileLabel, color: style.accent }}>{cat.label}</span>
      </div>
      <div style={{
        ...tileCount,
        color: zero ? '#94A3B8' : '#0F172A',
      }}>
        {cat.open}
      </div>
      <div style={tileSub}>
        {zero ? 'All clear' : humaniseAge(cat.oldest_waiting_seconds)}
      </div>
    </Link>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { marginBottom: 20 };
const headerRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
  marginBottom: 12, gap: 16, flexWrap: 'wrap',
};
const eyebrow: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1.2, fontWeight: 700, color: '#64748B',
  textTransform: 'uppercase',
};
const heading: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: '#0F172A', marginTop: 4,
  letterSpacing: '-0.01em',
};
const milestonesNote: React.CSSProperties = {
  fontSize: 12, color: '#64748B', marginTop: 4,
};
const errorNote: React.CSSProperties = {
  fontSize: 12, color: '#DC2626', marginTop: 4,
};
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
};
const tile: React.CSSProperties = {
  display: 'block',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  padding: '14px 16px',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  minHeight: 108,
};
const tileTop: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
};
const tileLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 0.2,
};
const tileCount: React.CSSProperties = {
  fontSize: 30, fontWeight: 800, lineHeight: 1.1, marginTop: 2,
  fontVariantNumeric: 'tabular-nums',
};
const tileSub: React.CSSProperties = {
  fontSize: 11, color: '#94A3B8', fontWeight: 600, marginTop: 4,
};
