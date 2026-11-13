'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import { API_BASE } from '@/lib/api-base';

const APPLE_STORE = 'https://apps.apple.com/au/app/id6796969555';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=au.com.friendplace.app';

export default function InviteEmailStep({ code }: { code: string }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function saveIntent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const normalised = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalised)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/invite/referral-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email: normalised }),
      });
      if (response.status === 429) {
        setError('Too many attempts. Please try again in a little while.');
      } else if (!response.ok) {
        setError('We couldn\'t save your invitation just now. Please try again.');
      } else {
        // Deliberately generic: do not reveal whether the code or account exists.
        setSubmitted(true);
      }
    } catch {
      setError('We couldn\'t connect just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Download FriendPlace" style={{ marginTop: 30 }}>
      {!submitted ? (
        <form onSubmit={saveIntent} style={{ textAlign: 'left', maxWidth: 440, margin: '0 auto' }}>
          <label htmlFor="invite-email" style={{ display: 'block', fontWeight: 750, fontSize: 16, marginBottom: 8 }}>
            What email will you use to join FriendPlace?
          </label>
          <p style={{ color: '#50637A', fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}>
            Enter the email you will use in the app so we can recognise your invitation.
            This step does not create an account or send you an email.
          </p>
          <input
            id="invite-email" name="email" type="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" required maxLength={254}
            style={{
              boxSizing: 'border-box', width: '100%', padding: '14px 15px',
              border: '1px solid #A8BBC9', borderRadius: 10, fontSize: 16,
              color: '#102A4E', background: 'white',
            }}
          />
          {error && <p role="alert" style={{ color: '#A42424', fontSize: 14, margin: '10px 0' }}>{error}</p>}
          <button type="submit" disabled={busy}
            style={{ ...primaryStyle, marginTop: 14, width: '100%', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Saving invitation…' : 'Continue to download'}
          </button>
        </form>
      ) : (
        <div aria-live="polite">
          <p style={{ fontSize: 17, fontWeight: 750, margin: '0 0 8px' }}>Your next step: get the free app!</p>
          <p style={{ color: '#50637A', lineHeight: 1.5, fontSize: 14, margin: '0 0 18px' }}>
            Sign up with the same email address you just entered and verify it in FriendPlace.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
            <a href={APPLE_STORE} rel="noopener noreferrer" style={primaryStyle}>Download for iPhone or iPad</a>
            <a href={GOOGLE_PLAY} rel="noopener noreferrer" style={primaryStyle}>Get it on Google Play</a>
          </div>
          <p style={{ fontSize: 13, color: '#50637A', margin: '18px 0 0' }}>
            Using Apple Hide My Email? For the invitation to match, sign up with the same email you entered above.
          </p>
        </div>
      )}
    </section>
  );
}

const primaryStyle: CSSProperties = {
  display: 'inline-block', padding: '15px 20px', border: 0, borderRadius: 12,
  background: '#122F65', color: '#FFF', fontWeight: 700,
  fontSize: 15, textDecoration: 'none', textAlign: 'center',
};
