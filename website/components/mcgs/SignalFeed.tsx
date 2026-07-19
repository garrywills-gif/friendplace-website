'use client';

import { useEffect, useMemo, useState } from 'react';
import { mcgsApi, subscribeToBridge, type Case, type Priority } from '@/lib/mcgs-api';
import { SignalCard } from './SignalCard';

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const OPEN_STATUSES = ['NEW', 'SEEN', 'IN_REVIEW', 'SNOOZED', 'ESCALATED'];

export function SignalFeed() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | Priority>('all');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { items } = await mcgsApi.listCases({ limit: 100, status: OPEN_STATUSES });
        if (alive) { setCases(items); setLoading(false); }
      } catch (err) {
        console.error(err);
        if (alive) setLoading(false);
      }
    })();

    // Live updates via SSE (channel-agnostic Signal bus).
    const unsub = subscribeToBridge((ev) => {
      // For Phase 1 we do a light refetch on any signal/case event.
      // Later we'll patch in-place from the event payload.
      if (ev.type.startsWith('signal.') || ev.type.startsWith('case.')) {
        mcgsApi.listCases({ limit: 100, status: OPEN_STATUSES })
          .then(({ items }) => alive && setCases(items))
          .catch(() => { /* ignore transient errors */ });
      }
    });

    return () => { alive = false; unsub(); };
  }, []);

  const filtered = useMemo(() => {
    const list = filter === 'all' ? cases : cases.filter(c => c.priority === filter);
    return [...list].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.last_signal_at).getTime() - new Date(a.last_signal_at).getTime();
    });
  }, [cases, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginRight: 8 }}>
          Signal Feed
        </div>
        {(['all', 'P0', 'P1', 'P2', 'P3', 'P4'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: filter === f ? '#0F172A' : '#FFFFFF',
              color: filter === f ? '#FFFFFF' : '#334155',
              border: '1px solid ' + (filter === f ? '#0F172A' : '#E2E8F0'),
              cursor: 'pointer',
            }}
          >{f === 'all' ? 'All' : f}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8' }}>
          {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'case' : 'cases'}`}
        </span>
      </div>

      {loading ? (
        <div style={{
          padding: 40, textAlign: 'center', color: '#64748B',
          background: '#FFFFFF', borderRadius: 12, border: '1px solid #E2E8F0',
        }}>Loading signals…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center',
          background: '#F0FDFA', borderRadius: 16, border: '1px solid #CCFBF1',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🌿</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F766E', marginBottom: 4 }}>
            Nothing needs you right now.
          </div>
          <div style={{ fontSize: 14, color: '#64748B' }}>Nicely done.</div>
        </div>
      ) : (
        filtered.map(c => (
          <SignalCard
            key={c.id}
            case_={c}
            onChanged={(u) => setCases(prev => prev.map(x => x.id === u.id ? u : x))}
          />
        ))
      )}
    </div>
  );
}
