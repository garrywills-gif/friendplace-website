'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cmsApi } from '@/lib/cms-api';
import { setToken, setAdmin } from '@/lib/cms-auth';
import { AuthShell, authStyles as s } from '@/components/admin/AuthShell';

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await cmsApi.setupRequired();
        if (!r.setup_required) {
          router.replace('/admin/login');
          return;
        }
      } catch { /* network hiccup — fall through to setup form */ }
      setChecking(false);
    })();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await cmsApi.setup({
        email: email.trim(),
        password,
        display_name: displayName.trim() || undefined,
      });
      setToken(res.token);
      setAdmin(res.admin);
      router.replace('/admin/bridge');
    } catch (e: any) {
      setError(e?.message || 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <AuthShell title="Checking…">
        <p style={{ color: '#64748B' }}>Contacting the API…</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your admin account"
      subtitle="This is the very first admin. After you finish, this setup page will be permanently locked and only login will work."
    >
      {error && <div style={s.errorBox}>{error}</div>}
      <form onSubmit={submit}>
        <label style={s.label}>Your name</label>
        <input className="cms-input" style={s.input} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Garry" autoComplete="name" />
        <div style={{ height: 14 }} />
        <label style={s.label}>Email</label>
        <input className="cms-input" style={s.input} value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" />
        <div style={{ height: 14 }} />
        <label style={s.label}>Password (min 8 characters)</label>
        <input className="cms-input" style={s.input} value={password} onChange={e => setPassword(e.target.value)} type="password" required autoComplete="new-password" />
        <div style={{ height: 14 }} />
        <label style={s.label}>Confirm password</label>
        <input className="cms-input" style={s.input} value={confirm} onChange={e => setConfirm(e.target.value)} type="password" required autoComplete="new-password" />
        <div style={{ height: 24 }} />
        <button type="submit" className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: busy ? 0.65 : 1 }} disabled={busy}>
          {busy ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <Link href="/admin/login" style={s.ghostLink}>I already have an account →</Link>
      </div>
    </AuthShell>
  );
}
