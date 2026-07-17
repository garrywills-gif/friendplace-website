'use client';

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

type Props = {
  slug: string;
  isFull: boolean;
};

/**
 * Public RSVP form embedded on the event detail page.
 *
 * Design decisions:
 * - Anonymous name+email submission (no account required) — friction
 *   kills RSVPs. Confirmation email + magic-link cancel URL provide
 *   soft account-lite so users can still manage their booking.
 * - Optimistic status: we show the response's message straight away
 *   ("You're all set" or "You're on the waitlist") so users know
 *   whether they got the last spot without waiting for the email.
 * - Server does all the capacity math; the "isFull" flag just tunes
 *   the CTA label from "RSVP" to "Join waitlist".
 */
export default function RsvpForm({ slug, isFull }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [guests, setGuests] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | { ok: true; message: string; status: string } | { ok: false; error: string }>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !email.trim()) {
      setResult({ ok: false, error: 'Please add your name and email.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE}/api/public/events/${encodeURIComponent(slug)}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          guests_count: Number(guests) || 0,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: data?.detail || `Something went wrong (${res.status}).` });
      } else {
        setResult({ ok: true, message: data.message || "You're in!", status: data.rsvp?.status || 'going' });
      }
    } catch (err) {
      setResult({ ok: false, error: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  // Success-state card replaces the form so users don't accidentally
  // re-submit.
  if (result && result.ok) {
    const going = result.status === 'going';
    return (
      <div
        role="status"
        style={{
          padding: 20, borderRadius: 14,
          background: going ? '#DCFCE7' : '#FEF3C7',
          border: `1px solid ${going ? '#86EFAC' : '#FDE68A'}`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>{going ? '🎉' : '💜'}</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: going ? '#166534' : '#92400E', marginBottom: 6 }}>
          {going ? "You're in!" : "You're on the waitlist"}
        </div>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
          {result.message}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <label style={labelStyle}>Your name</label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="First and last"
        required
        autoComplete="name"
        style={inputStyle}
      />

      <label style={labelStyle}>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
        style={inputStyle}
      />

      <label style={labelStyle}>Bringing anyone?</label>
      <select
        value={guests}
        onChange={(e) => setGuests(Number(e.target.value))}
        style={{ ...inputStyle, appearance: 'auto' }}
      >
        <option value={0}>Just me</option>
        <option value={1}>+1 guest</option>
        <option value={2}>+2 guests</option>
        <option value={3}>+3 guests</option>
      </select>

      <label style={labelStyle}>Message (optional)</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything the host should know?"
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
      />

      {result && !result.ok && (
        <div style={{ marginTop: 4, marginBottom: 12, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 10, fontSize: 13 }}>
          {result.error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          width: '100%', padding: '14px 20px', borderRadius: 12, border: 'none',
          background: submitting ? '#94A3B8' : (isFull ? '#F59E0B' : '#0A2540'),
          color: '#FFFFFF', fontWeight: 900, fontSize: 15, cursor: submitting ? 'default' : 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        {submitting ? 'Saving…' : (isFull ? 'Join the waitlist' : "I'm in — RSVP")}
      </button>

      <div style={{ marginTop: 12, fontSize: 11, color: '#64748B', textAlign: 'center', lineHeight: 1.5 }}>
        We&rsquo;ll email your confirmation + calendar invite.
        <br />
        No spam, promise.
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '0.14em',
  color: '#64748B',
  fontWeight: 800,
  textTransform: 'uppercase',
  marginBottom: 6,
  marginTop: 12,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #CBD5E1',
  fontSize: 15,
  fontFamily: 'inherit',
  color: '#0A2540',
  background: '#FFFFFF',
  outline: 'none',
  boxSizing: 'border-box',
};
