'use client';

/**
 * Segments — Mission Control (CRM Phase 2C).
 *
 * Locked with Garry, 1 Aug 2026:
 *   "Segments should feel like communities of people, not database
 *    queries." Emoji-first, member count front-and-centre, description
 *    optional but encouraged. Live audience estimate as filters change.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { segmentsApi, type Segment } from '@/lib/cms-api';

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);  // id of segment being mutated

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const r = await segmentsApi.list();
      setSegments(r.items);
    } catch (e: any) {
      setErr(e?.message || 'Could not load segments');
    }
  };

  const onRefresh = async (id: string) => {
    setBusy(id);
    try {
      await segmentsApi.refreshCount(id);
      await load();
    } finally { setBusy(null); }
  };

  const onDuplicate = async (seg: Segment) => {
    setBusy(seg.id);
    try {
      const copy = await segmentsApi.create({
        name: `${seg.name} (copy)`,
        emoji: seg.emoji || undefined,
        description: seg.description || undefined,
        predicate: seg.predicate as any,
      });
      // Navigate to the copy's edit page so it feels intentional.
      window.location.href = `/admin/segments/${copy.id}`;
    } finally { setBusy(null); }
  };

  const onArchive = async (id: string) => {
    if (!confirm('Archive this segment? You can restore it later from the archived list.')) return;
    setBusy(id);
    try {
      await segmentsApi.archive(id);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <AdminShell title="Segments">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, color: '#475569', fontSize: 14, maxWidth: 640 }}>
            Segments are saved groups of members we care about. Use them to
            target campaigns, ask George questions, or just get a feel for
            how communities are growing.
          </p>
        </div>
        <Link href="/admin/segments/new" style={{ ...s.primaryBtn, textDecoration: 'none' }}>
          + New segment
        </Link>
      </div>

      {err && <p style={{ color: '#B91C1C' }}>{err}</p>}
      {!err && segments === null && <p style={{ color: '#64748B' }}>Loading…</p>}
      {segments && segments.length === 0 && (
        <div style={{ padding: 32, background: '#F8FAFC', borderRadius: 16, textAlign: 'center', color: '#64748B' }}>
          No segments saved yet. <Link href="/admin/segments/new" style={{ color: '#0F766E', fontWeight: 700 }}>Create your first one</Link>.
        </div>
      )}
      {segments && segments.length > 0 && (
        <>
          {(() => {
            const total = segments.reduce((sum, s) => sum + (s.last_count || 0), 0);
            return (
              <div style={{
                marginBottom: 20, fontSize: 14, color: '#0F766E', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 18 }}>🦋</span>
                <span>
                  {segments.length} saved segment{segments.length === 1 ? '' : 's'}
                  <span style={{ color: '#64748B', fontWeight: 500 }}> · {total.toLocaleString('en-AU')} members represented across your communities</span>
                </span>
              </div>
            );
          })()}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {segments.map((seg) => (
              <SegmentCard
                key={seg.id}
                seg={seg}
                busy={busy === seg.id}
                onRefresh={() => onRefresh(seg.id)}
                onDuplicate={() => onDuplicate(seg)}
                onArchive={() => onArchive(seg.id)}
              />
            ))}
          </div>
        </>
      )}
    </AdminShell>
  );
}

function SegmentCard({ seg, busy, onRefresh, onDuplicate, onArchive }: {
  seg: Segment; busy: boolean;
  onRefresh: () => void; onDuplicate: () => void; onArchive: () => void;
}) {
  const lastCount = seg.last_count ?? 0;
  const theme = themeForSegment(seg);
  return (
    <div style={{
      background: theme.cardBg,
      border: `1.5px solid ${theme.border}`,
      borderRadius: 20,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'transform 0.15s, box-shadow 0.15s',
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    }}>
      {/* Tinted header — enough colour for the eye to find it, not so much it shouts. */}
      <div style={{
        background: theme.headerBg,
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          fontSize: 30, lineHeight: 1, flexShrink: 0,
          filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.05))',
        }}>
          {seg.emoji || '•'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/admin/segments/${seg.id}`} style={{
            display: 'block', fontSize: 17, fontWeight: 900, color: theme.headerText,
            textDecoration: 'none', lineHeight: 1.25,
          }}>
            {seg.name}
          </Link>
          {seg.description && (
            <div style={{ marginTop: 3, fontSize: 12, color: theme.headerMuted, lineHeight: 1.4 }}>
              {seg.description}
            </div>
          )}
        </div>
      </div>

      {/* Body — kept clean white so the count reads clearly against the tinted header. */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, background: '#FFFFFF', flex: 1 }}>
        <div>
          <div style={{ fontSize: 32, fontWeight: 900, color: theme.countText, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {lastCount.toLocaleString('en-AU')}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: 600 }}>
            member{lastCount === 1 ? '' : 's'}
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#94A3B8' }}>
          {seg.last_counted_at ? `Refreshed ${relativeTime(seg.last_counted_at)}` : 'Never refreshed'}
        </div>

        {/* Primary action — 1-click into campaign creator with segment pre-selected. */}
        <Link
          href={`/admin/campaigns/new?segment_id=${encodeURIComponent(seg.id)}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '9px 12px', borderRadius: 10,
            background: theme.ctaBg, color: theme.ctaText,
            fontSize: 13, fontWeight: 800, textDecoration: 'none',
            border: `1px solid ${theme.ctaBorder}`,
          }}
        >
          📧 Create Campaign
        </Link>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link href={`/admin/segments/${seg.id}`} style={ghostBtn}>Edit</Link>
          <button onClick={onDuplicate} disabled={busy} style={ghostBtn}>Duplicate</button>
          <button onClick={onRefresh}   disabled={busy} style={ghostBtn}>{busy ? '…' : 'Refresh'}</button>
          <button onClick={onArchive}   disabled={busy} style={{ ...ghostBtn, color: '#B91C1C' }}>Archive</button>
        </div>
      </div>
    </div>
  );
}

