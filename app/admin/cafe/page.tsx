'use client';

/**
 * FP Café — Mission Control message moderation.
 *
 * Lists recent FP Café (table) messages across every table in the
 * last 30 days by default. Each row shows the member display name,
 * table name, message text, attached photo (if any) and timestamp.
 *
 * Admin can delete an individual message with a confirm prompt. The
 * parent table and every other message stay untouched — this is a
 * scalpel, not a hammer. DMs / Flutters are intentionally OUT of
 * scope: they are 1:1 private conversations and are only moderated
 * through the existing member-report flow.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  cafeMessagesApi,
  type CafeMessageRow,
  type CafeTableOption,
} from '@/lib/cms-api';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

const DAYS_OPTIONS: { key: number; label: string }[] = [
  { key: 7,   label: 'Last 7 days' },
  { key: 30,  label: 'Last 30 days' },
  { key: 90,  label: 'Last 90 days' },
];

export default function AdminCafeMessagesPage() {
  const [days, setDays] = useState<number>(30);
  const [tableId, setTableId] = useState<string>('');
  const [tables, setTables] = useState<CafeTableOption[]>([]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CafeMessageRow[]>([]);
  const [stats, setStats] = useState({ total_window: 0, tables_active: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cafeMessagesApi.list({
        q: q.trim() || undefined,
        table_id: tableId || undefined,
        days,
        limit: 300,
      });
      setRows(r.rows || []);
      setStats({ total_window: r.total_window, tables_active: r.tables_active });
    } catch (e: any) {
      setToast(e?.message || 'Failed to load café messages');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [q, tableId, days]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const r = await cafeMessagesApi.tables();
        setTables(r.rows || []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const remove = async (row: CafeMessageRow) => {
    const snippet = (row.text || (row.image ? '(photo only)' : '(empty message)')).trim();
    const author = row.user_name || 'Someone';
    const confirmMsg =
      `Delete this café message permanently?\n\n` +
      `"${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''}"\n` +
      `by ${author} in ${row.table_name || 'the table'}\n\n` +
      `The table and every other message stay intact. This action is logged.`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(row.id);
    try {
      await cafeMessagesApi.remove(row.id);
      await load();
      setToast('Message deleted');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell title="FP Café Messages">
      <div style={intro}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, margin: 0 }}>
          Member chat across every FP Café table. Pick a time window and table
          to narrow, then delete any single message that doesn&rsquo;t belong —
          the table and surrounding messages stay intact. DMs are private and
          are moderated separately via member reports.
        </p>
      </div>

      {/* Stats cards */}
      <div style={statsRow}>
        <StatCard label={`Messages in last ${days}d`} value={stats.total_window} />
        <StatCard label="Tables with activity"       value={stats.tables_active} />
      </div>

      {/* Filters + search */}
      <div style={controlsRow}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DAYS_OPTIONS.map((d) => {
              const on = days === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDays(d.key)}
                  className="cms-btn-ghost"
                  style={{
                    ...s.ghostBtn,
                    padding: '8px 12px',
                    background: on ? '#0A2540' : '#FFFFFF',
                    color: on ? '#FFFFFF' : '#0A2540',
                    borderColor: on ? '#0A2540' : '#CBD5E1',
                    fontWeight: 700,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>Table:</label>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              style={selectInput}
            >
              <option value="">All tables</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            placeholder="Search text or author…"
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
        <p style={{ color: '#64748B', marginTop: 24 }}>Loading café messages…</p>
      ) : rows.length === 0 ? (
        <div style={emptyBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <GeorgeButterflyMark size={48} />
          </div>
          <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800, marginTop: 8 }}>
            No messages in this window
          </div>
          <div style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>
            Widen the time range or clear the search box.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {rows.map((m) => (
            <MessageRow
              key={m.id}
              row={m}
              busy={busyId === m.id}
              onDelete={() => remove(m)}
              onPreviewImage={(src) => setPreviewImage(src)}
            />
          ))}
        </div>
      )}

      {/* Image preview overlay — click outside to close. */}
      {previewImage ? (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.76)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            padding: 32,
          }}
        >
           
          <img src={previewImage} alt="Preview"
               style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }} />
        </div>
      ) : null}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function MessageRow({ row, busy, onDelete, onPreviewImage }: {
  row: CafeMessageRow;
  busy: boolean;
  onDelete: () => void;
  onPreviewImage: (src: string) => void;
}) {
  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 14,
      border: '1px solid #E2E8F0',
      padding: 12,
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 160ms ease',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 999, background: '#F1F5F9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>{row.user_avatar || '👤'}</div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 14 }}>{row.user_name || 'Someone'}</span>
            <Pill tone="slate">☕ {row.table_name || 'Table'}</Pill>
            <span style={{ fontSize: 12, color: '#64748B' }}>{fmtDate(row.created_at)}</span>
          </div>
          {row.text ? (
            <p style={{ margin: '6px 0 0', color: '#0A2540', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {row.text}
            </p>
          ) : null}
          {row.image ? (
            <button
              type="button"
              onClick={() => onPreviewImage(row.image)}
              style={{
                marginTop: 8, padding: 0, border: 'none',
                background: 'transparent', cursor: 'zoom-in',
              }}
              aria-label="Preview attached image"
            >
               
              <img
                src={row.image}
                alt="Attached"
                style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 10, background: '#F1F5F9', display: 'block' }}
              />
            </button>
          ) : null}
          {!row.text && !row.image ? (
            <p style={{ margin: '6px 0 0', color: '#94A3B8', fontStyle: 'italic', fontSize: 13 }}>
              (empty message)
            </p>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="cms-btn-danger"
            style={{ ...s.dangerBtn, padding: '6px 12px', fontSize: 12 }}
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
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  fontSize: 14, minWidth: 220, background: '#FFFFFF', color: '#0A2540',
};
const selectInput: React.CSSProperties = {
  border: '1px solid #CBD5E1', borderRadius: 10, padding: '10px 12px',
  fontSize: 14, background: '#FFFFFF', color: '#0A2540', minWidth: 180,
};
const emptyBox: React.CSSProperties = {
  background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 16,
  padding: 32, textAlign: 'center', marginTop: 20,
};

