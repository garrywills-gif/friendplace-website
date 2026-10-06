'use client';

/**
 * CommentsDrawer — reusable inline comment moderation drawer.
 *
 * Shared by Moments, Notice Board and Community Groups moderation pages.
 * Renders a tight list of embedded comments with per-row Delete buttons
 * (each one gated by `window.confirm`). The host page owns:
 *   • `loader`  → fetches the current comment array for the parent id
 *   • `deleter` → removes one comment by id (host decides which API)
 *
 * The drawer manages its own loading / busy / error state so a host
 * screen can drop it in with two props and nothing else.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { CommentRow } from '@/lib/cms-api';

export type CommentsDrawerProps = {
  /** Human-readable label for the parent (e.g. post title) used in
   *  confirm dialogs: "Delete this comment on 'Garden swap'?". */
  parentLabel?: string;
  /** Fetch the current comment list. Called on mount + after delete. */
  loader: () => Promise<CommentRow[]>;
  /** Remove a single comment by id. Called after confirm. */
  deleter: (commentId: string) => Promise<void>;
};

export default function CommentsDrawer({ parentLabel, loader, deleter }: CommentsDrawerProps) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loader();
      setComments(rows || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (c: CommentRow) => {
    const snippet = (c.text || '').slice(0, 100);
    const author = c.user_name || 'Someone';
    const label = parentLabel ? ` on "${parentLabel.slice(0, 80)}${parentLabel.length > 80 ? '…' : ''}"` : '';
    const confirmMsg =
      `Delete this comment${label}?\n\n` +
      `"${snippet}${(c.text || '').length > 100 ? '…' : ''}"\n` +
      `by ${author}\n\n` +
      `The parent post stays intact. This action is logged.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(c.id);
    try {
      await deleter(c.id);
      await refresh();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div style={emptyRow}>Loading comments…</div>;
  }
  if (error) {
    return <div style={{ ...emptyRow, color: '#B91C1C' }}>Could not load comments — {error}</div>;
  }
  if (comments.length === 0) {
    return <div style={emptyRow}>No comments on this post.</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      {comments.map((c) => (
        <div key={c.id}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr auto',
            gap: 10,
            alignItems: 'flex-start',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            padding: 10,
            opacity: busyId === c.id ? 0.55 : 1,
          }}>
            <div style={avatarBubble}>{c.user_avatar || '👤'}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540' }}>
                {c.user_name || 'Someone'}
                <span style={{ fontWeight: 400, color: '#64748B', marginLeft: 6 }}>· {relTime(c.created_at)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#0A2540', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {c.text || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(empty)</span>}
              </div>
            </div>
            <button
              type="button"
              disabled={busyId === c.id}
              onClick={() => remove(c)}
              style={deleteBtn}
            >
              Delete
            </button>
          </div>
          {/* Nested replies — Notice Board only, flat list under the parent. */}
          {Array.isArray(c.replies) && c.replies.length > 0 ? (
            <div style={{ marginLeft: 42, marginTop: 6, display: 'grid', gap: 6 }}>
              {c.replies.map((r) => (
                <div key={r.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr auto',
                  gap: 8,
                  alignItems: 'flex-start',
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: 10,
                  padding: 8,
                  opacity: busyId === r.id ? 0.55 : 1,
                }}>
                  <div style={{ ...avatarBubble, width: 28, height: 28, fontSize: 15 }}>{r.user_avatar || '↪'}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540' }}>
                      {r.user_name || 'Someone'}
                      <span style={{ fontWeight: 400, color: '#64748B', marginLeft: 6 }}>· {relTime(r.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#0A2540', marginTop: 3, whiteSpace: 'pre-wrap' }}>
                      {r.text || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(empty)</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => remove(r)}
                    style={deleteBtn}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const secs = Math.round(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

const emptyRow: React.CSSProperties = {
  marginTop: 12,
  padding: '12px 14px',
  background: '#F8FAFC',
  border: '1px dashed #CBD5E1',
  borderRadius: 10,
  color: '#64748B',
  fontSize: 13,
};
const avatarBubble: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 999, background: '#E2E8F0',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
};
const deleteBtn: React.CSSProperties = {
  background: '#FEE2E2',
  color: '#B91C1C',
  border: '1px solid #FCA5A5',
  borderRadius: 8,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

