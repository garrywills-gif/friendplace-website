'use client';

/**
 * Member Profile — Slice 1 (MCGS Member Management)
 *
 * The safeguarded surface for every moderation action. Structure:
 *   1. Identity block (avatar · full name · handle · email · Member ID · joined)
 *   2. Moderation Summary card (reports open/total · warnings · suspensions · bans · notes · last action)
 *   3. Unified timeline: reports + moderation_log interleaved reverse-chronologically
 *   4. Add-note composer + Ask George prompts
 *   5. Action bar (Warn · Suspend · Ban · Restore · Delete) — every one
 *      opens the ConfirmIdentityAction dialog first. The dialog is the
 *      NON-NEGOTIABLE safeguard — the member's identity must be shown
 *      and re-checked before anything destructive lands.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { ConfirmIdentityAction, type ModAction } from '@/components/admin/ConfirmIdentityAction';
import { cmsApi, type MemberProfile, type MemberRow, type MemberModerationLogEntry, type MemberReport } from '@/lib/cms-api';
import { MemberIdentityHeader } from '@/components/members/MemberIdentityHeader';
import { ModerationSummaryCard } from '@/components/members/ModerationSummaryCard';
import { ModerationTimeline } from '@/components/members/ModerationTimeline';
import { AwardPointsModal, ReverseAwardModal } from '@/components/members/AwardPointsModal';
import { butterflyPointsApi, type BpLedgerEntry } from '@/lib/cms-api';

export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const userId = decodeURIComponent(params?.id ?? '');
  const fromRef = search?.get('from') || '';   // e.g. "report:R-1234"

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ModAction | null>(null);
  const [pendingReportId, setPendingReportId] = useState<string | undefined>(undefined);
  const [pendingReason, setPendingReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // iter164h — Butterfly Points recognition (Mission Control).
  const [pointsLedger, setPointsLedger] = useState<BpLedgerEntry[]>([]);
  const [pointsBalance, setPointsBalance] = useState<number>(0);
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<BpLedgerEntry | null>(null);

  const loadPoints = useCallback(async () => {
    if (!userId) return;
    try {
      const p = await butterflyPointsApi.list(userId);
      setPointsLedger(p.ledger);
      setPointsBalance(p.points);
    } catch { /* silent — section is optional data */ }
  }, [userId]);

  useEffect(() => { void loadPoints(); }, [loadPoints]);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await cmsApi.getMember(userId);
      setProfile(p);
    } catch (e: any) {
      setError(e?.message || 'Failed to load member profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  // Auto-dismiss banner.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3600);
    return () => clearTimeout(t);
  }, [banner]);

  // Keyboard shortcuts (Slice 1 improvement): w warn · s suspend · b ban · r restore · n note.
  useEffect(() => {
    if (!profile || pendingAction) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, ModAction> = { w: 'warn', s: 'suspend', b: 'ban', r: 'restore' };
      if (map[e.key]) { setPendingReason(''); setPendingReportId(undefined); setPendingAction(map[e.key]); }
      if (e.key === 'n') {
        (document.getElementById('member-note-input') as HTMLTextAreaElement | null)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profile, pendingAction]);

  const memberRow: MemberRow | null = useMemo(() => {
    if (!profile) return null;
    const u = profile.user;
    return {
      id: u.id, first_name: u.first_name, last_name: u.last_name,
      display_name: u.display_name, username: u.username, email: u.email,
      avatar: u.avatar, created_at: u.created_at, last_active: u.last_active,
      restricted: u.restricted, banned: u.banned,
      suspended_until: u.suspended_until, restricted_reason: u.restricted_reason,
      flagged_for_review: u.flagged_for_review, profile_hidden: u.profile_hidden,
      is_admin: u.is_admin, is_demo: u.is_demo, is_founding: u.is_founding,
    };
  }, [profile]);

  // Structured surface context piped to George on THIS profile page.
  // Rebuilt whenever the profile refreshes so a warn/note that just
  // landed shows up on the next Ask George turn. Trimmed hard so the
  // prompt block stays small — George can pull the full history via
  // tools if he needs more than the top 6 actions/reports.
  const surfaceContext = useMemo(() => {
    if (!profile || !memberRow) return undefined;
    const suspendedActive = !!(profile.user.suspended_until && new Date(profile.user.suspended_until) > new Date());
    const status = profile.user.banned
      ? 'banned'
      : suspendedActive
      ? 'suspended'
      : profile.user.restricted
      ? 'restricted'
      : 'good_standing';
    return {
      surface: 'member_profile',
      member: {
        id: memberRow.id,
        display_name: displayNameFor(memberRow),
        email: memberRow.email || '',
        username: memberRow.username || '',
        created_at: memberRow.created_at || '',
        status,
        restricted_reason: memberRow.restricted_reason || '',
      },
      counts: {
        reports_open: profile.counts.reports_open,
        reports_total: profile.counts.reports_total,
        warnings: profile.counts.warnings,
        suspensions: profile.counts.suspensions,
        bans: profile.counts.bans,
        notes: profile.counts.notes,
        actions_total: profile.counts.actions_total,
        last_action: profile.counts.last_action,
        last_action_at: profile.counts.last_action_at,
      },
      recent_actions: profile.moderation_log.slice(0, 6).map((e) => ({
        action: e.action,
        at: e.created_at,
        by: e.by_user?.display_name || e.by_user?.first_name || e.by_user?.email || e.by || 'system',
        reason: e.reason || '',
        duration_hours: e.duration_hours || undefined,
      })),
      recent_reports: profile.reports.slice(0, 6).map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason || '',
        at: r.created_at,
        urgent: !!r.urgent,
      })),
    };
  }, [profile, memberRow]);

  async function handleActionConfirm(
    payload: { reason: string; durationHours?: number; confirmMemberId?: string }
  ) {
    if (!pendingAction || !memberRow) return;
    setBusy(true);
    try {
      const id = memberRow.id;
      if (pendingAction === 'warn') {
        await cmsApi.warnMember(id, { reason: payload.reason, report_id: pendingReportId });
      } else if (pendingAction === 'suspend') {
        await cmsApi.suspendMember(id, {
          reason: payload.reason,
          duration_hours: Math.max(1, payload.durationHours || 24),
          report_id: pendingReportId,
        });
      } else if (pendingAction === 'ban') {
        await cmsApi.banMember(id, { reason: payload.reason, report_id: pendingReportId });
      } else if (pendingAction === 'restore') {
        await cmsApi.restoreMember(id, { reason: payload.reason });
      } else if (pendingAction === 'delete') {
        await cmsApi.deleteMember(id, {
          confirm_member_id: payload.confirmMemberId || '',
          reason: payload.reason,
        });
      }
      setBanner({ tone: 'ok', text: `✅ ${verbFor(pendingAction, true)} applied for ${memberRow.id.slice(0, 8)}…` });
      setPendingAction(null);
      if (pendingAction === 'delete') {
        // Redirect back to the list — the member no longer exists.
        setTimeout(() => router.replace('/admin/members'), 700);
      } else {
        await reload();
      }
    } catch (e: any) {
      setBanner({ tone: 'err', text: e?.message || 'Action failed' });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote() {
    if (!memberRow) return;
    const note = noteDraft.trim();
    if (!note) return;
    setSavingNote(true);
    try {
      await cmsApi.addMemberNote(memberRow.id, note);
      setNoteDraft('');
      setBanner({ tone: 'ok', text: '📝 Note added to member timeline.' });
      await reload();
    } catch (e: any) {
      setBanner({ tone: 'err', text: e?.message || 'Failed to save note' });
    } finally {
      setSavingNote(false);
    }
  }

  const suspendedActive = !!(profile?.user.suspended_until && new Date(profile.user.suspended_until) > new Date());
  const restricted = !!profile?.user.restricted;
  const banned = !!profile?.user.banned;

  return (
    <AdminShell title="Member profile">
      {/* Back link — keeps the "from=report:xxx" sticky if provided. */}
      <div style={{ marginBottom: 12 }}>
        <Link href="/admin/members" style={backLink}>← Members</Link>
        {fromRef && <span style={{ marginLeft: 8, fontSize: 12, color: '#64748B' }}>
          &middot; opened from <code style={{ fontFamily: 'ui-monospace, monospace' }}>{fromRef}</code>
        </span>}
      </div>

      {loading && <div style={helperText}>Loading…</div>}
      {error && <div style={errBanner}>{error}</div>}

      {banner && (
        <div style={banner.tone === 'ok' ? okBanner : errBanner}>{banner.text}</div>
      )}

      {profile && memberRow && (
        <>
          <MemberIdentityHeader member={memberRow} />

          <div style={{ marginTop: 20 }}>
            <ModerationSummaryCard counts={profile.counts} restricted={restricted} banned={banned} suspendedActive={suspendedActive} />
          </div>

          {/* Action bar */}
          <div style={{ ...actionBar, marginTop: 20 }}>
            <button
              type="button"
              style={{ ...actionBtn, ...warnBtn }}
              disabled={banned}
              onClick={() => { setPendingAction('warn'); setPendingReason(''); setPendingReportId(undefined); }}
              title="Send a warning (W)"
            >
              ⚠️ Warn
            </button>
            <button
              type="button"
              style={{ ...actionBtn, ...suspendBtn }}
              disabled={banned || suspendedActive}
              onClick={() => { setPendingAction('suspend'); setPendingReason(''); setPendingReportId(undefined); }}
              title="Suspend (S)"
            >
              ⏸ Suspend
            </button>
            <button
              type="button"
              style={{ ...actionBtn, ...banBtn }}
              disabled={banned}
              onClick={() => { setPendingAction('ban'); setPendingReason(''); setPendingReportId(undefined); }}
              title="Ban (B)"
            >
              🚫 Ban
            </button>
            {(restricted || banned || suspendedActive) && (
              <button
                type="button"
                style={{ ...actionBtn, ...restoreBtn }}
                onClick={() => { setPendingAction('restore'); setPendingReason(''); setPendingReportId(undefined); }}
                title="Restore (R)"
              >
                ↩️ Restore
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={{ ...actionBtn, ...deleteBtn }}
              onClick={() => { setPendingAction('delete'); setPendingReason(''); setPendingReportId(undefined); }}
              title="Delete permanently"
            >
              🗑️ Delete permanently
            </button>
          </div>
          <div style={shortcutsRow}>
            <span>Shortcuts</span>
            <kbd style={kbd}>W</kbd> warn · <kbd style={kbd}>S</kbd> suspend · <kbd style={kbd}>B</kbd> ban · <kbd style={kbd}>R</kbd> restore · <kbd style={kbd}>N</kbd> note
          </div>

          {/* iter164h — Butterfly Points recognition (Mission Control) */}
          <section style={pointsCard} data-testid="butterfly-points-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 22 }}>🦋</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 800, color: '#0F766E' }}>
                  Butterfly Points
                </div>
                <div style={{ fontSize: 18, color: '#0A2540', fontWeight: 800, marginTop: 2 }}>
                  {pointsBalance} {pointsBalance === 1 ? 'point' : 'points'} on the balance
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAwardModal(true)}
                data-testid="award-points-btn"
                style={{ ...actionBtn, background: '#0D9488', color: '#FFFFFF', borderColor: '#0D9488' }}
              >
                🦋 Award Butterfly Points
              </button>
            </div>
            {pointsLedger.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pointsLedger.slice(0, 8).map((row) => {
                  const isReversed = !!row.reversed_at;
                  const isReversal = row.kind === 'reversal';
                  return (
                    <div key={row.id}
                      data-testid={`points-ledger-${row.id}`}
                      style={{
                        border: '1px solid #E2E8F0', borderRadius: 12,
                        padding: '10px 12px', background: isReversed ? '#F8FAFC' : '#FFFFFF',
                        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                      }}>
                      <div style={{
                        width: 46, textAlign: 'center', fontWeight: 900,
                        fontSize: 15,
                        color: isReversal ? '#B91C1C' : '#0F766E',
                      }}>
                        {isReversal ? row.amount : `+${row.amount}`}
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 14, color: '#0A2540', fontWeight: isReversed ? 500 : 700, textDecoration: isReversed && !isReversal ? 'line-through' : 'none' }}>
                          {isReversal ? 'Reversal — ' : ''}{row.reason}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                          {isReversal ? '↩ ' : `🦋 ${row.persona === 'georgia' ? 'Georgia' : 'George'} · `}
                          {row.admin_email || row.admin_name || 'admin'} ·{' '}
                          {new Date(row.created_at).toLocaleString()}
                          {isReversed && !isReversal && ' · reversed'}
                        </div>
                      </div>
                      {!isReversed && !isReversal && (
                        <button
                          type="button"
                          onClick={() => setReverseTarget(row)}
                          data-testid={`reverse-btn-${row.id}`}
                          style={{
                            background: 'transparent', border: '1px solid #FCA5A5',
                            color: '#B91C1C', borderRadius: 8, padding: '4px 10px',
                            fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add note composer */}
          <section style={noteCard}>
            <label style={noteLabel}>Add a moderator note</label>
            <textarea
              id="member-note-input"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Context you want on the record. Notes are visible to other admins in the timeline below."
              style={noteInput}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                onClick={handleAddNote}
                disabled={savingNote || !noteDraft.trim()}
                style={notePrimary}
              >
                {savingNote ? 'Saving…' : '📝 Add note'}
              </button>
            </div>
          </section>

          {/* Ask George — 5 fairness-focused prompts (per Slice 1 improvement checklist) */}
          <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
            <AskGeorgeAboutThis
              label="Ask George about this member"
              contextId={memberRow.id}
              contextType="member_profile"
              context={surfaceContext}
              prompts={[
                `Summarise this member's moderation history in plain words.`,
                `Compare this member's prior reports — are they variations of the same issue?`,
                `Spot patterns across this member's reports and moderation actions.`,
                `Is there anything unusual about this member's recent activity?`,
                `Have we treated similar cases consistently, or is there a fairness concern here?`,
              ]}
            />
            <span style={{ fontSize: 12, color: '#64748B' }}>
              George helps you understand. He never decides.
            </span>
          </div>

          {/* Unified timeline */}
          <section style={{ marginTop: 24 }}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Timeline</h2>
              <span style={sectionSubtitle}>
                {profile.moderation_log.length} action{profile.moderation_log.length === 1 ? '' : 's'} · {profile.reports.length} report{profile.reports.length === 1 ? '' : 's'}
              </span>
            </div>
            <ModerationTimeline
              log={profile.moderation_log}
              reports={profile.reports}
              onActFromReport={(report, action) => {
                setPendingReportId(report.id);
                setPendingReason(report.reason || '');
                setPendingAction(action);
              }}
            />
          </section>

          {/* Confirmation dialog — the non-negotiable safeguard */}
          {pendingAction && (
            <ConfirmIdentityAction
              open={!!pendingAction}
              member={memberRow}
              action={pendingAction}
              initialReason={pendingReason}
              reportId={pendingReportId}
              onClose={() => setPendingAction(null)}
              onConfirm={handleActionConfirm}
            />
          )}

          {/* Busy overlay while an action is landing (very short) */}
          {busy && <div style={busyOverlay}>Applying…</div>}

          {/* iter164h — Butterfly Points modals */}
          {showAwardModal && (
            <AwardPointsModal
              memberId={memberRow.id}
              memberFirstName={memberRow.first_name}
              onClose={() => setShowAwardModal(false)}
              onAwarded={(msg) => {
                setShowAwardModal(false);
                setBanner({ tone: 'ok', text: msg });
                void loadPoints();
                void reload();
              }}
            />
          )}
          {reverseTarget && (
            <ReverseAwardModal
              memberId={memberRow.id}
              ledgerId={reverseTarget.id}
              ledgerSummary={`+${reverseTarget.amount} awarded ${new Date(reverseTarget.created_at).toLocaleString()} — "${reverseTarget.reason}"`}
              onClose={() => setReverseTarget(null)}
              onReversed={(msg) => {
                setReverseTarget(null);
                setBanner({ tone: 'ok', text: msg });
                void loadPoints();
                void reload();
              }}
            />
          )}
        </>
      )}
    </AdminShell>
  );
}

function displayNameFor(m: MemberRow): string {
  return (
    m.display_name?.trim()
    || [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
    || m.username?.trim()
    || m.email?.trim()
    || m.id
  );
}

function verbFor(a: ModAction, past = false): string {
  const map: Record<ModAction, [string, string]> = {
    warn:    ['Warn',    'Warning'],
    suspend: ['Suspend', 'Suspension'],
    ban:     ['Ban',     'Ban'],
    restore: ['Restore', 'Restoration'],
    delete:  ['Delete',  'Deletion'],
  };
  return past ? map[a][1] : map[a][0];
}

// ─── styles ────────────────────────────────────────────────────────────
const helperText: React.CSSProperties = { color: '#64748B', fontSize: 13, marginTop: 12 };
const errBanner: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 12 };
const okBanner: React.CSSProperties = { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 12 };
const backLink: React.CSSProperties = { color: '#64748B', fontSize: 13, textDecoration: 'none', fontWeight: 600 };
const actionBar: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12 };
const actionBtn: React.CSSProperties = { padding: '9px 16px', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const warnBtn: React.CSSProperties    = { background: '#F59E0B', color: '#FFFFFF' };
const suspendBtn: React.CSSProperties = { background: '#DC2626', color: '#FFFFFF' };
const banBtn: React.CSSProperties     = { background: '#7F1D1D', color: '#FFFFFF' };
const restoreBtn: React.CSSProperties = { background: '#0F766E', color: '#FFFFFF' };
const deleteBtn: React.CSSProperties  = { background: '#FFFFFF', color: '#7F1D1D', border: '1px solid #FCA5A5' };
const shortcutsRow: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', color: '#94A3B8', fontSize: 12, marginTop: 8 };
const kbd: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, fontWeight: 700, border: '1px solid #E2E8F0' };
const noteCard: React.CSSProperties = { marginTop: 20, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14 };
const pointsCard: React.CSSProperties = {
  marginTop: 20,
  background: 'linear-gradient(140deg, #F0FDFA 0%, #ECFEFF 100%)',
  border: '1px solid rgba(20,184,166,0.35)',
  borderRadius: 14,
  padding: 16,
};
const noteLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 };
const noteInput: React.CSSProperties = { width: '100%', minHeight: 88, padding: 10, border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.45, background: '#FFFFFF', boxSizing: 'border-box' };
const notePrimary: React.CSSProperties = { padding: '8px 14px', background: '#0F172A', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const sectionHeader: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' };
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 };
const sectionSubtitle: React.CSSProperties = { fontSize: 13, color: '#64748B' };
const busyOverlay: React.CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #0F172A, #38BDF8)', zIndex: 200 };
