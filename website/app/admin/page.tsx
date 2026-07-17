'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cmsApi } from '@/lib/cms-api';
import { isAuthed } from '@/lib/cms-auth';

/**
 * /admin — the front door. Routes to setup, login, or dashboard based
 * on backend + local state.
 */
export default function AdminIndexPage() {
  const router = useRouter();
  const [msg, setMsg] = useState('Loading admin…');

  useEffect(() => {
    (async () => {
      try {
        if (isAuthed()) {
          // Optimistic: try /me — if it fails the api client clears the token.
          try {
            await cmsApi.me();
            router.replace('/admin/dashboard');
            return;
          } catch {
            /* fall through to setup/login decision */
          }
        }
        const s = await cmsApi.setupRequired();
        router.replace(s.setup_required ? '/admin/setup' : '/admin/login');
      } catch (e: any) {
        setMsg(`Unable to reach the admin API. ${e?.message || ''}`);
      }
    })();
  }, [router]);

  return (
    <div style={pageWrap}>
      <p style={{ color: '#64748B' }}>{msg}</p>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#F8FAFC',
  fontFamily: 'Public Sans, system-ui, sans-serif',
};
