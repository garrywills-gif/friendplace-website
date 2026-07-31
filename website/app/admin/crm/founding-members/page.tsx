'use client';

/**
 * Founding Members CRM — Phase 1
 *
 * Every submission on the public "Register Your Interest" form is
 * persisted as a Founding Member here (interest_registrations
 * collection in Mongo). Admins can walk each person through the
 * status ladder Registered → Invited → Joined → Opted-out, add
 * free-text admin notes, and tag them for later segmentation.
 *
 * Phase 2 (bulk email campaigns) will build on top of these tags +
 * status slices. Nothing on this page sends email — this is the
 * source-of-truth view + workflow layer.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  foundingMembersCrmApi,
  type CRMFoundingMember,
  type CRMFoundingMembersStats,
  type CRMFoundingMemberStatus,
} from '@/lib/cms-api';

const STATUS_ORDER: CRMFoundingMemberStatus[] = ['registered', 'invited', 'joined', 'opted_out'];

const STATUS_META: Record<CRMFoundingMemberStatus, { label: string; tone: string; bg: string; fg: string }> = {
  registered: { label: 'Registered', tone: 'Awaiting contact',        bg: '#FEF3C7', fg: '#92400E' },
  invited:    { label: 'Invited',    tone: 'Invite sent',             bg: '#DBEAFE', fg: '#1E40AF' },
  joined:     { label: 'Joined',     tone: 'Signed up to FriendPlace', bg: '#DCFCE7', fg: '#166534' },
  opted_out:  { label: 'Opted out',  tone: 'Asked to be removed',     bg: '#F1F5F9', fg: '#475569' },
};

const FILTERS: Array<{ key: 'all' | CRMFoundingMemberStatus; label: string }> = [
  { key: 'all',        label: 'All' },
  { key: 'registered', label: 'Awaiting contact' },
  { key: 'invited',    label: 'Invited' },
  { key: 'joined',     label: 'Joined' },
  { key: 'opted_out',  label: 'Opted out' },
];

export default function FoundingMembersCRMPage() {
  const [rows, setRows] = useState<CRMFoundingMember[]>([]);
  const [stats, setStats] = useState<CRMFoundingMembersStats | null>(null);
  const [filter, setFilter] = useState<'all' | CRMFoundingMemberStatus>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const showToast = (msg: string, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        foundingMembersCrmApi.list({ status: filter === 'all' ? undefined : filter, q: q || undefined, limit: 500 }),
        foundingMembersCrmApi.stats(),
      ]);
      setRows(listRes.rows || []);
      setStats(statsRes);
    } catch (e: any) {
      showToast(e?.message || 'Failed to load Founding Members');
    } finally {
      setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => { void load(); }, [load]);

  // ── Inline update helpers ─────────────────────────────────────
  const applyPatch = async (
    id: string,
    patch: Partial<Pick<CRMFoundingMember, 'status' | 'admin_notes' | 'tags'>>,
    optimistic?: Partial<CRMFoundingMember>,
  ) => {
    // Optimistic update so the UI feels immediate.
    const prev = rows;
    if (optimistic) {
      setRows(prev.map(r => (r.id === id ? { ...r, ...optimistic } : r)));
    }
    try {
      const updated = await foundingMembersCrmApi.update(id, patch);
      setRows(cur => cur.map(r => (r.id === id ? { ...r, ...updated } : r)));
      // Refresh stats so the dashboard counters stay live.
      try { setStats(await foundingMembersCrmApi.stats()); } catch { /* non-fatal */ }
      showToast('Saved');
    } catch (e: any) {
      setRows(prev);
      showToast(e?.message || 'Save failed');
    }
  };

  return (
    <AdminShell title="Founding Members">
      <p style={{ color: '#475569', fontSize: 16, marginTop: -8, marginBottom: 20, maxWidth: 760 }}>
        Every visitor who Registered Their Interest lives here. Walk each one through the status
        ladder as you talk to them — the database is the source of truth. Bulk email campaigns land
        in Phase 2, once this workflow is happy.
      </p>

      {/* Dashboard cards */}
      <StatsRow stats={stats} loading={loading && !stats} />

      {/* Filter + search bar */}
      <div style={filterBar}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            const count = f.key === 'all'
              ? stats?.total
              : f.key === 'registered' ? stats?.awaiting_contact
              : f.key === 'invited'    ? stats?.invited
              : f.key === 'joined'     ? stats?.joined
              : stats?.opted_out;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{
                  ...s.ghostBtn,
                  padding: '8px 14px',
                  borderColor: active ? '#14B8A6' : '#CBD5E1',
                  background: active ? 'linear-gradient(135deg, #14B8A6, #0EA5A0)' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#0A2540',
                  boxShadow: active ? '0 8px 20px rgba(20,184,166,0.25)' : 'none',
                }}
              >
                {f.label}
                {typeof count === 'number' && (
                  <span style={{
                    marginLeft: 8, fontWeight: 900, fontSize: 12,
                    opacity: 0.85,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <input
          className="cms-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, email, location, tags…"
          style={{ ...s.input, maxWidth: 320 }}
        />
      </div>

      {/* Table */}
      <div style={tableCard}>
        <div style={tableHeader}>
          <div style={{ ...cellHead, flex: '1.4 1 0' }}>Name / email</div>
          <div style={{ ...cellHead, flex: '1 1 0' }}>Location · Referral</div>
          <div style={{ ...cellHead, flex: '0.9 1 0' }}>Registered</div>
          <div style={{ ...cellHead, flex: '0.9 1 0' }}>Status</div>
          <div style={{ ...cellHead, flex: '1.2 1 0' }}>Tags</div>
          <div style={{ ...cellHead, flex: '0.6 1 0', textAlign: 'right' }}>&nbsp;</div>
        </div>

        {loading ? (
          <div style={emptyState}><p style={{ color: '#64748B', margin: 0 }}>Loading…</p></div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
            <p style={{ color: '#0A2540', fontSize: 16, fontWeight: 700, margin: 0 }}>No Founding Members yet</p>
            <p style={{ color: '#64748B', fontSize: 13, marginTop: 6, marginBottom: 0 }}>
              Once people submit the Register Interest form, they&rsquo;ll appear here.
            </p>
          </div>
        ) : (
          rows.map(r => (
            <MemberRow
              key={r.id}
              row={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(cur => (cur === r.id ? null : r.id))}
              onUpdate={applyPatch}
            />
          ))
        )}
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

// ─── Stats row ────────────────────────────────────────────────

function StatsRow({ stats, loading }: { stats: CRMFoundingMembersStats | null; loading: boolean }) {
  const latestName = stats?.latest?.name || (stats?.latest?.email?.split('@')[0]) || '';
  const latestWhen = stats?.latest?.created_at ? relTime(stats.latest.created_at) : '';
  return (
    <div style={statsGrid}>
      <StatCard tone="teal" emoji="🌟" label="Total Founding Members" value={stats?.total} loading={loading} />
      <StatCard tone="teal" emoji="✨" label="New today"              value={stats?.new_today} loading={loading} />
      <StatCard tone="amber" emoji="📮" label="Awaiting contact"       value={stats?.awaiting_contact} loading={loading} />
      <StatCard
        tone="navy" emoji="🕓"
        label="Latest registration"
        value={loading ? undefined : (latestName || '—')}
        sub={loading ? '' : (latestWhen || (stats?.latest ? '' : 'None yet'))}
        isText
      />
    </div>
  );
}

function StatCard({
  tone, emoji, label, value, sub, isText, loading,
}: {
  tone: 'teal' | 'amber' | 'navy';
  emoji: string;
  label: string;
  value: number | string | undefined;
  sub?: string;
  isText?: boolean;
  loading?: boolean;
}) {
  const palette = tone === 'teal'
    ? { bg: 'linear-gradient(140deg, #CCFBF1 0%, #F0FDFA 100%)', border: 'rgba(20,184,166,0.28)', accent: '#0F766E' }
    : tone === 'amber'
    ? { bg: 'linear-gradient(140deg, #FEF3C7 0%, #FEFCE8 100%)', border: 'rgba(217,119,6,0.28)', accent: '#B45309' }
    : { bg: '#FFFFFF', border: '#E2E8F0', accent: '#64748B' };
  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      borderRadius: 18,
      padding: 20,
      minHeight: 112,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 24 }}>{emoji}</div>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 800, color: palette.accent }}>
          {label}
        </div>
        <div style={{
          fontSize: isText ? 20 : 30,
          fontWeight: 900, color: '#0A2540', marginTop: 4, lineHeight: 1.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {loading ? '—' : (value === undefined ? '—' : value)}
        </div>
        {sub && <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────

function MemberRow({
  row, expanded, onToggle, onUpdate,
}: {
  row: CRMFoundingMember;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<CRMFoundingMember, 'status' | 'admin_notes' | 'tags'>>,
    optimistic?: Partial<CRMFoundingMember>,
  ) => void;
}) {
  const [notesDraft, setNotesDraft] = useState(row.admin_notes || '');
  const [tagInput, setTagInput] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const notesInitial = useRef(row.admin_notes || '');

  useEffect(() => {
    setNotesDraft(row.admin_notes || '');
    notesInitial.current = row.admin_notes || '';
  }, [row.admin_notes]);

  const displayName = [row.first_name, row.last_name].filter(Boolean).join(' ')
    || (row.email?.split('@')[0]) || 'Unnamed';
  const status = (row.status || 'registered') as CRMFoundingMemberStatus;
  const meta = STATUS_META[status];
  const location = row.state_country || [row.suburb, row.state].filter(Boolean).join(', ') || '';
  const referral = row.heard_from || '';

  const saveNotes = async () => {
    if (notesDraft === notesInitial.current) return;
    setSavingNotes(true);
    try {
      await onUpdate(row.id, { admin_notes: notesDraft }, { admin_notes: notesDraft });
      notesInitial.current = notesDraft;
    } finally { setSavingNotes(false); }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    const next = Array.from(new Set([...(row.tags || []), t])).slice(0, 20);
    setTagInput('');
    void onUpdate(row.id, { tags: next }, { tags: next });
  };

  const removeTag = (t: string) => {
    const next = (row.tags || []).filter(x => x !== t);
    void onUpdate(row.id, { tags: next }, { tags: next });
  };

  return (
    <div style={{
      borderTop: '1px solid #F1F5F9',
      background: expanded ? '#F8FAFC' : '#FFFFFF',
      transition: 'background 0.15s',
    }}>
      <div style={rowLine} onClick={onToggle} role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div style={{ ...cellBody, flex: '1.4 1 0' }}>
          <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 15 }}>{displayName}</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            <a
              href={`mailto:${row.email}`}
              onClick={e => e.stopPropagation()}
              style={{ color: '#0EA5A0', textDecoration: 'none' }}
            >
              {row.email}
            </a>
          </div>
        </div>
        <div style={{ ...cellBody, flex: '1 1 0', color: '#475569', fontSize: 13 }}>
          {location || <span style={{ opacity: 0.5 }}>—</span>}
          {referral && (
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
              via {referral}
            </div>
          )}
        </div>
        <div style={{ ...cellBody, flex: '0.9 1 0', color: '#475569', fontSize: 13 }}>
          <div>{fmtDate(row.created_at)}</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{relTime(row.created_at)}</div>
        </div>
        <div style={{ ...cellBody, flex: '0.9 1 0' }} onClick={e => e.stopPropagation()}>
          <select
            className="cms-input"
            value={status}
            onChange={e => onUpdate(row.id, { status: e.target.value as CRMFoundingMemberStatus }, { status: e.target.value as CRMFoundingMemberStatus })}
            style={{
              ...s.input,
              padding: '7px 10px', fontSize: 12, fontWeight: 800,
              background: meta.bg, color: meta.fg, borderColor: 'transparent',
              maxWidth: 160,
            }}
          >
            {STATUS_ORDER.map(sv => (
              <option key={sv} value={sv}>{STATUS_META[sv].label}</option>
            ))}
          </select>
        </div>
        <div style={{ ...cellBody, flex: '1.2 1 0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(row.tags || []).length > 0 ? (
              (row.tags || []).slice(0, 4).map(t => <TagPill key={t} label={t} />)
            ) : (
              <span style={{ color: '#94A3B8', fontSize: 12 }}>No tags</span>
            )}
            {(row.tags || []).length > 4 && (
              <span style={{ color: '#94A3B8', fontSize: 11 }}>+{(row.tags || []).length - 4}</span>
            )}
          </div>
        </div>
        <div style={{ ...cellBody, flex: '0.6 1 0', textAlign: 'right' }}>
          <span style={{ color: '#94A3B8', fontSize: 18 }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>

      {expanded && (
        <div style={expandPanel} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20 }}>
            <div>
              <label style={s.label}>Admin notes</label>
              <textarea
                className="cms-textarea"
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                onBlur={saveNotes}
                placeholder="Private notes — only admins see these. e.g. 'Chatted at Manly meetup, keen to help with recipes group.'"
                style={{ ...s.textarea, minHeight: 100 }}
                maxLength={5000}
              />
              <div style={{ ...s.helper, display: 'flex', justifyContent: 'space-between' }}>
                <span>{savingNotes ? 'Saving…' : 'Auto-saves on blur'}</span>
                <span>{notesDraft.length}/5000</span>
              </div>
            </div>
            <div>
              <label style={s.label}>Tags</label>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px',
                background: '#FFFFFF', border: '1.5px solid #CBD5E1', borderRadius: 12,
                minHeight: 44,
              }}>
                {(row.tags || []).map(t => (
                  <TagPill key={t} label={t} onRemove={() => removeTag(t)} />
                ))}
                <input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={() => tagInput.trim() && addTag()}
                  placeholder={(row.tags || []).length ? '' : 'e.g. sydney, coffee-fan, phase-2-invite'}
                  style={{
                    border: 'none', outline: 'none', fontSize: 13,
                    flex: '1 1 120px', minWidth: 120, background: 'transparent',
                  }}
                  maxLength={40}
                />
              </div>
              <div style={s.helper}>
                Press Enter or comma to add. Up to 20 tags, 40 chars each.
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={s.label}>Companion chosen</label>
                <div style={{ fontSize: 13, color: '#0A2540', fontWeight: 700 }}>
                  {row.companion_choice
                    ? (row.companion_choice[0].toUpperCase() + row.companion_choice.slice(1))
                    : <span style={{ color: '#94A3B8', fontWeight: 400 }}>—</span>}
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={`mailto:${row.email}`}
                  className="cms-btn-ghost"
                  style={{ ...s.ghostBtn, textDecoration: 'none' }}
                >
                  ✉️ Email {row.first_name || 'them'}
                </a>
                {status !== 'invited' && (
                  <button
                    type="button"
                    className="cms-btn-primary"
                    style={s.primaryBtn}
                    onClick={() => onUpdate(row.id, { status: 'invited' }, { status: 'invited' })}
                  >
                    Mark as Invited
                  </button>
                )}
                {status !== 'joined' && status !== 'opted_out' && (
                  <button
                    type="button"
                    className="cms-btn-ghost"
                    style={s.ghostBtn}
                    onClick={() => onUpdate(row.id, { status: 'joined' }, { status: 'joined' })}
                  >
                    Mark as Joined
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TagPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px',
      background: '#E0F2FE', color: '#075985',
      borderRadius: 999, fontSize: 11, fontWeight: 700,
      maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: 'none', background: 'transparent', color: '#075985',
            fontSize: 14, lineHeight: 1, padding: 0, cursor: 'pointer',
          }}
          aria-label={`Remove tag ${label}`}
        >×</button>
      )}
    </span>
  );
}

// ─── Utils ────────────────────────────────────────────────────
function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.round(diff / 1000);
  if (s < 30) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Styles ──────────────────────────────────────────────────
const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
  marginBottom: 22,
};

const filterBar: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 16, flexWrap: 'wrap', marginBottom: 16,
};

const tableCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 18,
  overflow: 'hidden',
};

const tableHeader: React.CSSProperties = {
  display: 'flex',
  padding: '12px 18px',
  background: '#F8FAFC',
  borderBottom: '1px solid #E2E8F0',
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontWeight: 800, color: '#64748B',
  gap: 12,
};

const cellHead: React.CSSProperties = { minWidth: 0 };
const cellBody: React.CSSProperties = { minWidth: 0 };

const rowLine: React.CSSProperties = {
  display: 'flex',
  padding: '16px 18px',
  alignItems: 'center',
  gap: 12,
  cursor: 'pointer',
};

const expandPanel: React.CSSProperties = {
  padding: '18px 22px 22px 22px',
  background: '#F8FAFC',
  borderTop: '1px dashed #E2E8F0',
};

const emptyState: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
};
