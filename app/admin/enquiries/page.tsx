'use client';

/**
 * Admin ▸ Enquiries ▸ Unified public submissions view
 *
 * Every public submission form (Contact, Register Interest, Support,
 * Report, Waitlist) persists to the database *before* any email is
 * sent. This page is the guaranteed source of truth: even if outbound
 * confirmation email delivery ever fails, no customer enquiry can be
 * lost — every submission is here.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { type Enquiry } from '@/lib/cms-api';
import { API_BASE } from '@/lib/api-base';
import { clearAuth, getToken } from '@/lib/cms-auth';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { setEnquiryStatus } from '@/lib/enquiry-handled';

type KindKey = 'all' | 'contact' | 'interest' | 'support' | 'report' | 'waitlist';
type EnquiryKind = Exclude<KindKey, 'all'>;
type EnquiryStatus = 'new' | 'read' | 'replied' | 'resolved';
type EnquiryRow = Enquiry & {
  status?: EnquiryStatus | string;
  archived_at?: string | null;
  archived_by?: string | null;
  read_at?: string | null;
  replied_at?: string | null;
  resolved_at?: string | null;
  status_updated_at?: string | null;
  status_updated_by?: string | null;
};

type EnquiriesListResponse = {
  count: number;
  rows: EnquiryRow[];
  kinds: Array<{ key: string; label: string; count: number }>;
};

async function enquiryReq<T>(method: string, path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithRetry(`${API_BASE}/api${path}`, {
    method,
    headers,
    cache: 'no-store',
  });

  if (res.status === 401) clearAuth();

  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

  if (!res.ok) {
    const msg = json?.detail || json?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return json as T;
}

function enquiriesPath(kind: KindKey, archived: boolean, limit = 200) {
  const params = new URLSearchParams();
  if (kind !== 'all') params.set('kind', kind);
  params.set('archived', String(archived));
  params.set('limit', String(limit));
  return `/cms/enquiries?${params.toString()}`;
}

function enquiryActionPath(kind: EnquiryKind, id: string, action?: 'archive' | 'restore') {
  const base = `/cms/enquiries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
  return action ? `${base}/${action}` : base;
}

export default function AdminEnquiriesPage() {
  return (
    <AdminShell title="Enquiries">
      <EnquiriesPanel />
    </AdminShell>
  );
}

function EnquiriesPanel() {
  const [rows, setRows] = useState<EnquiryRow[] | null>(null);
  const [kinds, setKinds] = useState<Array<{ key: string; label: string; count: number }>>([]);
  const [filter, setFilter] = useState<KindKey>('all');
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await enquiryReq<EnquiriesListResponse>('GET', enquiriesPath(filter, archived));
        if (cancelled) return;
        setRows(r.rows);
        setKinds(r.kinds);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load enquiries.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter, archived]);

  const totalAll = useMemo(() => kinds.reduce((n, k) => n + k.count, 0), [kinds]);

  const tabs: Array<{ key: KindKey; label: string; count: number }> = [
    { key: 'all', label: 'All', count: totalAll },
    ...kinds.map((k) => ({ key: k.key as KindKey, label: k.label, count: k.count })),
  ];

  const updateStatus = async (r: EnquiryRow, status: EnquiryStatus) => {
    if (!r.id) return;
    const key = `status:${r.kind}:${r.id}`;
    setBusyKey(key);
    setError(null);
    try {
      await setEnquiryStatus(r.kind, r.id, status);
      setRows((current) => current?.map((row) => (
        row.kind === r.kind && row.id === r.id ? { ...row, status } : row
      )) || current);
    } catch (e: any) {
      setError(e?.message || `Failed to mark enquiry ${status}.`);
    } finally {
      setBusyKey(null);
    }
  };

  const removeCurrentRow = (kind: EnquiryKind, id: string) => {
    setRows((current) => current ? current.filter((row) => !(row.kind === kind && row.id === id)) : current);
    setKinds((current) => current.map((k) => k.key === kind ? { ...k, count: Math.max(0, k.count - 1) } : k));
  };

  const runRowAction = async (r: EnquiryRow, action: 'archive' | 'restore') => {
    if (!r.id) return;
    const key = `${action}:${r.kind}:${r.id}`;
    setBusyKey(key);
    setError(null);
    try {
      await enquiryReq('POST', enquiryActionPath(r.kind, r.id, action));
      removeCurrentRow(r.kind, r.id);
    } catch (e: any) {
      setError(e?.message || `Failed to ${action} enquiry.`);
    } finally {
      setBusyKey(null);
    }
  };

  const deletePermanently = async (r: EnquiryRow) => {
    if (!r.id) return;
    const typed = window.prompt(
      `Permanently delete this ${r.kind_label || r.kind} enquiry?\n\n` +
      `This cannot be undone. Type DELETE to confirm.`,
    );
    if (typed !== 'DELETE') return;

    const key = `delete:${r.kind}:${r.id}`;
    setBusyKey(key);
    setError(null);
    try {
      await enquiryReq('DELETE', enquiryActionPath(r.kind, r.id));
      removeCurrentRow(r.kind, r.id);
    } catch (e: any) {
      setError(e?.message || 'Failed to permanently delete enquiry.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={rationaleStrip}>
        Every public submission is persisted here <strong>before</strong> any confirmation email is sent.
        This page is the guaranteed record, even if an email fails to deliver.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setArchived(false)} style={viewToggle(!archived)}>Active</button>
        <button type="button" onClick={() => setArchived(true)} style={viewToggle(archived)}>Archived</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            style={{
              padding: '8px 14px', borderRadius: 999,
              border: `1.5px solid ${filter === t.key ? '#14B8A6' : '#CBD5E1'}`,
              background: filter === t.key ? '#F0FDFA' : '#FFFFFF',
              color: filter === t.key ? '#0F766E' : '#475569',
              fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {t.label}
            <span style={{
              marginLeft: 8, padding: '1px 8px', borderRadius: 999,
              background: filter === t.key ? '#14B8A6' : '#E2E8F0',
              color: filter === t.key ? '#FFFFFF' : '#475569',
              fontSize: 11, fontWeight: 800,
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#64748B' }}>Loading enquiries&hellip;</p>}
      {error && (
        <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
          <p style={{ margin: 0, color: '#991B1B', fontWeight: 700 }}>Couldn&rsquo;t complete that action</p>
          <p style={{ marginTop: 8, marginBottom: 0, color: '#7F1D1D', fontSize: 14 }}>{error}</p>
        </div>
      )}

      {!loading && !error && rows && rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#64748B' }}>
          <p style={{ margin: 0, fontSize: 15 }}>
            {archived ? 'No archived enquiries.' : 'No active enquiries recorded yet.'}
          </p>
          <p style={{ marginTop: 6, fontSize: 13 }}>
            {archived
              ? 'Archived enquiries will appear here and can be restored at any time.'
              : 'When someone submits the Contact, Register Interest, Support, Report, or Waitlist form, it will appear here.'}
          </p>
        </div>
      )}

      {!loading && rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r, i) => (
            <EnquiryRowCard
              key={`${r.kind}-${r.id ?? i}`}
              r={r}
              archived={archived}
              busyKey={busyKey}
              onStatus={(status) => updateStatus(r, status)}
              onArchive={() => runRowAction(r, 'archive')}
              onRestore={() => runRowAction(r, 'restore')}
              onDelete={() => deletePermanently(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EnquiryRowCard({
  r,
  archived,
  busyKey,
  onStatus,
  onArchive,
  onRestore,
  onDelete,
}: {
  r: EnquiryRow;
  archived: boolean;
  busyKey: string | null;
  onStatus: (status: EnquiryStatus) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const kindColor = {
    contact: { bg: '#EFF6FF', fg: '#1D4ED8' },
    interest: { bg: '#F0FDFA', fg: '#0F766E' },
    support: { bg: '#FEF3C7', fg: '#92400E' },
    report: { bg: '#FEE2E2', fg: '#991B1B' },
    waitlist: { bg: '#EDE9FE', fg: '#5B21B6' },
  }[r.kind] || { bg: '#F1F5F9', fg: '#475569' };

  const status = (r.status || 'new') as EnquiryStatus;
  const statusTone = {
    new: { bg: '#FEF3C7', fg: '#92400E' },
    read: { bg: '#EFF6FF', fg: '#1D4ED8' },
    replied: { bg: '#DCFCE7', fg: '#166534' },
    resolved: { bg: '#F1F5F9', fg: '#475569' },
  }[status] || { bg: '#F1F5F9', fg: '#475569' };

  const when = r.created_at ? new Date(r.created_at).toLocaleString() : '';
  const archivedWhen = r.archived_at ? new Date(r.archived_at).toLocaleString() : '';
  const rowBusy = !!busyKey && busyKey.endsWith(`:${r.kind}:${r.id}`);

  return (
    <div style={rowCard}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <span style={{
          padding: '3px 10px', borderRadius: 999, background: kindColor.bg,
          color: kindColor.fg, fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>{r.kind_label}</span>

        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0A2540' }}>
            {r.name || '(no name)'}
            {r.email && <span style={{ color: '#64748B', fontWeight: 500, marginLeft: 8 }}>· {r.email}</span>}
          </div>
          {r.subject && <div style={{ fontSize: 13, color: '#475569', marginTop: 3 }}>{r.subject}</div>}
          {r.message && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 13, color: '#64748B', lineHeight: 1.55, cursor: 'pointer', listStylePosition: 'inside' }}>
                <span style={{ marginLeft: 4 }}>{r.message.length > 140 ? `${r.message.slice(0, 140)}…` : r.message}</span>
              </summary>
              <div style={{ fontSize: 13, color: '#475569', marginTop: 8, lineHeight: 1.6, whiteSpace: 'pre-wrap', padding: '10px 12px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
                {r.message}
              </div>
            </details>
          )}
        </div>

        <div style={{ textAlign: 'right', minWidth: 140 }}>
          <div style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 6,
            background: statusTone.bg, color: statusTone.fg,
            fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
          }}>{status}</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>{when}</div>
          {archived && archivedWhen && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>Archived {archivedWhen}</div>
          )}
          {r.id && <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 3, fontFamily: '"SF Mono", Menlo, monospace' }}>{r.id}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        {!archived && r.email && (
          <Link
            href={`/admin/enquiries/reply?email=${encodeURIComponent(r.email)}&name=${encodeURIComponent(r.name || '')}&subject=${encodeURIComponent(r.subject ? `Re: ${r.subject}` : '')}&message=${encodeURIComponent(r.message || '')}&in_reply_to=${encodeURIComponent(r.id || '')}&kind=${encodeURIComponent(r.kind)}`}
            style={replyButton}
          >
            Reply
          </Link>
        )}

        {!archived && r.id && status === 'new' && (
          <button type="button" onClick={() => onStatus('read')} style={statusButton} disabled={rowBusy}>
            Mark read
          </button>
        )}

        {!archived && r.id && status !== 'replied' && status !== 'resolved' && (
          <button type="button" onClick={() => onStatus('replied')} style={markRepliedButton} disabled={rowBusy}>
            Mark replied
          </button>
        )}

        {!archived && r.id && status !== 'resolved' && (
          <button type="button" onClick={() => onStatus('resolved')} style={resolveButton} disabled={rowBusy}>
            Resolve
          </button>
        )}

        {!archived && r.id && (
          <button type="button" onClick={onArchive} style={archiveButton} disabled={rowBusy}>
            {rowBusy ? 'Working…' : 'Archive'}
          </button>
        )}

        {archived && r.id && (
          <>
            <button type="button" onClick={onRestore} style={restoreButton} disabled={rowBusy}>
              {rowBusy ? 'Working…' : 'Restore'}
            </button>
            <button type="button" onClick={onDelete} style={deleteButton} disabled={rowBusy}>
              Delete permanently
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, padding: 20,
};
const rowCard: React.CSSProperties = { ...card, padding: 14 };
const rationaleStrip: React.CSSProperties = {
  background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 12,
  padding: '10px 14px', fontSize: 13, color: '#0F766E',
};
const viewToggle = (active: boolean): React.CSSProperties => ({
  padding: '8px 15px', borderRadius: 10,
  border: `1.5px solid ${active ? '#0F766E' : '#CBD5E1'}`,
  background: active ? '#0F766E' : '#FFFFFF', color: active ? '#FFFFFF' : '#475569',
  fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
});
const replyButton: React.CSSProperties = {
  display: 'inline-block', padding: '6px 10px', borderRadius: 8,
  background: '#0F766E', color: '#FFFFFF', textDecoration: 'none', fontSize: 11, fontWeight: 800,
};
const statusButton: React.CSSProperties = {
  display: 'inline-block', padding: '6px 10px', borderRadius: 8,
  background: '#FFFFFF', color: '#1D4ED8', border: '1px solid #BFDBFE',
  fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
};
const markRepliedButton: React.CSSProperties = {
  ...statusButton, color: '#0F766E', border: '1px solid #99F6E4',
};
const resolveButton: React.CSSProperties = {
  ...statusButton, color: '#475569', border: '1px solid #CBD5E1', background: '#F8FAFC',
};
const archiveButton: React.CSSProperties = {
  ...statusButton, color: '#475569', border: '1px solid #CBD5E1',
};
const restoreButton: React.CSSProperties = {
  ...markRepliedButton, background: '#F0FDFA',
};
const deleteButton: React.CSSProperties = {
  ...markRepliedButton, color: '#B91C1C', border: '1px solid #FCA5A5', background: '#FEF2F2',
};
