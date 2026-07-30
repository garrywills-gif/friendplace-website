'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { cmsApi, type SecurityEvent, type AdminSession, type Lockout } from '@/lib/cms-api';

type Tab = 'overview' | 'successes' | 'fails' | 'sessions' | 'lockouts' | 'password-changes';

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, sess, lo] = await Promise.all([
        cmsApi.securitySummary(),
        cmsApi.securitySessions(true),
        cmsApi.securityLockouts(),
      ]);
      setSummary(s); setSessions(sess.items); setLockouts(lo.items);
      // Preload events for the current tab
      const outcome = tab === 'successes' ? 'success'
        : tab === 'fails' ? 'fail'
        : tab === 'password-changes' ? 'password_change' : undefined;
      const ev = await cmsApi.securityEvents({ outcome, limit: 200 });
      setEvents(ev.items);
    } catch (e: any) {
      setError(e?.message || 'Failed to load security data');
    }
  }, [tab]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRevoke = async (jti: string) => {
    if (!confirm('Revoke this session? The admin using it will be signed out immediately.')) return;
    try { await cmsApi.revokeSession(jti); await refresh(); }
    catch (e: any) { setError(e?.message || 'Revoke failed'); }
  };
  const onUnlock = async (scope: 'email' | 'ip', key: string) => {
    if (!confirm(`Clear lockout for ${scope}: ${key}?`)) return;
    try { await cmsApi.clearLockout({ scope, key }); await refresh(); }
    catch (e: any) { setError(e?.message || 'Unlock failed'); }
  };

  return (
    <AdminShell title="Security">
      <p style={lede}>
        Every administrator action, every login attempt, every session — audited, filterable, and reviewable in one place.
      </p>

      {/* Summary tiles */}
      {summary && (
        <div style={tilesRow}>
          <Tile label="Active sessions" value={summary.active_sessions} tone="ok" />
          <Tile label="Active lockouts" value={summary.active_lockouts} tone={summary.active_lockouts > 0 ? 'warn' : 'ok'} />
          <Tile label="Successes (24h)" value={summary.successes_last_24h} tone="ok" />
          <Tile label="Failed attempts (24h)" value={summary.fails_last_24h} tone={summary.fails_last_24h > 10 ? 'warn' : 'muted'} />
        </div>
      )}

      {/* Tabs */}
      <div style={tabsRow}>
        {(['overview', 'successes', 'fails', 'sessions', 'lockouts', 'password-changes'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...tabBtn, ...(tab === t ? tabBtnOn : {}) }}>
            {t.replace('-', ' ')}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <AskGeorgeAboutThis
            label="Ask George about security"
            prompts={[
              'Is anything unusual in the last 24 hours?',
              'Which IPs have failed most?',
              'Are any active sessions from unusual locations for their admin?',
              'Have we treated similar security events consistently?',
            ]}
          />
        </div>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {/* Panels */}
      {tab === 'overview' && (
        <>
          <SectionHead title="Recent activity" hint="Newest 200 events across every category" />
          <EventsTable rows={events.slice(0, 30)} />
          <SectionHead title="Thresholds in effect" hint="Configured via backend env vars — see /app/memory/MCGS_SECURITY_MODEL.md" />
          {summary && (
            <div style={thresholdCard}>
              <ThresholdRow tier="Tier 1 · Notify" val={`${summary.thresholds.alert_after} consecutive fails`} note="Send email alert (once per window)" />
              <ThresholdRow tier="Tier 2 · Block" val={`${summary.thresholds.lockout_after} consecutive fails`} note={`Lockout ${summary.thresholds.lockout_minutes} min`} />
              <ThresholdRow tier="Tier 3 · Escalate" val={`${summary.thresholds.mass_attack_fails} fails in ${summary.thresholds.mass_attack_window_minutes} min`} note="Raise MCGS signal on The Bridge" />
              <ThresholdRow tier="Tier 4 · Urgent" val={`${summary.thresholds.mass_attack_urgent} fails in ${summary.thresholds.mass_attack_window_minutes} min`} note="Pin urgent signal + URGENT email" />
            </div>
          )}
        </>
      )}

      {(tab === 'successes' || tab === 'fails' || tab === 'password-changes') && (
        <EventsTable rows={events} />
      )}

      {tab === 'sessions' && (
        <>
          {sessions.length === 0 && <EmptyState line="No active admin sessions." />}
          {sessions.length > 0 && (
            <div style={tableWrap}>
              <table style={table}><thead><tr>
                <th style={th}>Admin</th><th style={th}>Issued</th><th style={th}>Last seen</th>
                <th style={th}>IP · Location</th><th style={th}>Device</th><th style={th}></th>
              </tr></thead><tbody>
                {sessions.map((s) => (
                  <tr key={s.jti} style={tr}>
                    <td style={td}><strong>{s.email || '—'}</strong></td>
                    <td style={td}>{fmt(s.issued_at)}</td>
                    <td style={td}>{fmt(s.last_seen_at || s.issued_at)}</td>
                    <td style={td}><code style={code}>{s.ip}</code>{s.geo && <span style={{ marginLeft: 6, color: '#64748B' }}>{[s.geo.city, s.geo.country].filter(Boolean).join(', ')}</span>}</td>
                    <td style={td}><span style={{ color: '#475569', fontSize: 12 }}>{truncate(s.user_agent, 60)}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => onRevoke(s.jti)} style={dangerBtn}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </>
      )}

      {tab === 'lockouts' && (
        <>
          {lockouts.length === 0 && <EmptyState line="No active lockouts. Good news." />}
          {lockouts.length > 0 && (
            <div style={tableWrap}>
              <table style={table}><thead><tr>
                <th style={th}>Scope</th><th style={th}>Key</th><th style={th}>Locked until</th>
                <th style={th}>Reason</th><th style={th}></th>
              </tr></thead><tbody>
                {lockouts.map((l) => (
                  <tr key={`${l.scope}:${l.key}`} style={tr}>
                    <td style={td}><span style={pill}>{l.scope}</span></td>
                    <td style={td}><code style={code}>{l.key}</code></td>
                    <td style={td}>{fmt(l.locked_until)}</td>
                    <td style={td}>{l.reason}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => onUnlock(l.scope, l.key)} style={primaryBtn}>Unlock</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'muted' }) {
  const colour = tone === 'warn' ? '#B91C1C' : tone === 'ok' ? '#0F766E' : '#64748B';
  return (
    <div style={tile}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: colour, marginTop: 4 }}>{value ?? '—'}</div>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ margin: '18px 0 8px' }}>
      <h2 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0F172A' }}>{title}</h2>
      {hint && <p style={{ margin: '2px 0 0', color: '#64748B', fontSize: 12 }}>{hint}</p>}
    </div>
  );
}

function ThresholdRow({ tier, val, note }: { tier: string; val: string; note: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #F1F5F9' }}>
      <div style={{ minWidth: 160, fontWeight: 800, color: '#0F172A', fontSize: 13 }}>{tier}</div>
      <div style={{ flex: 1, color: '#334155', fontSize: 13 }}>{val}</div>
      <div style={{ color: '#64748B', fontSize: 12 }}>{note}</div>
    </div>
  );
}

function EmptyState({ line }: { line: string }) {
  return <div style={emptyBox}>{line}</div>;
}

function EventsTable({ rows }: { rows: SecurityEvent[] }) {
  if (rows.length === 0) return <EmptyState line="No events yet in this view." />;
  return (
    <div style={tableWrap}>
      <table style={table}><thead><tr>
        <th style={th}>When</th><th style={th}>Outcome</th><th style={th}>Email</th>
        <th style={th}>IP · Location</th><th style={th}>Device</th><th style={th}>Details</th>
      </tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={r._id || i} style={tr}>
            <td style={{ ...td, whiteSpace: 'nowrap', color: '#475569', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{fmt(r.created_at)}</td>
            <td style={td}><OutcomeBadge outcome={r.outcome} /></td>
            <td style={td}><code style={code}>{r.email || '—'}</code></td>
            <td style={td}><code style={code}>{r.ip || '—'}</code>{r.geo && <span style={{ marginLeft: 6, color: '#64748B', fontSize: 12 }}>{[r.geo.city, r.geo.country].filter(Boolean).join(', ')}</span>}</td>
            <td style={td}><span style={{ color: '#475569', fontSize: 12 }}>{r.ua?.browser || '?'} · {r.ua?.os || '?'}</span></td>
            <td style={td}>{r.attempt_count != null && <span style={{ color: '#B91C1C', fontWeight: 800 }}>{r.attempt_count} fails</span>}{r.jti && <span style={{ color: '#94A3B8', marginLeft: 6, fontSize: 11 }}>jti {r.jti.slice(0, 8)}…</span>}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    success:          { bg: '#DCFCE7', fg: '#166534', label: 'Success' },
    fail:             { bg: '#FEE2E2', fg: '#991B1B', label: 'Fail' },
    lockout_created:  { bg: '#FEF3C7', fg: '#78350F', label: 'Lockout created' },
    lockout_hit:      { bg: '#FEE2E2', fg: '#991B1B', label: 'Lockout hit' },
    session_revoked:  { bg: '#E0E7FF', fg: '#3730A3', label: 'Session revoked' },
    password_change:  { bg: '#F1F5F9', fg: '#0F172A', label: 'Password changed' },
  };
  const c = cfg[outcome] || { bg: '#F1F5F9', fg: '#0F172A', label: outcome };
  return <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 800, background: c.bg, color: c.fg, borderRadius: 999 }}>{c.label}</span>;
}

function fmt(iso?: string) {
  if (!iso) return '—';
  try { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); } catch { return iso; }
}
function truncate(s?: string, n = 60) { if (!s) return '—'; return s.length > n ? s.slice(0, n) + '…' : s; }

const lede: React.CSSProperties = { color: '#475569', marginTop: -8, marginBottom: 16, maxWidth: 780 };
const tilesRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 };
const tile: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px' };
const tabsRow: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' };
const tabBtn: React.CSSProperties = { padding: '6px 12px', fontSize: 13, fontWeight: 700, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 999, cursor: 'pointer', textTransform: 'capitalize', color: '#475569' };
const tabBtnOn: React.CSSProperties = { background: '#0F3D6E', color: '#FFFFFF', borderColor: '#0F3D6E' };
const errorBox: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', padding: '10px 14px', borderRadius: 10, border: '1px solid #FCA5A5', marginBottom: 12 };
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '20px 20px', textAlign: 'center', color: '#64748B' };
const tableWrap: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, overflowX: 'auto' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', color: '#64748B', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const tr: React.CSSProperties = { borderTop: '1px solid #F1F5F9' };
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' };
const code: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };
const pill: React.CSSProperties = { padding: '2px 8px', fontSize: 11, fontWeight: 800, background: '#E0E7FF', color: '#3730A3', borderRadius: 999, textTransform: 'uppercase' };
const dangerBtn: React.CSSProperties = { padding: '6px 12px', background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '6px 12px', background: '#0F3D6E', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const thresholdCard: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12 };
