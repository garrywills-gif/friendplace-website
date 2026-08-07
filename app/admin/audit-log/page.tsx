'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { cmsApi, type AuditLogEntry } from '@/lib/cms-api';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';

/**
 * Audit log viewer — Slice 0 deliverable.
 *
 * This is the reference implementation for how any list page in
 * Mission Control should feel: dense, filter-first, no cover-story
 * hero. Every consequential write action across MCGS lands here so
 * admins can answer "who did what, and when" without leaving the
 * Bridge.
 */
export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { actions } = await cmsApi.auditLogActions();
        setActions(actions);
      } catch { /* silent — filter dropdown just stays empty */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await cmsApi.listAuditLog({
          action_prefix: actionFilter || undefined,
          target_type: targetTypeFilter || undefined,
          limit: 200,
        });
        setRows(res.items);
        setTotal(res.total);
      } catch (e: any) {
        setError(e?.message || 'Failed to load audit log');
      } finally {
        setLoading(false);
      }
    })();
  }, [actionFilter, targetTypeFilter]);

  // Namespace prefixes for the primary filter dropdown.
  const prefixes = Array.from(new Set(actions.map((a) => a.split('.')[0])));

  return (
    <AdminShell title="Audit log">
      <p style={lede}>
        Every consequential action taken in Mission Control lands here.
        Read-only, tamper-evident, filterable.
      </p>

      <div style={filterRow}>
        <label style={label}>
          Action
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={select}
          >
            <option value="">All actions</option>
            {prefixes.map((p) => (
              <option key={p} value={`${p}.`}>{p}.*</option>
            ))}
          </select>
        </label>

        <label style={label}>
          Target type
          <input
            type="text"
            placeholder="e.g. member, report, event"
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value.trim())}
            style={input}
          />
        </label>

        <div style={{ marginLeft: 'auto' }}>
          <AskGeorgeAboutThis
            label="Ask George about this log"
            prompts={[
              'Summarise the last 24 hours of admin activity.',
              'Which admins have been most active this week?',
              'Are there any unusual patterns in recent moderation actions?',
            ]}
          />
        </div>
      </div>

      <div style={countRow}>
        {loading ? 'Loading…' : `${rows.length} of ${total} entries`}
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {!loading && rows.length === 0 && !error && (
        <div style={emptyBox}>
          <strong style={{ display: 'block', marginBottom: 4 }}>No entries yet.</strong>
          <span style={{ color: '#64748B', fontSize: 13 }}>
            The audit log will populate as admins take moderation and content actions in Mission Control.
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Admin</th>
                <th style={th}>Action</th>
                <th style={th}>Target</th>
                <th style={th}>Reason / details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} style={tr}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTs(r.ts)}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{r.admin_name || r.admin_email || '—'}</div>
                    {r.admin_email && r.admin_name && (
                      <div style={{ fontSize: 12, color: '#64748B' }}>{r.admin_email}</div>
                    )}
                  </td>
                  <td style={td}>
                    <code style={code}>{r.action}</code>
                  </td>
                  <td style={td}>
                    {r.target_type ? (
                      <>
                        <span style={{ fontWeight: 700 }}>{r.target_type}</span>
                        {r.target_id && (
                          <span style={{ color: '#64748B', marginLeft: 6, fontSize: 12 }}>
                            {r.target_id.length > 12 ? `${r.target_id.slice(0, 8)}…` : r.target_id}
                          </span>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td style={td}>
                    {r.reason ? (
                      <span style={{ color: '#334155' }}>{r.reason}</span>
                    ) : r.metadata && Object.keys(r.metadata).length > 0 ? (
                      <code style={{ ...code, fontSize: 11, background: '#F8FAFC' }}>
                        {JSON.stringify(r.metadata)}
                      </code>
                    ) : (
                      <span style={{ color: '#94A3B8' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── styles ────────────────────────────────────────────────────────────
const lede: React.CSSProperties = { color: '#475569', marginTop: -8, marginBottom: 20, maxWidth: 720 };
const filterRow: React.CSSProperties = { display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' };
const select: React.CSSProperties = { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, minWidth: 200, background: '#FFFFFF' };
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, minWidth: 220 };
const countRow: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 12 };
const errorBox: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, border: '1px solid #FCA5A5', marginBottom: 12, fontSize: 14 };
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '32px 20px', textAlign: 'center' };
const tableWrap: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflowX: 'auto' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', padding: '12px 14px', color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const tr: React.CSSProperties = { borderTop: '1px solid #F1F5F9' };
const td: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'top' };
const code: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };
