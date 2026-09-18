'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { outreachApi, type OutreachOrg } from '@/lib/cms-api';
import { outreachArchiveApi, type OutreachListResponse } from '@/lib/outreach-archive-api';

function rowsFrom(result: OutreachListResponse): OutreachOrg[] {
  return result.rows || result.organisations || [];
}

function isRotary(o: OutreachOrg) {
  const name = (o.organisation_name || '').toLowerCase();
  const cat = (o.category || '').toLowerCase();
  return name.includes('rotary') || cat === 'rotary_club' || cat === 'rotary_clubs';
}

function payloadFor(o: OutreachOrg) {
  return {
    organisation_name: o.organisation_name,
    email: o.email,
    contact_name: o.contact_name || '',
    phone: o.phone || '',
    category: 'rotary_clubs',
    tags: Array.from(new Set([...(o.tags || []), 'rotary_clubs'])),
    suburb: o.suburb || '',
    state: o.state || '',
    notes: o.notes || '',
    status: o.status || 'not_contacted',
  };
}

export default function RepairRotaryPage() {
  const [active, setActive] = useState<OutreachOrg[]>([]);
  const [archived, setArchived] = useState<OutreachOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [a, ar] = await Promise.all([
        outreachArchiveApi.listActive({ limit: 2000 }),
        outreachArchiveApi.list({ limit: 2000 }),
      ]);
      setActive(rowsFrom(a));
      setArchived(rowsFrom(ar));
    } catch (e: any) {
      setError(e?.message || 'Could not load outreach records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activeRotary = useMemo(() => active.filter(isRotary), [active]);
  const archivedRotary = useMemo(() => archived.filter(isRotary), [archived]);
  const total = activeRotary.length + archivedRotary.length;

  const repair = async () => {
    if (!total || busy) return;
    const ok = window.confirm(
      `Move ${total} Rotary organisation${total === 1 ? '' : 's'} into the Rotary Clubs group and restore any archived ones?`,
    );
    if (!ok) return;

    setBusy(true);
    setError('');
    setMessage('');
    let moved = 0;
    let restored = 0;

    try {
      for (const org of activeRotary) {
        if ((org.category || '') !== 'rotary_clubs') {
          await outreachApi.update(org.id, payloadFor(org));
        }
        moved += 1;
      }

      for (const org of archivedRotary) {
        await outreachApi.update(org.id, payloadFor(org));
        await outreachArchiveApi.restore(org.id);
        moved += 1;
        restored += 1;
      }

      setMessage(`Done — ${moved} Rotary organisations are now in Rotary Clubs${restored ? ` · ${restored} restored from archive` : ''}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'The Rotary repair stopped before it finished.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Repair Rotary contacts">
      <div style={{ maxWidth: 760 }}>
        <Link href="/admin/outreach" style={{ color: '#0F766E', fontWeight: 800, textDecoration: 'none' }}>
          ← Back to Organisation Outreach
        </Link>

        <div style={{ marginTop: 18, background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 20 }}>
          <h3 style={{ margin: 0, color: '#0A2540' }}>Rotary cleanup</h3>
          <p style={{ color: '#475569', lineHeight: 1.6 }}>
            This finds Rotary records in both Active and Archived, assigns them to <strong>Rotary Clubs</strong>, and restores any archived Rotary records.
          </p>

          {loading ? (
            <p style={{ color: '#64748B' }}>Checking records…</p>
          ) : (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
              <strong>{activeRotary.length} active Rotary</strong>
              <strong>{archivedRotary.length} archived Rotary</strong>
              <strong>{total} total</strong>
            </div>
          )}

          {error && <div style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 10, padding: 12, marginBottom: 14 }}>{error}</div>}
          {message && <div style={{ background: '#ECFDF5', color: '#047857', borderRadius: 10, padding: 12, marginBottom: 14, fontWeight: 800 }}>{message}</div>}

          <button
            type="button"
            onClick={() => void repair()}
            disabled={loading || busy || total === 0}
            style={{ ...adminStyles.primaryBtn, opacity: loading || busy || total === 0 ? 0.55 : 1 }}
          >
            {busy ? 'Repairing…' : `Move ${total} to Rotary Clubs`}
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
