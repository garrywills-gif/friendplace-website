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
      )}
    </AdminShell>
  );
}

function SegmentCard({ seg, busy, onRefresh, onDuplicate, onArchive }: {
  seg: Segment; busy: boolean;
  onRefresh: () => void; onDuplicate: () => void; onArchive: () => void;
}) {
  const lastCount = seg.last_count ?? 0;
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1.5px solid #E2E8F0',
      borderRadius: 20,
      padding: 20,
      display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          fontSize: 32, lineHeight: 1, flexShrink: 0,
          filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.05))',
        }}>
          {seg.emoji || '•'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/admin/segments/${seg.id}`} style={{
            display: 'block', fontSize: 17, fontWeight: 900, color: '#0A2540',
            textDecoration: 'none', lineHeight: 1.25,
          }}>
            {seg.name}
          </Link>
          {seg.description && (
            <div style={{ marginTop: 4, fontSize: 13, color: '#64748B', lineHeight: 1.4 }}>
              {seg.description}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '10px 0', borderTop: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#0F766E', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {lastCount.toLocaleString('en-AU')}
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: 600 }}>
          member{lastCount === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#94A3B8' }}>
        {seg.last_counted_at
          ? `Refreshed ${relativeTime(seg.last_counted_at)}`
          : 'Never refreshed'}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <Link href={`/admin/segments/${seg.id}`} style={ghostBtn}>Edit</Link>
        <button onClick={onDuplicate} disabled={busy} style={ghostBtn}>Duplicate</button>
        <button onClick={onRefresh}   disabled={busy} style={ghostBtn}>{busy ? '…' : 'Refresh'}</button>
        <button onClick={onArchive}   disabled={busy} style={{ ...ghostBtn, color: '#B91C1C' }}>Archive</button>
      </div>
    </div>
  );
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
