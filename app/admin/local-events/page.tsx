'use client';

/**
 * Local Events — Mission Control moderation.
 *
 * Lists community-hosted events (the `events` collection) with a
 * status filter (Upcoming / Past / All), a search box, and a
 * delete-with-confirm action. Admins never edit a host's event copy —
 * if a listing is problematic the only remedy is removal.
 *
 * FriendPlace-curated events (website RSVPs, `cms_events` collection)
 * stay on the existing /admin/events page, which also supports create
 * + edit. The two surfaces are intentionally separate so one admin
 * action can't accidentally delete a curator-authored row.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { localEventsApi, type LocalEventRow } from '@/lib/cms-api';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

type StatusFilter = 'upcoming' | 'past' | 'all';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past',     label: 'Past' },
  { key: 'all',      label: 'All' },
];

export default function AdminLocalEventsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('upcoming');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LocalEventRow[]>([]);
  const [stats, setStats] = useState({ total: 0, upcoming: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await localEventsApi.list({
        q: q.trim() || undefined,
        status: statusFilter,
        limit: 200,
      });
      setRows(r.rows || []);
      setStats({ total: r.total, upcoming: r.upcoming, cancelled: r.cancelled });
    } catch (e: any) {
      setToast(e?.message || 'Failed to load events');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, q]);

  useEffect(() => { load(); }, [load]);

  const remove = async (row: LocalEventRow) => {
    const title  = row.title?.trim() || '(untitled)';
    const host   = row.host_name || 'Someone';
    const when   = formatEventWhen(row);
    const confirmMsg =
      `Delete this local event permanently?\n\n` +
      `"${title.slice(0, 100)}${title.length > 100 ? '…' : ''}"\n` +
      `by ${host}${when ? ` · ${when}` : ''}\n\n` +
      `Members can't recover it and any RSVPs will be dropped. This action is logged.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(row.id);
    try {
      await localEventsApi.remove(row.id);
      await load();
      setToast('Event deleted');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell title="Local Events">
      <div style={intro}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, margin: 0 }}>
          Member-hosted community events. Upcoming shows events today or in the
          future, Past shows events whose date has ended. Delete requires a
          confirmation.{' '}
          <span style={{ color: '#94A3B8' }}>
            FriendPlace-curated events live on the <b>Events</b> page.
          </span>
        </p>
      </div>

      {/* Stats cards */}
      <div style={statsRow}>
        <StatCard label="Total events" value={stats.total} />
        <StatCard label="Upcoming"     value={stats.upcoming} />
        <StatCard
          label="Cancelled"
          value={stats.cancelled}
          tone={stats.cancelled > 0 ? 'warn' : 'muted'}
        />
      </div>

      {/* Status tabs + search */}
      <div style={controlsRow}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_TABS.map((t) => {
            const on = statusFilter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatusFilter(t.key)}
                className="cms-btn-ghost"
                style={{
                  ...s.ghostBtn,
                  padding: '8px 14px',
                  background: on ? '#0A2540' : '#FFFFFF',
                  color: on ? '#FFFFFF' : '#0A2540',
                  borderColor: on ? '#0A2540' : '#CBD5E1',
                  fontWeight: 700,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search title, description or location…"
            style={searchInput}
          />
          <button
            type="button"
            className="cms-btn-primary"
            style={{ ...s.primaryBtn, padding: '10px 18px' }}
            onClick={() => load()}
          >
            Search
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#64748B', marginTop: 24 }}>Loading events…</p>
      ) : rows.length === 0 ? (
        <div style={emptyBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GeorgeButterflyMark size={48} />
          </div>
          <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800, marginTop: 8 }}>
            {statusFilter === 'past' ? 'No past events' : statusFilter === 'all' ? 'No events yet' : 'No upcoming events'}
          </div>
          <div style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>
            {statusFilter === 'upcoming'
              ? 'When a member schedules an event in the future, it will show up here.'
              : statusFilter === 'past'
                ? 'Nothing in the archive yet.'
                : 'Try another status or clear the search box.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {rows.map((e) => (
            <EventRow key={e.id} row={e} busy={busyId === e.id} onDelete={() => remove(e)} />
          ))}
        </div>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function EventRow({ row, busy, onDelete }: { row: LocalEventRow; busy: boolean; onDelete: () => void }) {
  const borderColour =
    row.status === 'cancelled'
      ? '#FCA5A5'
      : row.status === 'archived'
        ? '#CBD5E1'
        : '#E2E8F0';
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 16,
      border: `1px solid ${borderColour}`,
      padding: 16,
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 160ms ease',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 14, alignItems: 'flex-start' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: '#F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>
          {row.emoji || '📅'}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 16 }}>
              {row.title || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(untitled)</span>}
            </span>
            {row.status === 'cancelled' ? <Pill tone="danger">Cancelled</Pill> : null}
            {row.status === 'archived' ? <Pill tone="slate">Archived</Pill> : null}
            {row.recurrence ? <Pill tone="slate">{row.recurrence}</Pill> : null}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            Hosted by {row.host_name} · Posted {fmtPostedDate(row.created_at)}
          </div>
          <div style={{ fontSize: 13, color: '#0A2540', fontWeight: 700, marginTop: 6 }}>
            📅 {formatEventWhen(row) || '(no date)'}
          </div>
          {row.location ? (
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
              📍 {row.location}{row.locality ? ` · ${row.locality}` : ''}
            </div>
          ) : null}
          <p style={{ margin: '8px 0 0', color: '#334155', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {row.description || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(no description)</span>}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
            🙋 {row.rsvps_count} going
            {row.capacity ? ` · Capacity ${row.capacity}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="cms-btn-danger"
            style={{ ...s.dangerBtn, padding: '8px 14px', fontSize: 13 }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'danger' | 'slate' }) {
  const palettes: Record<string, { bg: string; ink: string; border: string }> = {
    danger: { bg: '#FEE2E2', ink: '#B91C1C', border: '#FCA5A5' },
    slate:  { bg: '#F1F5F9', ink: '#334155', border: '#CBD5E1' },
  };
  const p = palettes[tone];
  return (
    <span style={{
      background: p.bg, color: p.ink, border: `1px solid ${p.border}`,
      padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

function formatEventWhen(row: LocalEventRow): string {
  if (!row.date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.date);
  if (!m) return row.date;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const datePart = d.toLocaleDateString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = row.time
    ? ` · ${row.time}${row.end_time ? ` – ${row.end_time}` : ''}`
    : '';
  return `${datePart}${timePart}`;
}

function fmtPostedDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatCard({ label, value, hint, tone = 'default' }: {
  label: string; value: number | string; hint?: string; tone?: 'default' | 'warn' | 'amber' | 'muted';
}) {
  const palette: Record<string, { bg: string; ink: string; sub: string; border: string }> = {
    default: { bg: '#FFFFFF', ink: '#0A2540', sub: '#64748B', border: '#E2E8F0' },
    warn:    { bg: '#FEF2F2', ink: '#B91C1C', sub: '#7F1D1D', border: '#FCA5A5' },
    amber:   { bg: '#FEF3C7', ink: '#92400E', sub: '#78350F', border: '#F59E0B' },
    muted:   { bg: '#F8FAFC', ink: '#334155', sub: '#64748B', border: '#E2E8F0' },
  };
  const p = palette[tone];
  return (
    <div style={{
      background: p.bg, borderRadius: 16, border: `1px solid ${p.border}`, padding: 16,
      minWidth: 160, flex: '1 1 160px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: p.sub }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: p.ink, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {hint ? <div style={{ fontSize: 12, color: p.sub, marginTop: 4, lineHeight: 1.35 }}>{hint}</div> : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────
const intro: React.CSSProperties = { marginTop: -12, marginBottom: 20 };
const statsRow: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 };
const controlsRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
  alignItems: 'center', marginBottom: 16,
};
const searchInput: React.CSSProperties = {
  border: '1px solid #CBD5E1', borderRadius: 10, padding: '10px 14px',
  fontSize: 14, minWidth: 260, background: '#FFFFFF', color: '#0A2540',
};
const emptyBox: React.CSSProperties = {
  background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 16,
  padding: 32, textAlign: 'center', marginTop: 20,
};

