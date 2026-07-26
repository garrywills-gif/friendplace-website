'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cmsApi } from '@/lib/cms-api';
import { setToken, setAdmin } from '@/lib/cms-auth';
import { AuthShell, authStyles as s } from '@/components/admin/AuthShell';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await cmsApi.login({ email: email.trim(), password });
      setToken(res.token);
      setAdmin(res.admin);
      router.replace('/admin/dashboard');
    } catch (e: any) {
      setError(e?.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to edit the FriendPlace website.">
      {error && <div style={s.errorBox}>{error}</div>}
      <form onSubmit={submit}>
        <label style={s.label}>Email</label>
        <input className="cms-input" style={s.input} value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" />
        <div style={{ height: 14 }} />
        <label style={s.label}>Password</label>
        <input className="cms-input" style={s.input} value={password} onChange={e => setPassword(e.target.value)} type="password" required autoComplete="current-password" />
        <div style={{ height: 24 }} />
        <button type="submit" className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: busy ? 0.65 : 1 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <Link href="/admin/forgot" style={s.ghostLink}>Forgot your password?</Link>
      </div>
    </AuthShell>
  );
}
