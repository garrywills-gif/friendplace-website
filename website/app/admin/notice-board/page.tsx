'use client';

/**
 * Notice Board — Mission Control moderation.
 *
 * Mirrors the Moments admin surface (list + delete-with-confirm). Admins
 * never edit a member's words — if a post is problematic the only
 * remedy is removal. Delete requires an explicit `window.confirm` with
 * the post title so it can't be fired accidentally.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { noticeBoardApi, noticeCommentsApi, type NoticeBoardRow } from '@/lib/cms-api';
import CommentsDrawer from '@/components/admin/CommentsDrawer';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

// Member-facing category list — kept in sync with the mobile client's
// `CATEGORY_LIST` so the filter chips match what members actually post.
const CATEGORY_CHIPS = [
  'All',
  'Announcement',
  'Question',
  'Event',
  'Kindness',
  'Buy & Sell',
  'Community',
  'Help Needed',
  'Giveaway',
];

export default function AdminNoticeBoardPage() {
  const [category, setCategory] = useState<string>('All');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<NoticeBoardRow[]>([]);
  const [stats, setStats] = useState({ total: 0, reported: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await noticeBoardApi.list({
        q: q.trim() || undefined,
        category: category && category !== 'All' ? category : undefined,
        limit: 200,
      });
      setRows(r.rows || []);
      setStats({ total: r.total, reported: r.reported, active: r.active });
    } catch (e: any) {
      setToast(e?.message || 'Failed to load notices');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [category, q]);

  useEffect(() => { load(); }, [load]);

  const remove = async (row: NoticeBoardRow) => {
    const title = row.title?.trim() || '(untitled)';
    const author = row.author_name || 'Someone';
    const confirmMsg =
      `Delete this notice permanently?\n\n` +
      `"${title.slice(0, 100)}${title.length > 100 ? '…' : ''}"\n` +
      `by ${author}\n\n` +
      `Members can't recover it. This action is logged.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(row.id);
    try {
      await noticeBoardApi.remove(row.id);
      await load();
      setToast('Notice deleted');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell title="Notice Board">
      <div style={intro}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, margin: 0 }}>
          Member-posted notices across every category. Use the filter chips to
          narrow by category, search by title, body or author, and delete
          anything that doesn&rsquo;t belong — a confirmation is required.
        </p>
      </div>

      {/* Stats cards */}
      <div style={statsRow}>
        <StatCard label="Total notices"     value={stats.total} />
        <StatCard label="Currently active"  value={stats.active} tone="default" />
        <StatCard
          label="Reported"
          value={stats.reported}
          tone={stats.reported > 0 ? 'warn' : 'muted'}
        />
      </div>

      {/* Filter chips + search */}
      <div style={controlsRow}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_CHIPS.map((cat) => {
            const on = category === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
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
                {cat}
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
            placeholder="Search title, body or author…"
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
        <p style={{ color: '#64748B', marginTop: 24 }}>Loading notices…</p>
      ) : rows.length === 0 ? (
        <div style={emptyBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GeorgeButterflyMark size={48} />
          </div>
          <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800, marginTop: 8 }}>
            {category === 'All' && !q.trim() ? 'No notices yet' : 'Nothing matches'}
          </div>
          <div style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>
            {category === 'All' && !q.trim()
              ? 'When members post to the Notice Board, they will appear here.'
              : 'Try another category or clear the search box.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {rows.map((n) => (
            <NoticeRow
              key={n.id}
              row={n}
              busy={busyId === n.id}
              expanded={openCommentsFor === n.id}
              onToggleComments={() => setOpenCommentsFor(openCommentsFor === n.id ? null : n.id)}
              onDelete={() => remove(n)}
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

function NoticeRow({ row, busy, expanded, onToggleComments, onDelete }: {
  row: NoticeBoardRow;
  busy: boolean;
  expanded: boolean;
  onToggleComments: () => void;
  onDelete: () => void;
}) {
  const activeStatus = computeActiveStatus(row.active_from, row.active_to);
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 16,
      border: `1px solid ${row.reports_count > 0 ? '#FCA5A5' : '#E2E8F0'}`,
      padding: 16,
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 160ms ease',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 14, alignItems: 'flex-start' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, background: '#F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
        }}>
          {row.author_avatar || '👤'}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 16 }}>
              {row.title || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(untitled)</span>}
            </span>
            <Pill tone="slate">{row.category}</Pill>
            {row.has_image ? <Pill tone="slate">📷 Photo</Pill> : null}
            {row.solved ? <Pill tone="amber">Solved</Pill> : null}
            {activeStatus === 'scheduled' ? <Pill tone="slate">Scheduled</Pill> : null}
            {activeStatus === 'expired' ? <Pill tone="danger">Expired</Pill> : null}
            {row.reports_count > 0 ? (
              <Pill tone="danger">🚩 {row.reports_count} report{row.reports_count === 1 ? '' : 's'}</Pill>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            {row.author_name} · {fmtDate(row.created_at)}
            {row.locality ? ` · ${row.locality}` : ''}
          </div>
          <p style={{ margin: '8px 0 0', color: '#0A2540', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {row.body || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(no body)</span>}
          </p>
          {row.active_from || row.active_to ? (
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>
              Active window: {row.active_from ? fmtDate(row.active_from) : '—'} → {row.active_to ? fmtDate(row.active_to) : '—'}
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={onToggleComments}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#0A2540',
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
                fontSize: 12,
                textDecoration: 'underline',
              }}
            >
              💬 {expanded ? 'Hide comments' : 'View comments'}
            </button>
          </div>
          {expanded ? (
            <CommentsDrawer
              parentLabel={row.title}
              loader={async () => {
                const r = await noticeCommentsApi.list(row.id);
                return r.comments || [];
              }}
              deleter={(cid) => noticeCommentsApi.remove(row.id, cid).then(() => undefined)}
            />
          ) : null}
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

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function computeActiveStatus(from?: string, to?: string): 'live' | 'scheduled' | 'expired' {
  const now = Date.now();
  if (from) {
    const t = new Date(from).getTime();
    if (!Number.isNaN(t) && t > now) return 'scheduled';
  }
  if (to) {
    const t = new Date(to).getTime();
    if (!Number.isNaN(t) && t < now) return 'expired';
  }
  return 'live';
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
