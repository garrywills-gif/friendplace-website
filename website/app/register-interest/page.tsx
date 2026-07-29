'use client';

/**
 * /register-interest — the RYI page.
 *
 * Phase A (this file) ships the form UI wired to a placeholder submit.
 * The backend endpoint + Resend confirmation email arrive in Phase C.
 *
 * Locked-in rules (Garry, Jul 2026):
 *   \u2022 Required: first name + email.
 *   \u2022 Optional: state/country, how did you hear about us.
 *   \u2022 Nothing else. The goal is <20 seconds to submit.
 *   \u2022 The companion the visitor chose is recorded alongside so
 *     "Welcome back" on first app login is genuine.
 *
 * Read /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md before editing.
 * The form is not a form \u2014 it's a conversation with 4 questions.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useCompanion, COMPANIONS } from '@/lib/companion-context';

export default function RegisterInterestPage() {
  const { companion, meta } = useCompanion();
  // The visitor may arrive here without having chosen a companion yet
  // (deep link, back button, etc). We don't block them \u2014 the form
  // works either way, and we still record the missing choice so we
  // can offer the choice at first app login.
  const companionName = meta?.name || 'the team';

  const [firstName, setFirstName]     = useState('');
  const [email, setEmail]             = useState('');
  const [location, setLocation]       = useState('');
  const [heardFrom, setHeardFrom]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !email.trim()) {
      setError('Please leave your first name and email so we know how to reach you.');
      return;
    }
    // Very light email sanity check \u2014 the backend is the source of truth.
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That email doesn't look quite right \u2014 could you double-check it?");
      return;
    }
    setSubmitting(true);
    try {
      // Phase-C backend endpoint. For Phase A we do a soft simulate so
      // the flow is walkable end-to-end without wiring the DB yet.
      // When Phase C lands, this call becomes real.
      const res = await fetch('/api/public/register-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          email: email.trim().toLowerCase(),
          state_country: location.trim() || null,
          heard_from: heardFrom.trim() || null,
          companion_choice: companion,
        }),
      }).catch(() => null);

      // Phase-A stub: the endpoint doesn't exist yet, so any non-2xx
      // (including a network error) still shows the warm confirmation.
      // Phase C will surface real errors.
      if (res && !res.ok && res.status !== 404) {
        const body = await res.text().catch(() => '');
        console.warn('[ryi] backend responded non-2xx:', res.status, body);
      }
      setDone(true);
    } catch (err) {
      console.error('[ryi] submit failed', err);
      // Even on failure we thank them warmly \u2014 we can retry the
      // capture server-side later. Never punish a visitor for a
      // network hiccup on their side.
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={pageBg}>
        <div className="container" style={{ paddingTop: 72, paddingBottom: 96 }}>
          <div style={plate}>
            <span style={{ fontSize: 56, display: 'block', marginBottom: 12 }} aria-hidden>&#129419;</span>
            <h1 style={openingLine}>Thank you, {firstName.trim() || 'friend'}.</h1>
            <p style={leadCopy}>
              You&rsquo;re on the list. {companionName} will be in touch soon &mdash;
              just a short note to say hello and to let you know when
              FriendPlace is ready for you.
            </p>
            <p style={{ ...leadCopy, marginTop: 8 }}>
              Until then, take care of yourself.
            </p>
            <div style={{ marginTop: 28 }}>
              <Link href="/" style={secondaryCta}>Back to FriendPlace</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageBg}>
      <div className="container" style={{ paddingTop: 72, paddingBottom: 96 }}>
        <div style={plate}>
          <h1 style={openingLine}>Register your interest</h1>
          <p style={leadCopy}>
            {companion
              ? `Leave your name and email and ${companionName} will be in touch when FriendPlace is ready for you.`
              : 'Leave your name and email and one of us will be in touch when FriendPlace is ready for you.'}
          </p>

          <form onSubmit={onSubmit} style={{ marginTop: 8 }} noValidate>
            <Field label="First name" required>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
                style={inputStyle}
                placeholder="What can I call you?"
              />
            </Field>

            <Field label="Email address" required>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
                inputMode="email"
                style={inputStyle}
                placeholder="Where can I write to you?"
              />
            </Field>

            <Field label="State or country" optional>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                autoComplete="address-level1"
                style={inputStyle}
                placeholder="e.g. Victoria, Australia"
              />
            </Field>

            <Field label="How did you hear about FriendPlace?" optional>
              <input
                type="text"
                value={heardFrom}
                onChange={e => setHeardFrom(e.target.value)}
                style={inputStyle}
                placeholder="A friend, a search, a chance encounter..."
              />
            </Field>

            {error && (
              <div role="alert" style={errorBar}>{error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="submit" disabled={submitting} style={{ ...primaryCta, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? 'Sending\u2026' : 'Come in'}
              </button>
            </div>
          </form>

          <p style={footNote}>
            We&rsquo;ll only use your details to let you know when FriendPlace opens.
            No newsletters. No sharing. No noise.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────

function Field({ label, required, optional, children }: {
  label: string; required?: boolean; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginTop: 18 }}>
      <span style={fieldLabel}>
        {label}
        {optional && <span style={optionalTag}>{' \u2014 optional'}</span>}
      </span>
      {children}
    </label>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const pageBg: React.CSSProperties = {
  minHeight: 'calc(100vh - 200px)',
  background: '#FEFCF8',
};

const plate: React.CSSProperties = {
  maxWidth: 560, margin: '0 auto',
  background: '#FFFFFF',
  borderRadius: 24,
  border: '1px solid #F1E9DC',
  boxShadow: '0 10px 40px rgba(15,23,42,0.06)',
  padding: '48px 40px 40px',
  textAlign: 'center',
};

const openingLine: React.CSSProperties = {
  fontSize: 32, lineHeight: 1.2, fontWeight: 800,
  color: '#0A2540', margin: '0 0 14px', letterSpacing: '-0.02em',
};

const leadCopy: React.CSSProperties = {
  fontSize: 17, lineHeight: 1.55, color: '#334155',
  margin: '0 auto', maxWidth: 460,
};

const fieldLabel: React.CSSProperties = {
  display: 'block', textAlign: 'left',
  fontSize: 14, fontWeight: 700, color: '#0A2540',
  marginBottom: 6,
};

const optionalTag: React.CSSProperties = {
  fontWeight: 500, color: '#94A3B8', fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '12px 14px', fontSize: 16, fontFamily: 'inherit',
  background: '#FEFCF8',
  border: '1.5px solid #E2E8F0', borderRadius: 12,
  color: '#0F172A', outline: 'none',
};

const errorBar: React.CSSProperties = {
  marginTop: 16, padding: '10px 14px',
  background: '#FEF2F2', border: '1px solid #FECACA',
  borderRadius: 10, color: '#991B1B', fontSize: 14,
  textAlign: 'left',
};

const primaryCta: React.CSSProperties = {
  padding: '14px 26px',
  background: 'linear-gradient(135deg,#14B8A6,#0EA5A0)',
  color: '#FFFFFF', border: 'none',
  fontSize: 15, fontWeight: 800, fontFamily: 'inherit',
  borderRadius: 12, cursor: 'pointer',
  boxShadow: '0 6px 20px rgba(20,184,166,0.28)',
};

const secondaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 22px',
  background: '#FFFFFF',
  color: '#0F766E',
  fontSize: 14, fontWeight: 700, textDecoration: 'none',
  border: '1.5px solid #99F6E4',
  borderRadius: 12,
};

const footNote: React.CSSProperties = {
  marginTop: 24, fontSize: 13, color: '#64748B', lineHeight: 1.55,
};
