'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { momentsApi, type MomentRow, type MomentAdminAction } from '@/lib/cms-api';

/**
 * Share a Moment — Mission Control moderation.
 *
 * Locked with Garry, 31 July 2026 as part of the Recipes → Share a
 * Moment migration. The admin surface intentionally stays lean:
 *
 *  - List: newest-first, with filters for All / Featured / Reported /
 *    Hidden and a search box that hits caption + author name.
 *  - Header stats: total moments, currently featured, reported, hidden.
 *  - Row actions: Feature (Moment of the Week), Unfeature, Hide,
 *    Restore, Clear reports, Delete. Moderators can NEVER edit the
 *    caption or photos — the member's words are theirs.
 *  - Report drawer: inline expansion listing every report with reason
 *    and reporter name, so a moderator can decide in-context.
 */

type FilterKey = 'all' | 'featured' | 'reported' | 'hidden';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'featured', label: 'Featured' },
  { key: 'reported', label: 'Reported' },
  { key: 'hidden',   label: 'Hidden' },
];

const REASON_LABELS: Record<string, string> = {
  inappropriate:   'Inappropriate content',
  spam:            'Spam or advertising',
  not_respectful:  'Not respectful',
  other:           'Something else',
};

export default function AdminMomentsPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MomentRow[]>([]);
  const [stats, setStats] = useState({ total: 0, reported: 0, hidden: 0, featuredId: null as string | null });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await momentsApi.list({ filter, q: q.trim() || undefined, limit: 200 });
      setRows(r.rows || []);
      setStats({ total: r.total, reported: r.reported, hidden: r.hidden, featuredId: r.featured_id || null });
    } catch (e: any) {
      setToast(e?.message || 'Failed to load moments');
      setTimeout(() => setToast(null), 3000);
    } finally { setLoading(false); }
  }, [filter, q]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (id: string, action: MomentAdminAction, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(id);
    try {
      await momentsApi.action(id, action);
      await load();
      const messages: Record<MomentAdminAction, string> = {
        feature:        'Featured as Moment of the Week',
        unfeature:      'Feature removed',
        hide:           'Moment hidden',
        restore:        'Moment restored',
        clear_reports:  'Reports cleared',
      };
      setToast(messages[action]);
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Action failed');
      setTimeout(() => setToast(null), 3000);
    } finally { setBusyId(null); }
  };

  const remove = async (id: string, caption: string) => {
    if (!window.confirm(`Delete this moment permanently?\n\n"${caption.slice(0, 80)}${caption.length > 80 ? '…' : ''}"\n\nMembers can't recover it. Prefer Hide if in doubt.`)) return;
    setBusyId(id);
    try {
      await momentsApi.remove(id);
      await load();
      setToast('Moment deleted');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 3000);
    } finally { setBusyId(null); }
  };

  const featuredRow = useMemo(
    () => rows.find(r => r.id === stats.featuredId) || null,
    [rows, stats.featuredId],
  );

  return (
    <AdminShell title="Share a Moment">
      <div style={intro}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, margin: 0 }}>
          Everyday moments members are sharing on FriendPlace. Feature the best one as{' '}
          <b style={{ color: '#B45309' }}>Moment of the Week</b>, hide anything inappropriate, and keep an
          eye on reports.
        </p>
      </div>

      {/* Stats cards */}
      <div style={statsRow}>
        <StatCard label="Total moments" value={stats.total} />
        <StatCard label="Reported" value={stats.reported} tone={stats.reported > 0 ? 'warn' : 'muted'} />
        <StatCard label="Hidden" value={stats.hidden} tone="muted" />
        <StatCard
          label="This week's feature"
          value={featuredRow ? featuredRow.author_name : '—'}
          hint={featuredRow ? featuredRow.caption.slice(0, 60) + (featuredRow.caption.length > 60 ? '…' : '') : 'No moment featured yet'}
          tone={featuredRow ? 'amber' : 'muted'}
        />
      </div>

      {/* Filter tabs + search */}
      <div style={controlsRow}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTER_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className="cms-btn-ghost"
              style={{
                ...s.ghostBtn,
                padding: '8px 14px',
                background: filter === t.key ? '#0A2540' : '#FFFFFF',
                color: filter === t.key ? '#FFFFFF' : '#0A2540',
                borderColor: filter === t.key ? '#0A2540' : '#CBD5E1',
                fontWeight: 700,
              }}
            >
              {t.label}
              {t.key === 'reported' && stats.reported > 0 ? ` (${stats.reported})` : null}
              {t.key === 'hidden' && stats.hidden > 0 ? ` (${stats.hidden})` : null}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search captions or authors…"
            style={searchInput}
          />
          <button
            className="cms-btn-primary"
            style={{ ...s.primaryBtn, padding: '10px 18px' }}
            onClick={() => load()}
            type="button"
          >
            Search
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#64748B', marginTop: 24 }}>Loading moments…</p>
      ) : rows.length === 0 ? (
        <div style={emptyBox}>
          <div style={{ fontSize: 40 }}>🦋</div>
          <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800, marginTop: 8 }}>
            {filter === 'all' ? 'No moments yet' : 'Nothing in this view'}
          </div>
          <div style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>
            {filter === 'reported'
              ? 'No reports right now — nothing needs your attention.'
              : filter === 'hidden'
                ? 'No moments have been hidden.'
                : filter === 'featured'
                  ? 'No moment is currently featured.'
                  : 'When members start sharing moments, they’ll appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, marginTop: 8 }}>
          {rows.map((m) => (
            <MomentAdminRow
              key={m.id}
              row={m}
              busy={busyId === m.id}
              expanded={expandedReportId === m.id}
              onToggleReports={() => setExpandedReportId(expandedReportId === m.id ? null : m.id)}
              onFeature={() => runAction(m.id, m.featured ? 'unfeature' : 'feature',
                m.featured
                  ? 'Remove this moment as Feature of the Week?'
                  : 'Feature this as Moment of the Week? Any other featured moment will be un-featured.')}
              onHide={() => runAction(m.id, m.hidden ? 'restore' : 'hide',
                m.hidden ? undefined : 'Hide this moment from members?')}
              onClearReports={() => runAction(m.id, 'clear_reports',
                `Clear ${m.reports_count} report${m.reports_count === 1 ? '' : 's'} on this moment?`)}
              onDelete={() => remove(m.id, m.caption)}
            />
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
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em',
                     textTransform: 'uppercase', color: p.sub }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: p.ink, marginTop: 4,
                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 12, color: p.sub, marginTop: 4, lineHeight: 1.35 }}>{hint}</div>
      ) : null}
    </div>
  );
}

