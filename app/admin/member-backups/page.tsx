'use client';
/**
 * Member Backups (iter274) — daily encrypted backups of the Founding Member
 * register + app member FMN links, kept outside the live database.
 * Admin-only (MCGS session). Backing up never changes any member record.
 */
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { cmsApi, downloadMemberBackup } from '@/lib/cms-api';

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function MemberBackupsPage() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await cmsApi.memberBackups()); setErr(null); } catch (e: any) { setErr(e?.message || 'Could not load backups'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const backUpNow = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await cmsApi.memberBackupNow();
      if (r.status === 'ok') setMsg('Backup completed and verified.');
      else setErr(`Backup failed: ${r.error || 'unknown error'}`);
      await load();
    } catch (e: any) { setErr(e?.message || 'Backup failed'); }
    finally { setBusy(false); }
  };

  const last = data?.last_successful;
  const c = last?.counts || {};
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 18, marginBottom: 16 };

  return (
    <AdminShell title="Member Backups">
      <p style={{ color: '#475569', marginTop: 0 }}>
        Every day the Founding Member register (names, emails, numbers, reservations, claims and counters) and each app
        member&apos;s Founding Member link are backed up, encrypted, and stored outside the live database. We keep the last
        30 daily and 12 weekly backups. Backing up never changes any member record or number.
      </p>

      {data?.alert && (
        <div data-testid="backup-alert" style={{ ...card, background: '#FEF2F2', borderColor: '#FECACA', color: '#7F1D1D' }}>
          {data.latest?.status === 'failed' && <div>⚠️ The most recent backup failed{data.latest?.error ? `: ${data.latest.error}` : ''}. Tap <b>Back Up Now</b> to retry.</div>}
          {data.key && !data.key.dedicated && <div>⚠️ The dedicated backup encryption key isn&apos;t set on the server, so backups can&apos;t run.</div>}
          {data.storage?.warning && <div>⚠️ Backup storage is getting large. Please let Neo know.</div>}
        </div>
      )}
      {err && <div data-testid="backup-error" style={{ ...card, background: '#FEF2F2', borderColor: '#FECACA', color: '#7F1D1D' }}>{err}</div>}
      {msg && <div data-testid="backup-msg" style={{ ...card, background: '#F0FDF4', borderColor: '#BBF7D0', color: '#065F46' }}>{msg}</div>}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, color: '#64748B' }}>Last successful backup</div>
            <div data-testid="backup-last" style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{last ? fmt(last.created_at) : 'None yet'}</div>
          </div>
          <button data-testid="backup-now" onClick={backUpNow} disabled={busy}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: '#0F766E', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Backing up…' : 'Back Up Now'}
          </button>
        </div>
        {last && (
          <div data-testid="backup-counts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 10, marginTop: 14 }}>
            {[
              ['Founding Member registrations', c.interest_registrations],
              ['… with a number', c.registrations_with_fmn],
              ['… without a number', c.registrations_without_fmn],
              ['FMN counter', c.fmn_counter_value],
              ['Reserved slots', c.founder_reserved_slots],
              ['Email claims', c.founder_email_claims],
              ['App member accounts', c.users],
              ['App members with FMN', c.app_members_with_fmn],
            ].map(([k, v]) => (
              <div key={k as string} style={{ background: '#F8FAFC', borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: '#64748B' }}>{k}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{v ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
        <div data-testid="backup-status" style={{ marginTop: 14, fontSize: 13, color: '#475569', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <span>Encryption key: {data?.key?.dedicated ? <b style={{ color: '#065F46' }}>Dedicated ✓ ({data.key.key_id})</b> : <b style={{ color: '#B91C1C' }}>Not set</b>}</span>
          <span>Storage used: <b>{data?.storage ? `${(data.storage.bytes / 1048576).toFixed(2)} MB` : '—'}</b> in {data?.storage?.files ?? 0} files</span>
          <span>Projected in 12 months: <b>{data?.storage ? `${(data.storage.projected_12m_bytes / 1048576).toFixed(1)} MB` : '—'}</b></span>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 10, color: '#0F172A' }}>Backup history</div>
        <table data-testid="backup-history" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748B' }}>
              <th style={{ padding: 6 }}>When</th><th style={{ padding: 6 }}>Type</th><th style={{ padding: 6 }}>Status</th>
              <th style={{ padding: 6 }}>Registrations</th><th style={{ padding: 6 }}>Members</th><th style={{ padding: 6 }} />
            </tr>
          </thead>
          <tbody>
            {(data?.history || []).map((b: any) => (
              <tr key={b.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: 6 }}>{fmt(b.created_at)}</td>
                <td style={{ padding: 6 }}>{b.trigger === 'manual' ? 'Manual' : b.weekly ? 'Daily + weekly' : 'Daily'}</td>
                <td style={{ padding: 6, color: b.status === 'ok' ? '#065F46' : b.status === 'failed' ? '#B91C1C' : '#78350F' }}>
                  {b.status === 'ok' ? 'Verified ✓' : b.status === 'failed' ? 'Failed' : 'Running'}
                </td>
                <td style={{ padding: 6 }}>{b.counts?.interest_registrations ?? '—'}</td>
                <td style={{ padding: 6 }}>{b.counts?.users ?? '—'}</td>
                <td style={{ padding: 6 }}>
                  {b.status === 'ok' && (
                    <button data-testid={`backup-download-${b.id}`}
                      onClick={() => downloadMemberBackup(b.id, `friendplace-member-backup-${b.local_date}-${b.id.slice(0, 8)}.json`).catch((e) => setErr(e.message))}
                      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer' }}>
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && !(data.history || []).length && (
              <tr><td colSpan={6} style={{ padding: 10, color: '#64748B' }}>No backups yet — the first automatic backup runs after 2am, or tap Back Up Now.</td></tr>
            )}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 0 }}>
          Downloads contain member names and emails — store them securely. Restore steps: see RESTORE_MEMBER_BACKUPS.md.
        </p>
      </div>
    </AdminShell>
  );
}
