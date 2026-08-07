'use client';

/**
 * Members list — Slice 1 (MCGS Member Management)
 *
 * The single place to find any FriendPlace member. Search + status
 * filters, quick moderation-state chips, one-click into the profile
 * where every moderation action lives (behind the identity dialog).
 *
 * No destructive actions live on this list. Everything requiring
 * confirmation happens on the profile — that's the safeguard contract.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { cmsApi, type MemberRow } from '@/lib/cms-api';
import { MemberRowCard } from '@/components/members/MemberRowCard';

type StatusFilter = '' | 'banned' | 'suspended' | 'restricted' | 'founding' | 'demo' | 'admin';

const STATUS_OPTIONS: { value: StatusFilter; label: string; hint: string }[] = [
  { value: '',           label: 'All members',     hint: 'Everyone.' },
  { value: 'restricted', label: 'Restricted',      hint: 'Currently limited in-app.' },
  { value: 'suspended',  label: 'Suspended',       hint: 'Time-boxed suspension in effect.' },
  { value: 'banned',     label: 'Banned',          hint: 'Permanent — cannot sign in.' },
  { value: 'founding',   label: 'Founding',        hint: 'Founding members.' },
  { value: 'demo',       label: 'Demo accounts',   hint: 'Seed / demo users.' },
  { value: 'admin',      label: 'Admins',          hint: 'Members with admin role.' },
];

const PAGE_SIZE = 25;

export default function MembersPage() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await cmsApi.listMembers({
        q: q.trim() || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        skip,
      });
      setRows(r.items);
      setTotal(r.total);
    } catch (e: any) {
      setError(e?.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [q, status, skip]);

  useEffect(() => { load(); }, [load]);

  // Reset paging when the filter or query changes.
  useEffect(() => { setSkip(0); }, [q, status]);

  const showingRange = useMemo(() => {
    if (rows.length === 0) return null;
    return `${skip + 1}–${skip + rows.length}`;
  }, [rows.length, skip]);

  return (
    <AdminShell title="Members">
      <p style={lede}>
        Everyone in FriendPlace. Search by name, email, handle or Member ID.
        Actions live inside the profile — always behind identity confirmation.
      </p>

      <div style={filterRow}>
        <input
          type="search"
          placeholder="Search name, email, @handle, or Member ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...input, minWidth: 320, flex: 1 }}
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          style={select}
          title={STATUS_OPTIONS.find((s) => s.value === status)?.hint}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto' }}>
          <AskGeorgeAboutThis
            label="Ask George"
            prompts={[
              'How many members joined in the last 7 days?',
              'Are there any repeat offenders I should look at?',
              'Which members have the most open reports right now?',
              'Show me any accounts that look unusual — new + already reported.',
              'Have we treated similar cases consistently in recent moderation actions?',
            ]}
          />
        </div>
      </div>

      <div style={metaBar}>
        <span>
          {loading ? 'Loading…' : (
            <>
              Showing <strong>{showingRange || '0'}</strong> of <strong>{total.toLocaleString()}</strong> member{total === 1 ? '' : 's'}
              {(q || status) ? <> matching <em>{q || STATUS_OPTIONS.find((s) => s.value === status)?.label || ''}</em></> : null}
            </>
          )}
        </span>
      </div>

      {error && <div style={errBanner}>{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div style={emptyBox}>
          <strong style={{ display: 'block', marginBottom: 4 }}>No matches.</strong>
          <span style={{ color: '#64748B', fontSize: 13 }}>
            Try clearing the filter or refining your search.
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {rows.map((m) => (
            <Link
              key={m.id}
              href={`/admin/members/${encodeURIComponent(m.id)}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <MemberRowCard member={m} />
            </Link>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div style={pager}>
          <button
            type="button"
            disabled={skip <= 0}
            onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
            style={pagerBtn}
          >
            ← Previous
          </button>
          <span style={{ color: '#64748B', fontSize: 13 }}>
            Page {Math.floor(skip / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            type="button"
            disabled={skip + PAGE_SIZE >= total}
            onClick={() => setSkip(skip + PAGE_SIZE)}
            style={pagerBtn}
          >
            Next →
          </button>
        </div>
      )}
    </AdminShell>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const lede: React.CSSProperties = { color: '#475569', marginTop: -8, marginBottom: 20, maxWidth: 780, lineHeight: 1.55 };
const filterRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 };
const input: React.CSSProperties = { padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, background: '#FFFFFF' };
const select: React.CSSProperties = { ...input, minWidth: 180, cursor: 'pointer' };
const metaBar: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 4px', color: '#64748B', fontSize: 13 };
const errBanner: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 12 };
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '32px 20px', textAlign: 'center', marginTop: 16 };
const pager: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginTop: 20 };
const pagerBtn: React.CSSProperties = { padding: '8px 14px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
