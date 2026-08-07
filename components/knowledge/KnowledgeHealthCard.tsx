'use client';

/**
 * Knowledge Health card — Mission Control diagnostics.
 *
 * Shows a glanceable snapshot of George's institutional memory:
 *   • Total entries
 *   • Embedded coverage (embedded / active)
 *   • Embedding model + dim
 *   • Last embedding run timestamp
 *   • A "Re-embed everything" button for admins to trigger after a
 *     model swap or a suspected corrupted vector.
 *
 * Colour: green when embedded == active; amber if there's drift.
 *
 * Locked with Garry, 1 Aug 2026 — this card gave us "immediate
 * confidence that George's institutional memory is healthy without
 * needing to inspect the database".
 */

import { useCallback, useEffect, useState } from 'react';
import { cmsApi } from '@/lib/cms-api';

type HealthShape = Awaited<ReturnType<typeof cmsApi.knowledgeHealth>>;

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString();
}

export function KnowledgeHealthCard({
  onChange,
}: {
  /** Called after a successful re-embed so the parent can reload its data. */
  onChange?: () => void;
}) {
  const [health, setHealth] = useState<HealthShape | null>(null);
  const [busy, setBusy] = useState<'load' | 'reembed' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const h = await cmsApi.knowledgeHealth();
      setHealth(h);
    } catch (e: any) {
      setError(e?.message || 'Failed to load Knowledge Health');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-dismiss the inline message after a beat.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  async function reembed(force: boolean) {
    // Only ask for confirmation on the destructive path. A gentle
    // idempotent backfill (force=false) needs no dialog.
    if (force && !confirm('Re-embed every knowledge entry from scratch? This will replace all existing embeddings. It usually takes a few seconds.')) {
      return;
    }
    setBusy('reembed');
    setError(null);
    try {
      const r = await cmsApi.backfillKnowledgeEmbeddings({ force });
      setMessage(`✨ Embedded ${r.embedded}${r.failed > 0 ? ` (${r.failed} failed)` : ''}. Model: ${r.model} (${r.dim}-dim).`);
      await load();
      onChange?.();
    } catch (e: any) {
      setError(e?.message || 'Re-embed failed');
    } finally {
      setBusy(null);
    }
  }

  const healthy = health?.healthy ?? false;
  const accent = healthy ? '#059669' : '#D97706';

  return (
    <section
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 14,
        border: `1px solid ${healthy ? '#A7F3D0' : '#FCD34D'}`,
        background: healthy ? '#F0FDF4' : '#FFFBEB',
      }}
      aria-label="Knowledge Health"
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>{healthy ? '🟢' : '🟡'}</span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
          Knowledge Health
        </h3>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            fontWeight: 700,
            color: accent,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          {busy === 'load' ? 'checking…' : healthy ? 'healthy' : 'needs attention'}
        </span>
      </header>

      {error && (
        <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}
      {message && (
        <div style={{ color: accent, fontSize: 13, marginBottom: 10 }}>{message}</div>
      )}

      {health && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Metric label="Knowledge entries" value={String(health.total)} />
          <Metric
            label="Embedded"
            value={`${health.embedded}/${health.active}`}
            hint={`${health.embedded_pct}% of active`}
          />
          <Metric label="Embedding model" value={health.model.split('/').pop() || health.model} hint={`${health.dim}-dim`} />
          <Metric label="Last embedding run" value={formatWhen(health.last_embedding_run)} />
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => reembed(false)}
          disabled={busy !== null}
          style={secondaryBtn}
        >
          {busy === 'reembed' ? 'Embedding…' : 'Embed missing'}
        </button>
        <button
          onClick={() => reembed(true)}
          disabled={busy !== null}
          style={ghostBtn}
        >
          Re-embed everything
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid #A7F3D0',
  background: '#FFFFFF',
  color: '#065F46',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid #E2E8F0',
  background: '#FFFFFF',
  color: '#334155',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};