function MomentAdminRow({
  row, busy, expanded, onToggleReports, onFeature, onHide, onClearReports, onDelete,
}: {
  row: MomentRow;
  busy: boolean;
  expanded: boolean;
  onToggleReports: () => void;
  onFeature: () => void;
  onHide: () => void;
  onClearReports: () => void;
  onDelete: () => void;
}) {
  const previewPhoto = row.photos && row.photos.length > 0 ? row.photos[0] : null;
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 16,
      border: `1px solid ${row.featured ? '#F59E0B' : row.hidden ? '#FCA5A5' : '#E2E8F0'}`,
      padding: 16,
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 160ms ease',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: previewPhoto ? '88px 1fr auto' : '48px 1fr auto', gap: 14, alignItems: 'flex-start' }}>
        {previewPhoto ? (
           
          <img src={previewPhoto} alt="Moment"
            style={{ width: 88, height: 88, borderRadius: 12, objectFit: 'cover', background: '#F1F5F9' }} />
        ) : (
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: '#F1F5F9',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
          }}>{row.author_avatar || '👤'}</div>
        )}

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 16 }}>{row.author_name || 'Someone'}</span>
            <span style={{ fontSize: 12, color: '#64748B' }}>{relTime(row.created_at)}</span>
            {row.privacy === 'friends' ? <Pill tone="slate">Friends only</Pill> : null}
            {row.featured ? <Pill tone="amber">✨ Moment of the Week</Pill> : null}
            {row.hidden ? <Pill tone="danger">Hidden</Pill> : null}
            {row.reports_count > 0 ? (
              <button
                type="button"
                onClick={onToggleReports}
                className="cms-btn-ghost"
                style={{
                  ...s.ghostBtn, padding: '2px 10px', fontSize: 12,
                  borderColor: '#FCA5A5', color: '#B91C1C', background: '#FEF2F2',
                }}
              >
                🚩 {row.reports_count} report{row.reports_count === 1 ? '' : 's'} · {expanded ? 'Hide' : 'View'}
              </button>
            ) : null}
          </div>
          <p style={{ margin: '8px 0 0', color: '#0A2540', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {row.caption || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(no caption)</span>}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
            ❤ {row.likes_count} · 💬 {row.comments_count}
            {row.photos.length > 1 ? ` · 🖼 ${row.photos.length} photos` : null}
          </div>

          {expanded && row.reports.length > 0 ? (
            <div style={{
              marginTop: 12, background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 12, padding: 12,
            }}>
              <div style={{ fontWeight: 800, color: '#B91C1C', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                Reports on this moment
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {row.reports.map(r => (
                  <div key={r.id} style={{ fontSize: 13, color: '#7F1D1D' }}>
                    <b>{REASON_LABELS[r.reason] || r.reason}</b>
                    {r.details ? <> — “{r.details}”</> : null}
                    <span style={{ color: '#B91C1C', opacity: 0.7 }}> · {r.user_name} · {relTime(r.created_at)}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={onClearReports}
                className="cms-btn-ghost"
                style={{ ...s.ghostBtn, padding: '6px 12px', marginTop: 10, fontSize: 12 }}
              >
                Clear reports
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onFeature}
            disabled={busy || row.hidden}
            className="cms-btn-primary"
            style={{
              ...s.primaryBtn,
              padding: '8px 14px', fontSize: 13,
              background: row.featured ? '#F59E0B' : undefined,
            }}
          >
            {row.featured ? 'Unfeature' : '✨ Feature'}
          </button>
          <button
            type="button"
            onClick={onHide}
            disabled={busy}
            className="cms-btn-ghost"
            style={{ ...s.ghostBtn, padding: '8px 14px', fontSize: 13 }}
          >
            {row.hidden ? 'Restore' : 'Hide'}
          </button>
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

function Pill({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'danger' | 'slate' }) {
  const palettes: Record<string, { bg: string; ink: string; border: string }> = {
    amber:  { bg: '#FEF3C7', ink: '#92400E', border: '#F59E0B' },
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

function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const secs = Math.round(diff / 1000);
  if (secs < 30) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ──────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────
const intro: React.CSSProperties = {
  marginTop: -12,
  marginBottom: 20,
};
const statsRow: React.CSSProperties = {
  display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20,
};
const controlsRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
  alignItems: 'center', marginBottom: 16,
};
const searchInput: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '10px 14px',
  fontSize: 14,
  minWidth: 260,
  background: '#FFFFFF',
  color: '#0A2540',
};
const emptyBox: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px dashed #CBD5E1',
  borderRadius: 16,
  padding: 32,
  textAlign: 'center',
  marginTop: 20,
};