// ── Segment palette ─────────────────────────────────────────────
// Each theme is subtle on purpose. Locked with Garry, 1 Aug 2026:
// "Not bright colours — just enough that your eye can instantly find them."
// The header gets the tint, the body stays white so the count reads clean.
type Theme = {
  cardBg: string; border: string;
  headerBg: string; headerText: string; headerMuted: string;
  countText: string; ctaBg: string; ctaBorder: string; ctaText: string;
};

const THEMES: Record<string, Theme> = {
  coffee:    { cardBg:'#FFFFFF', border:'#E7DFCB', headerBg:'#F5EEDC', headerText:'#5C4A2E', headerMuted:'#8B7A5C', countText:'#78350F', ctaBg:'#FEF6E4', ctaBorder:'#E7DFCB', ctaText:'#78350F' },
  green:     { cardBg:'#FFFFFF', border:'#CDEBD3', headerBg:'#E5F5E7', headerText:'#14532D', headerMuted:'#4B7A55', countText:'#166534', ctaBg:'#ECFDF3', ctaBorder:'#CDEBD3', ctaText:'#166534' },
  blue:      { cardBg:'#FFFFFF', border:'#CBDDF3', headerBg:'#E4EDFA', headerText:'#1E3A8A', headerMuted:'#4B6598', countText:'#1D4ED8', ctaBg:'#EFF4FC', ctaBorder:'#CBDDF3', ctaText:'#1D4ED8' },
  teal:      { cardBg:'#FFFFFF', border:'#B5E5DE', headerBg:'#DFF5F1', headerText:'#0F5E52', headerMuted:'#4B7B72', countText:'#0F766E', ctaBg:'#EBF9F5', ctaBorder:'#B5E5DE', ctaText:'#0F766E' },
  gold:      { cardBg:'#FFFFFF', border:'#F0E1B7', headerBg:'#FBF3D9', headerText:'#7A5A0F', headerMuted:'#9A7E3B', countText:'#B45309', ctaBg:'#FEF9E4', ctaBorder:'#F0E1B7', ctaText:'#B45309' },
  grey:      { cardBg:'#FFFFFF', border:'#DBE2EC', headerBg:'#EEF1F6', headerText:'#334155', headerMuted:'#64748B', countText:'#475569', ctaBg:'#F5F7FA', ctaBorder:'#DBE2EC', ctaText:'#475569' },
  amber:     { cardBg:'#FFFFFF', border:'#F3D7B0', headerBg:'#FBECD5', headerText:'#78350F', headerMuted:'#9A6B3B', countText:'#B45309', ctaBg:'#FEF3E4', ctaBorder:'#F3D7B0', ctaText:'#B45309' },
  rose:      { cardBg:'#FFFFFF', border:'#EED0D3', headerBg:'#F9E2E5', headerText:'#7F1D1D', headerMuted:'#985258', countText:'#B91C1C', ctaBg:'#FDECEE', ctaBorder:'#EED0D3', ctaText:'#B91C1C' },
  coral:     { cardBg:'#FFFFFF', border:'#F0D0C0', headerBg:'#FBE5D9', headerText:'#7C2D12', headerMuted:'#9C5A3B', countText:'#C2410C', ctaBg:'#FEEEE1', ctaBorder:'#F0D0C0', ctaText:'#C2410C' },
  mint:      { cardBg:'#FFFFFF', border:'#B7E4CE', headerBg:'#DDF5E8', headerText:'#065F46', headerMuted:'#3B7B62', countText:'#047857', ctaBg:'#EBF9F1', ctaBorder:'#B7E4CE', ctaText:'#047857' },
  neutral:   { cardBg:'#FFFFFF', border:'#E2E8F0', headerBg:'#F8FAFC', headerText:'#0A2540', headerMuted:'#64748B', countText:'#0F766E', ctaBg:'#F0FDFA', ctaBorder:'#99F6E4', ctaText:'#0F766E' },
};

