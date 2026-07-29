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
import { API_BASE } from '@/lib/api-base';

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
      // Phase-C endpoint: persists to `interest_registrations` and
      // sends a warm, in-voice confirmation email signed by the
      // chosen companion. Any non-2xx surfaces as a friendly error;
      // the DB write itself is the source of truth so an email
      // failure never punishes the visitor.
      const res = await fetch(`${API_BASE}/api/public/register-interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          email: email.trim().toLowerCase(),
          state_country: location.trim() || null,
          heard_from: heardFrom.trim() || null,
          companion_choice: companion,
        }),
      });

      if (!res.ok) {
        let msg = '';
        try {
          const body = await res.json();
          msg = typeof body?.detail === 'string' ? body.detail : '';
        } catch {
          msg = '';
        }
        // 429 = rate-limited (five per hour per IP). We soften the
        // wording so it still feels like a person, not a server.
        if (res.status === 429) {
          setError('It looks like a few of you might be registering from the same place \u2014 give it a moment and try again.');
        } else {
          setError(msg || "Something went wrong on our side \u2014 could you try again in a moment?");
        }
        return;
      }
      setDone(true);
    } catch (err) {
      console.error('[ryi] submit failed', err);
      // Network hiccup on the visitor's side \u2014 don't punish them
      // for it; the retry is just a tap away.
      setError("Your internet seems a little slow. Could you try again?");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const signOff = meta?.emailSignatureName || 'George';
    return (
      <div style={pageBg}>
        <div className="container" style={{ paddingTop: 72, paddingBottom: 96 }}>
          <div style={plate}>
            <h1 style={openingLine}>Thank you, {firstName.trim() || 'friend'}.</h1>
            <p style={leadCopy}>
              I&rsquo;m really glad you stopped by.
            </p>
            <p style={{ ...leadCopy, marginTop: 12 }}>
              You&rsquo;re on the list now, and I&rsquo;ll make sure you&rsquo;re
              one of the first to hear when FriendPlace is ready.
            </p>
            <p style={{ ...leadCopy, marginTop: 12 }}>
              Until then, take care.
            </p>
            <p style={{ ...leadCopy, marginTop: 24, fontStyle: 'italic', color: '#0F766E' }}>
              <span aria-hidden style={{ fontSize: 22, verticalAlign: '-3px', marginRight: 6 }}>&#129419;</span>
              {signOff}
            </p>
            <div style={{ marginTop: 32 }}>
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
