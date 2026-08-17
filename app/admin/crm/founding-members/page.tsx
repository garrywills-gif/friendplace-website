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
  downloadFoundingMembersCsv,
  type CRMFoundingMember,
  type CRMFoundingMembersStats,
  type CRMFoundingMemberStatus,
  type CRMTimelineEvent,
} from '@/lib/cms-api';

const STATUS_ORDER: CRMFoundingMemberStatus[] = ['registered', 'invited', 'joined', 'opted_out'];

const STATUS_META: Record<CRMFoundingMemberStatus, { label: string; tone: string; bg: string; fg: string }> = {
  registered: { label: 'Registered', tone: 'Awaiting contact',        bg: '#FEF3C7', fg: '#92400E' },
  invited:    { label: 'Invited',    tone: 'Invite sent',             bg: '#DBEAFE', fg: '#1E40AF' },
  joined:     { label: 'Joined',     tone: 'Signed up to FriendPlace', bg: '#DCFCE7', fg: '#166534' },
  opted_out:  { label: 'Opted out',  tone: 'Asked to be removed',     bg: '#F1F5F9', fg: '#475569' },
};

const FILTERS: Array<{ key: 'all' | CRMFoundingMemberStatus; label: string; emptyLabel: string }> = [
  { key: 'all',        label: 'All',              emptyLabel: 'No Founding Members yet.' },
  { key: 'registered', label: 'Awaiting Contact', emptyLabel: 'No Founding Members are awaiting contact.' },
  { key: 'invited',    label: 'Invited',          emptyLabel: 'No Founding Members have been invited yet.' },
  { key: 'joined',     label: 'Joined',           emptyLabel: 'No Founding Members have joined FriendPlace yet.' },
  { key: 'opted_out',  label: 'Opted Out',        emptyLabel: 'No Founding Members have opted out.' },
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

   // ── Delete registration ────────────────────────────────────────
  // Two-step confirm handled in-panel (see AdminOverridePanel below).
  // This function only runs after the operator has typed the founder
  // number into the confirmation input. Removes the row from local
  // state on success and refreshes stats. Server rejects reserved
  // slots with a 403; the UI mirrors that check but the server is the
  // source of truth.
  const deleteRow = async (id: string): Promise<boolean> => {
    const prev = rows;
    try {
      const res = await foundingMembersCrmApi.remove(id);
      setRows(cur => cur.filter(r => r.id !== id));
      setExpandedId(cur => (cur === id ? null : cur));
      try { setStats(await foundingMembersCrmApi.stats()); } catch { /* non-fatal */ }
      const label = res.founder_number
        ? `#${String(res.founder_number).padStart(4, '0')} ${res.first_name || ''}`.trim()
        : (res.first_name || 'registration');
      showToast(`Deleted ${label}`);
      return true;
    } catch (e: any) {
      setRows(prev);
      showToast(e?.message || 'Delete failed');
      return false;
    }
  };

  const activeFilterMeta = FILTERS.find(f => f.key === filter);
  const emptyMessage = activeFilterMeta?.emptyLabel || 'No Founding Members yet.';
  const emptySubline = filter === 'all'
    ? 'Once people submit the Register Interest form, they\u2019ll appear here.'
    : (q ? 'Try clearing the search box to see more results.' : 'Try a different filter to see other Founding Members.');

  return (
    <AdminShell title="Founding Members">
      {/* Total-headline strip — the number that matters most, always in view. */}
      <div style={totalHeadline}>
        <div>
          <div style={totalEyebrow}>Total Founding Members</div>
          <div style={totalNumber}>
            {stats ? stats.total : <span style={{ opacity: 0.4 }}>…</span>}
          </div>
        </div>
        <p style={introCopy}>
          Everyone who registers their interest becomes a Founding Member. This page is the source of
          truth for managing invitations, notes, status and future email campaigns.
        </p>
      </div>

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
                aria-pressed={active}
                style={{
                  ...s.ghostBtn,
                  padding: '9px 16px',
                  borderColor: active ? '#0F766E' : '#CBD5E1',
                  background: active ? 'linear-gradient(135deg, #14B8A6, #0EA5A0)' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#0A2540',
                  boxShadow: active ? '0 6px 16px rgba(20,184,166,0.28)' : 'none',
                  fontWeight: 700,
                }}
              >
                {f.label}
                {typeof count === 'number' && (
                  <span style={{
                    marginLeft: 8,
                    padding: '1px 8px',
                    borderRadius: 999,
                    fontWeight: 900, fontSize: 11,
                    background: active ? 'rgba(255,255,255,0.22)' : '#F1F5F9',
                    color: active ? '#FFFFFF' : '#475569',
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
          placeholder="Search name, email, location, tags, #0003…"
          style={{ ...s.input, maxWidth: 320 }}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await downloadFoundingMembersCsv({
                status: filter === 'all' ? undefined : filter,
                q: q || undefined,
              });
              showToast('CSV downloaded');
            } catch (e: any) {
              showToast(e?.message || 'CSV export failed');
            }
          }}
          style={{ ...s.ghostBtn, padding: '8px 14px', fontSize: 12 }}
          title="Download the current filtered list as a spreadsheet"
        >
          ⤓ Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={tableCard}>
        <div style={tableHeader}>
          <div style={{ ...cellHead, flex: '1.4 1 0' }}>Name / email</div>
          <div style={{ ...cellHead, flex: '1 1 0' }}>Location · Referral</div>
          <div style={{ ...cellHead, flex: '0.9 1 0' }}>Registered</div>
          <div style={{ ...cellHead, flex: '0.9 1 0' }}>Status</div>
          <div style={{ ...cellHead, flex: '1.2 1 0' }}>Tags</div>
          <div style={{ ...cellHead, flex: '0.6 1 0', textAlign: 'right' }}>Details</div>
        </div>

        {loading ? (
          <div style={emptyState}><p style={{ color: '#64748B', margin: 0 }}>Loading…</p></div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
            <p style={{ color: '#0A2540', fontSize: 16, fontWeight: 700, margin: 0 }}>{emptyMessage}</p>
            <p style={{ color: '#64748B', fontSize: 13, marginTop: 6, marginBottom: 0 }}>
              {emptySubline}
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
              onDelete={deleteRow}
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
row, expanded, onToggle, onUpdate, onDelete,
}: {
  row: CRMFoundingMember;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<CRMFoundingMember, 'status' | 'admin_notes' | 'tags'>>,
    optimistic?: Partial<CRMFoundingMember>,
  ) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [notesDraft, setNotesDraft] = useState(row.admin_notes || '');
  const [tagInput, setTagInput] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const notesInitial = useRef(row.admin_notes || '');

  useEffect(() => {
    setNotesDraft(row.admin_notes || '');
    notesInitial.current = row.admin_notes || '';
  }, [row.admin_notes]);

  const [hovered, setHovered] = useState(false);

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
      background: expanded ? '#F0FDFA' : (hovered ? '#F8FAFC' : '#FFFFFF'),
      transition: 'background 0.15s',
    }}>
      <div
        style={rowLine}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${displayName}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div style={{ ...cellBody, flex: '1.4 1 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            {row.founder_number && (
              <span
                title={row.is_reserved ? 'Reserved Founding Member — permanent, locked' : 'Permanent Founding Member Number'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: row.is_reserved ? '#FEF3C7' : '#F0FDFA',
                  color: row.is_reserved ? '#92400E' : '#0F766E',
                  border: `1px solid ${row.is_reserved ? '#FDE68A' : '#99F6E4'}`,
                  fontSize: 11,
                  fontWeight: 900,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                }}
              >
                {row.is_reserved && <span style={{ fontSize: 9 }}>🔒</span>}
                #{String(row.founder_number).padStart(4, '0')}
              </span>
            )}
            <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 15 }}>{displayName}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            {row.email || <span style={{ opacity: 0.5 }}>—</span>}
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
        <div style={{ ...cellBody, flex: '0.9 1 0' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 999,
            background: meta.bg, color: meta.fg,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.02em',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: meta.fg, opacity: 0.7,
            }} />
            {meta.label}
          </span>
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
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px',
            borderRadius: 999,
            background: expanded ? '#0F766E' : '#F1F5F9',
            color: expanded ? '#FFFFFF' : '#0F766E',
            fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
            transition: 'background 0.15s, color 0.15s',
          }}>
            <span style={{ fontSize: 10, lineHeight: 1 }}>{expanded ? '▼' : '▶'}</span>
            {expanded ? 'Hide' : 'Details'}
          </span>
        </div>
      </div>

      {expanded && (
        <div style={expandPanel} onClick={e => e.stopPropagation()}>
          <FoundingMemberTimeline memberId={row.id} />
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

              <div style={{ marginTop: 20 }}>
                <label style={s.label}>Actions</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link
                    href={{
                      pathname: '/admin/emails',
                      query: {
                        to: row.email || '',
                        name: row.first_name || '',
                        template: 'invitation',
                      },
                    }}
                    className="cms-btn-primary"
                    style={{ ...s.primaryBtn, textDecoration: 'none' }}
                  >
                    ✉️ Compose invitation
                  </Link>
                </div>
                <div style={{ ...s.helper, marginTop: 6 }}>
                  Opens the Email Studio with {row.first_name || 'this person'} pre-populated as the
                  recipient. When you send, status will auto-advance to <strong>Invited</strong>.
                </div>
              </div>

              <AdminOverridePanel
                currentStatus={status}
               rowId={row.id}
founderNumber={row.founder_number}
isReserved={Boolean(row.is_reserved)}          
                onOverride={(newStatus) =>
                  onUpdate(row.id, { status: newStatus }, { status: newStatus })
               
                }
                onDelete={onDelete}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Override ─────────────────────────────────────────────
// Deliberately gated behind a click so it never becomes the default
// workflow. Copy explains that status will normally advance
// automatically as real actions happen (invitation sent, account
// created, unsubscribe clicked).
function AdminOverridePanel({
  currentStatus,
  rowId,
  founderNumber,
  isReserved,
  onOverride,
  onDelete,
}: {
  currentStatus: CRMFoundingMemberStatus;
  rowId: string;
  founderNumber?: number | null;
  isReserved: boolean;
  onOverride: (s: CRMFoundingMemberStatus) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CRMFoundingMemberStatus | null>(null);
const [deleteOpen, setDeleteOpen] = useState(false);
const [deleteConfirm, setDeleteConfirm] = useState('');
const [deleting, setDeleting] = useState(false);
  return (
    <div style={{
      marginTop: 22, paddingTop: 16,
      borderTop: '1px dashed #E2E8F0',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#64748B',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: 0,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        Advanced · Admin override
      </button>

      {open && (
        <div style={{
          marginTop: 12,
          padding: 14,
          background: '#FFF7ED',
          border: '1px solid #FDE68A',
          borderRadius: 12,
        }}>
          <p style={{ margin: 0, fontSize: 13, color: '#92400E', lineHeight: 1.55 }}>
            <strong>Only use this if you know what you&rsquo;re doing.</strong> Status normally
            advances automatically:
            <br />
            <span style={{ fontSize: 12 }}>
              • Registered — set when they submit the interest form.<br />
              • Invited — set when you send an invitation from Mission Control.<br />
              • Joined — set when they create their FriendPlace account.<br />
              • Opted out — set when they click Unsubscribe.
            </span>
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#0A2540' }}>Change status to:</label>
            <select
              value={pending || ''}
              onChange={e => setPending(e.target.value as CRMFoundingMemberStatus)}
              style={{
                ...s.input,
                padding: '6px 10px', fontSize: 12, fontWeight: 700, maxWidth: 200,
              }}
            >
              <option value="" disabled>Choose a status…</option>
              {STATUS_ORDER.filter(sv => sv !== currentStatus).map(sv => (
                <option key={sv} value={sv}>{STATUS_META[sv].label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!pending}
              onClick={() => {
                if (!pending) return;
                if (window.confirm(
                  `Override status to "${STATUS_META[pending].label}" without the corresponding real action?\n\n`
                  + `This bypasses the normal workflow (invitations, account signup, unsubscribes) `
                  + `and should only be used for genuine exceptions.`
                )) {
                  onOverride(pending);
                  setPending(null);
                  setOpen(false);
                }
              }}
              style={{
                ...s.dangerBtn,
                padding: '7px 14px',
                fontSize: 12,
                opacity: pending ? 1 : 0.5,
                cursor: pending ? 'pointer' : 'not-allowed',
              }}
            >
              Apply override
            </button>
          </div>
          {/* Permanent delete — deliberately inside Advanced Admin Override */}
<div
  style={{
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid #FECACA',
  }}
>
  {!deleteOpen ? (
    <button
      type="button"
      onClick={() => {
        setDeleteOpen(true);
        setDeleteConfirm('');
      }}
      disabled={isReserved}
      style={{
        ...s.dangerBtn,
        opacity: isReserved ? 0.45 : 1,
        cursor: isReserved ? 'not-allowed' : 'pointer',
      }}
    >
      Delete registration
    </button>
  ) : (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#B91C1C' }}>
        Permanently delete this registration?
      </div>

      <div style={{ ...s.helper, marginTop: 6 }}>
        This cannot be undone. Type the founder number to confirm.
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          value={deleteConfirm}
          onChange={e => setDeleteConfirm(e.target.value)}
          placeholder={founderNumber ? String(founderNumber) : 'Founder number'}
          style={{
            ...s.input,
            padding: '7px 10px',
            fontSize: 12,
            maxWidth: 180,
          }}
        />

        <button
          type="button"
          disabled={
            deleting ||
            !founderNumber ||
            deleteConfirm.trim() !== String(founderNumber)
          }
          onClick={async () => {
            if (
              !founderNumber ||
              deleteConfirm.trim() !== String(founderNumber)
            ) {
              return;
            }

            setDeleting(true);
            try {
              const deleted = await onDelete(rowId);
              if (deleted) {
                setDeleteOpen(false);
                setDeleteConfirm('');
              }
            } finally {
              setDeleting(false);
            }
          }}
          style={{
            ...s.dangerBtn,
            padding: '7px 14px',
            fontSize: 12,
            opacity:
              deleting ||
              !founderNumber ||
              deleteConfirm.trim() !== String(founderNumber)
                ? 0.5
                : 1,
          }}
        >
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </button>

        <button
          type="button"
          onClick={() => {
            setDeleteOpen(false);
            setDeleteConfirm('');
          }}
          disabled={deleting}
          style={{
           ...s.ghostBtn,
            padding: '7px 14px',
            fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>

      {isReserved && (
        <div style={{ ...s.helper, marginTop: 8 }}>
          Reserved founder seats cannot be deleted.
        </div>
      )}
    </div>
  )}
</div>
        </div>
      )}
    </div>
  );
}

function FoundingMemberTimeline({ memberId }: { memberId: string }) {
  const [events, setEvents] = useState<CRMTimelineEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await foundingMembersCrmApi.timeline(memberId);
        if (!cancelled) setEvents(r.events || []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load timeline');
      }
    })();
    return () => { cancelled = true; };
  }, [memberId]);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
          fontWeight: 800, color: '#0F766E',
        }}>Timeline</div>
        <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
      </div>
      {err ? (
        <div style={{ color: '#B91C1C', fontSize: 13 }}>{err}</div>
      ) : !events ? (
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading history…</div>
      ) : events.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>
          No recorded events yet.
        </div>
      ) : (
        <ul style={{
          listStyle: 'none', padding: 0, margin: 0,
          position: 'relative',
        }}>
          {/* vertical rail behind the dots */}
          <div style={{
            position: 'absolute', left: 11, top: 6, bottom: 6,
            width: 2, background: '#E2E8F0', borderRadius: 2,
          }} />
          {events.map((ev, idx) => {
            const meta = TIMELINE_META[ev.kind] || TIMELINE_META.email_sent;
            return (
              <li key={idx} style={{
                display: 'flex', gap: 12, paddingLeft: 4,
                paddingBottom: 12, position: 'relative',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: meta.bg, color: meta.fg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 900, flex: '0 0 20px',
                  border: `2px solid ${meta.rim}`, boxShadow: '0 0 0 3px #F8FAFC',
                  marginTop: 2,
                }}>{meta.glyph}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0A2540' }}>
                    {ev.title}
                  </div>
                  {ev.detail && (
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 1.5 }}>
                      {ev.detail}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                    {ev.at ? formatTimelineDate(ev.at) : '—'}
                    {ev.campaign_id && (
                      <>
                        {' · '}
                        <Link href={`/admin/campaigns/${ev.campaign_id}`}
                          style={{ color: '#0F766E', textDecoration: 'none', fontWeight: 700 }}>
                          view campaign
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const TIMELINE_META: Record<CRMTimelineEvent['kind'], { glyph: string; bg: string; fg: string; rim: string }> = {
  registered:        { glyph: '✓', bg: '#DCFCE7', fg: '#166534', rim: '#86EFAC' },
  ack_sent:          { glyph: '✉', bg: '#F0FDFA', fg: '#0F766E', rim: '#99F6E4' },
  email_sent:        { glyph: '✉', bg: '#F0FDFA', fg: '#0F766E', rim: '#99F6E4' },
  campaign_received: { glyph: '📮', bg: '#EEF2FF', fg: '#3730A3', rim: '#C7D2FE' },
  campaign_failed:   { glyph: '⚠', bg: '#FEE2E2', fg: '#B91C1C', rim: '#FCA5A5' },
  status_change:     { glyph: '↻', bg: '#FEF3C7', fg: '#92400E', rim: '#FDE68A' },
};

function formatTimelineDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
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
const totalHeadline: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 24,
  padding: '18px 22px',
  marginTop: -8,
  marginBottom: 22,
  background: 'linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)',
  borderRadius: 20,
  color: '#FFFFFF',
  boxShadow: '0 12px 32px rgba(20,184,166,0.22)',
  flexWrap: 'wrap',
};
const totalEyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.85)',
};
const totalNumber: React.CSSProperties = {
  fontSize: 48,
  fontWeight: 900,
  lineHeight: 1,
  marginTop: 4,
  letterSpacing: '-0.02em',
};
const introCopy: React.CSSProperties = {
  color: 'rgba(255,255,255,0.92)',
  fontSize: 15,
  lineHeight: 1.5,
  margin: 0,
  maxWidth: 520,
  flex: '1 1 320px',
};

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
