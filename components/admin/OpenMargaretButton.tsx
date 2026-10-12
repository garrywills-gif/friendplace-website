'use client';
/**
 * iter272 — "Open Margaret": opens FriendPlace as Margaret (app admin) using
 * a single-use, 60-second code issued to this authenticated MCGS session.
 * No password, no permanent link, not the public demo sign-in.
 */
import { useState } from 'react';
import { cmsApi } from '@/lib/cms-api';
import { API_BASE } from '@/lib/api-base';

export default function OpenMargaretButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    setBusy(true); setErr(null);
    // Open the tab synchronously so pop-up blockers allow it.
    const win = window.open('about:blank', '_blank');
    try {
      const { code } = await cmsApi.openMargaretCode();
      const url = `${API_BASE}/auth/handoff?code=${encodeURIComponent(code)}`;
      if (win) win.location.href = url; else window.location.href = url;
    } catch (e: any) {
      if (win) win.close();
      setErr(e?.message || 'Could not open Margaret');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        data-testid="open-margaret"
        onClick={open}
        disabled={busy}
        style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#0F766E', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Opening…' : 'Open Margaret in FriendPlace'}
      </button>
      {err && <small data-testid="open-margaret-error" style={{ color: '#B91C1C' }}>{err}</small>}
    </span>
  );
}