function themeForSegment(seg: Segment): Theme {
  // Prefer explicit emoji match, then fall back to name-based guess so
  // future admin-created segments still land on a sensible palette.
  const e = seg.emoji || '';
  const n = (seg.name || '').toLowerCase();
  if (/☕|🍵/.test(e))                           return THEMES.coffee;
  if (/🌱|🌿|🌳|🍃|🌷|🌻|🌸/.test(e))            return THEMES.green;
  if (/🦋/.test(e))                              return THEMES.teal;
  if (/💙|🩵|🌊/.test(e))                        return THEMES.blue;
  if (/✨|🌟|⭐/.test(e))                         return THEMES.gold;
  if (/😴|🌙|💤/.test(e))                        return THEMES.grey;
  if (/⚠️|❗|🔔/.test(e))                          return THEMES.amber;
  if (/🚫|❌|🛑/.test(e))                          return THEMES.rose;
  if (/📍|🗺️|🏙️/.test(e))                         return THEMES.coral;
  if (/🆕|🌱/.test(e))                            return THEMES.mint;
  if (/🚶|🏃|🧘/.test(e))                         return THEMES.green;
  // Name-based fallbacks for admin-created segments.
  if (/coffee|tea/.test(n))                       return THEMES.coffee;
  if (/garden|plant|walk/.test(n))                return THEMES.green;
  if (/founder|founding/.test(n))                 return THEMES.teal;
  if (/moment|share/.test(n))                     return THEMES.gold;
  if (/active|engag/.test(n))                     return THEMES.blue;
  if (/inactive|dormant|haven.*visit|sleep/.test(n)) return THEMES.grey;
  if (/invalid|bounce/.test(n))                    return THEMES.amber;
  if (/opted?.out|banned|restrict/.test(n))       return THEMES.rose;
  if (/sydney|melbourne|brisbane|perth|adelaide|location|state/.test(n)) return THEMES.coral;
  if (/new|joined|welcome/.test(n))               return THEMES.mint;
  return THEMES.neutral;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const s    = Math.round((now - then) / 1000);
  if (s < 60)      return `${s}s ago`;
  if (s < 3600)    return `${Math.round(s/60)}m ago`;
  if (s < 86400)   return `${Math.round(s/3600)}h ago`;
  if (s < 604800)  return `${Math.round(s/86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

const ghostBtn: React.CSSProperties = {
  cursor: 'pointer', border: '1px solid #E2E8F0', background: '#FFFFFF',
  padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#475569',
};
