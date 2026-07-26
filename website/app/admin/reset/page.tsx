'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cmsApi } from '@/lib/cms-api';
import { setToken } from '@/lib/cms-auth';
import { AuthShell, authStyles as s } from '@/components/admin/AuthShell';

function ResetForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) { setError('Missing reset token. Please request a new email.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await cmsApi.reset(token, password);
      setToken(res.token);
      router.replace('/admin/bridge');
    } catch (e: any) {
      setError(e?.message || 'Reset failed. The link may have expired.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Set a new password" subtitle="Choose a fresh strong password (at least 8 characters).">
      {error && <div style={s.errorBox}>{error}</div>}
      <form onSubmit={submit}>
        <label style={s.label}>New password</label>
        <input className="cms-input" style={s.input} value={password} onChange={e => setPassword(e.target.value)} type="password" required autoComplete="new-password" />
        <div style={{ height: 14 }} />
        <label style={s.label}>Confirm password</label>
        <input className="cms-input" style={s.input} value={confirm} onChange={e => setConfirm(e.target.value)} type="password" required autoComplete="new-password" />
        <div style={{ height: 24 }} />
        <button type="submit" className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: busy ? 0.65 : 1 }} disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Link href="/admin/login" style={s.ghostLink}>← Back to sign in</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<AuthShell title="Loading…"><div /></AuthShell>}>
      <ResetForm />
    </Suspense>
  );
}
