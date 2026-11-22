'use client';

/**
 * Server Health — lightweight, measured only when this page asks
 * (no background monitoring). Production runs two server copies; figures
 * are for the copy that answered, so refresh shows the other one sometimes.
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { cmsApi } from '@/lib/cms-api';

const COLORS: Record<string, string> = { ok: '#15803D', warning: '#B45309', critical: '#B91C1C' };
const LABELS: Record<string, string> = { ok: 'Healthy', warning: 'Needs attention', critical: 'Under pressure' };

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, minWidth: 180, flex: 1, background: '#fff' }}>
      <div style={{ fontSize: 13, color: '#64748B', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#0A2540', marginTop: 4 }}>{value}</div>
      {note ? <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}

const fmt = (v: any, unit = '') => (v === null || v === undefined ? 'Not available' : `${v}${unit}`);
const uptime = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

export default function ServerHealthPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setData(await cmsApi.serverHealth()); } catch (e: any) { setErr(e?.message || 'Could not load'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const m = data?.memory || {};
  const rt = data?.response_time || {};
  return (
    <AdminShell title="Server Health">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {data ? (
          <span style={{ padding: '6px 14px', borderRadius: 999, color: '#fff', fontWeight: 800, background: COLORS[data.status] || '#64748B' }}>
            {LABELS[data.status] || data.status}
          </span>
        ) : null}
        <button className="cms-btn-primary" style={s.primaryBtn} onClick={load} disabled={busy}>{busy ? 'Checking…' : 'Refresh'}</button>
        {data ? <span style={{ color: '#64748B', fontSize: 13 }}>Measured {new Date(data.measured_at).toLocaleString()}</span> : null}
      </div>
      {err ? <div style={{ color: '#B91C1C', marginBottom: 12 }}>{err}</div> : null}
      {data ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Memory" value={fmt(m.container_used_pct, '%')}
                  note={m.container_used_mb ? `${m.container_used_mb} MB of ${m.container_limit_mb ?? '?'} MB` : undefined} />
            <Tile label="CPU" value={fmt(data.cpu?.cpu_pct, '%')}
                  note={data.cpu?.cpu_limit_cores ? `of ${data.cpu.cpu_limit_cores} core(s)` : undefined} />
            <Tile label="Response time" value={fmt(rt.avg_ms, ' ms')}
                  note={rt.samples ? `typical ${rt.p50_ms} ms · slowest 5% ${rt.p95_ms} ms (last ${rt.samples} requests)` : 'No requests measured yet'} />
            <Tile label="Database" value={data.database_ok ? 'Connected' : 'Not reachable'} />
            <Tile label="Up for" value={uptime(data.uptime_seconds)} note={`since ${new Date(data.started_at).toLocaleString()}`} />
            <Tile label="Restarts (24h)" value={String(data.restarts_24h)}
                  note={m.oom_kills ? `${m.oom_kills} out-of-memory restart(s) recorded` : undefined} />
          </div>
          <h3 style={{ marginTop: 24, color: '#0A2540' }}>Recent server starts</h3>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, background: '#fff' }}>
            {(data.recent_starts || []).length ? data.recent_starts.map((r: any, i: number) => (
              <div key={i} style={{ fontSize: 14, padding: '4px 0', color: '#0A2540' }}>
                {new Date(r.started_at).toLocaleString()} <span style={{ color: '#64748B' }}>· {r.host}</span>
              </div>
            )) : <span style={{ color: '#64748B' }}>No starts recorded yet.</span>}
          </div>
          <p style={{ color: '#64748B', fontSize: 13, marginTop: 14 }}>
            FriendPlace runs on two server copies; these figures come from whichever one answered. Deployments also count as a server start.
          </p>
        </>
      ) : null}
    </AdminShell>
  );
}
