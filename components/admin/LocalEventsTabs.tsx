'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hostedSectionApi } from '@/lib/cms-api';

export function LocalEventsTabs({ active }: { active: 'member' | 'hosted' }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (active !== 'hosted') return;
    hostedSectionApi.get().then(r => setEnabled(r.enabled)).catch(() => setEnabled(null));
  }, [active]);
  const toggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    const msg = next
      ? 'Turn ON the "Hosted by FriendPlace" section? It will show in the app and on the website /events page.'
      : 'Turn OFF the "Hosted by FriendPlace" section? It will be hidden in the app and on the website /events page. No events are deleted.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try { setEnabled((await hostedSectionApi.set(next)).enabled); }
    catch (e: any) { window.alert(e?.message || 'Could not update'); }
    finally { setBusy(false); }
  };
  const tab = (key: 'member' | 'hosted', href: string, label: string) => (
    <Link href={href} data-testid={`local-events-tab-${key}`} style={{
      padding: '10px 16px', borderRadius: 999, fontSize: 14, fontWeight: 800, textDecoration: 'none',
      border: active === key ? '1px solid #0A2540' : '1px solid #CBD5E1',
      background: active === key ? '#0A2540' : '#FFFFFF',
      color: active === key ? '#FFFFFF' : '#0A2540',
    }}>{label}</Link>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: -8, marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tab('member', '/admin/local-events', 'Member events')}
        {tab('hosted', '/admin/events', 'Hosted by FriendPlace')}
      </div>
      {active === 'hosted' && enabled !== null && (
        <button data-testid="hosted-section-toggle" onClick={toggle} disabled={busy} aria-pressed={enabled} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 999,
          border: '1px solid #CBD5E1', background: '#FFFFFF', cursor: busy ? 'default' : 'pointer',
          fontSize: 14, fontWeight: 800, color: '#0A2540',
        }}>
          <span>“Hosted by FriendPlace” section</span>
          <span style={{
            padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 900,
            background: enabled ? '#0D9488' : '#E2E8F0', color: enabled ? '#FFFFFF' : '#475569',
          }}>{enabled ? 'ON' : 'OFF'}</span>
        </button>
      )}
    </div>
  );
}
