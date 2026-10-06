'use client';

/**
 * Community Groups — Mission Control moderation.
 *
 * Lists every community-group post with author, group, image/text,
 * and date. Admins can:
 *   • Delete a whole post (cascades its comments + any attached media)
 *   • Expand a post to see its comments and delete them individually
 *
 * Lives at /admin/groups-mod on purpose — /admin/groups and
 * /admin/groups/pending are already reserved for CRUD on the group
 * directory itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import CommentsDrawer from '@/components/admin/CommentsDrawer';
import {
  groupPostsApi,
  type GroupPostRow,
  type GroupOption,
} from '@/lib/cms-api';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

export default function AdminGroupsModPage() {
  const [groupId, setGroupId] = useState<string>('');
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<GroupPostRow[]>([]);
  const [stats, setStats] = useState({ total_posts: 0, total_comments: 0, total_groups: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await groupPostsApi.list({
        q: q.trim() || undefined,
        group_id: groupId || undefined,
        limit: 200,
      });
      setRows(r.rows || []);
      setStats({ total_posts: r.total_posts, total_comments: r.total_comments, total_groups: r.total_groups });
    } catch (e: any) {
      setToast(e?.message || 'Failed to load group posts');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [q, groupId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const r = await groupPostsApi.groups();
        setGroups(r.rows || []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const remove = async (row: GroupPostRow) => {
    const title = (row.text || '').trim() || '(empty post)';
    const author = row.author_name || 'Someone';
    const commentPart = row.comments_count > 0
      ? `\n\nThis will also remove ${row.comments_count} comment${row.comments_count === 1 ? '' : 's'}`
      + (row.image ? ` and any attached media.` : `.`)
      : row.image ? `\n\nAttached media will also be removed.` : '';
    const confirmMsg =
      `Delete this group post permanently?\n\n` +
      `"${title.slice(0, 100)}${title.length > 100 ? '…' : ''}"\n` +
      `by ${author} in ${row.group_name || 'the group'}${commentPart}\n\n` +
      `Members can't recover it. This action is logged.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(row.id);
    try {
      await groupPostsApi.remove(row.id);
      await load();
      setToast('Post deleted');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell title="Community Group Posts">
      <div style={intro}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, margin: 0 }}>
          Every post made inside a Community Group, newest first. Delete a
          whole post and its comments cascade with it; expand a post to prune
          individual comments. Group details themselves live on the
          {' '}<b>Groups</b> page.
        </p>
      </div>

      {/* Stats cards */}
      <div style={statsRow}>
        <StatCard label="Group posts"  value={stats.total_posts} />
        <StatCard label="Comments"     value={stats.total_comments} />
        <StatCard label="Active groups" value={stats.total_groups} />
      </div>

      {/* Group chip + search */}
      <div style={controlsRow}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>Group:</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            style={selectInput}
          >
            <option value="">All groups ({stats.total_groups})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search post text or author…"
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
        <p style={{ color: '#64748B', marginTop: 24 }}>Loading group posts…</p>
      ) : rows.length === 0 ? (
        <div style={emptyBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GeorgeButterflyMark size={48} />
          </div>
          <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800, marginTop: 8 }}>
            Nothing to moderate
          </div>
          <div style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>
            When members post inside a Community Group, their posts will show up here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {rows.map((p) => (
            <PostRow
              key={p.id}
              row={p}
              busy={busyId === p.id}
              expanded={openCommentsFor === p.id}
              onToggleComments={() => setOpenCommentsFor(openCommentsFor === p.id ? null : p.id)}
              onDelete={() => remove(p)}
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

function PostRow({
  row, busy, expanded, onToggleComments, onDelete,
}: {
  row: GroupPostRow;
  busy: boolean;
  expanded: boolean;
  onToggleComments: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 16,
      border: '1px solid #E2E8F0',
      padding: 16,
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 160ms ease',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: row.image ? '96px 1fr auto' : '48px 1fr auto', gap: 14, alignItems: 'flex-start' }}>
        {row.image ? (
          <img
            src={row.image}
            alt="Attached"
            style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', background: '#F1F5F9' }}
          />
        ) : (
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: '#F1F5F9',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
          }}>
            {row.author_avatar || '👤'}
          </div>
        )}

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 16 }}>
              {row.author_name || 'Someone'}
            </span>
            <Pill tone="slate">👥 {row.group_name || 'Group'}</Pill>
            {row.image ? <Pill tone="slate">📷 Photo</Pill> : null}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
            Posted {fmtDate(row.created_at)}
          </div>
          <p style={{ margin: '8px 0 0', color: '#0A2540', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {row.text || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(no text)</span>}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
            ❤ {row.likes_count} ·{' '}
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
              💬 {row.comments_count} comment{row.comments_count === 1 ? '' : 's'}
              {' '}· {expanded ? 'hide' : 'view'}
            </button>
          </div>
          {expanded ? (
            <CommentsDrawer
              parentLabel={row.text}
              loader={async () => {
                const r = await groupPostsApi.comments(row.id);
                return r.comments || [];
              }}
              deleter={(cid) => groupPostsApi.removeComment(row.id, cid).then(() => undefined)}
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

function Pill({ children, tone }: { children: React.ReactNode; tone: 'slate' }) {
  const palettes: Record<string, { bg: string; ink: string; border: string }> = {
    slate: { bg: '#F1F5F9', ink: '#334155', border: '#CBD5E1' },
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
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 16, border: '1px solid #E2E8F0', padding: 16,
      minWidth: 160, flex: '1 1 160px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#0A2540', marginTop: 4 }}>{value}</div>
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
  fontSize: 14, minWidth: 240, background: '#FFFFFF', color: '#0A2540',
};
const selectInput: React.CSSProperties = {
  border: '1px solid #CBD5E1', borderRadius: 10, padding: '10px 12px',
  fontSize: 14, background: '#FFFFFF', color: '#0A2540', minWidth: 220,
};
const emptyBox: React.CSSProperties = {
  background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 16,
  padding: 32, textAlign: 'center', marginTop: 20,
};

