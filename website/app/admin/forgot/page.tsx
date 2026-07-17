'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cmsApi } from '@/lib/cms-api';
import { AuthShell, authStyles as s } from '@/components/admin/AuthShell';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await cmsApi.forgot(email.trim());
      setSent(true);
    } catch (e: any) {
      setError(e?.message || 'Could not send reset email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to set a new password. The link expires in 30 minutes.">
      {error && <div style={s.errorBox}>{error}</div>}
      {sent ? (
        <div style={s.successBox}>
          If an admin with that email exists, we&apos;ve sent a reset link. Check your inbox (and your spam folder just in case).
          <div style={{ marginTop: 12 }}>
            <Link href="/admin/login" style={s.ghostLink}>← Back to sign in</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label style={s.label}>Your admin email</label>
          <input style={s.input} value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" />
          <div style={{ height: 24 }} />
          <button type="submit" style={{ ...s.primaryBtn, opacity: busy ? 0.65 : 1 }} disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <Link href="/admin/login" style={s.ghostLink}>← Back to sign in</Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
