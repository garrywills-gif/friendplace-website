'use client';

import { useState } from 'react';
import { submitContact } from '@/lib/api';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('general');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    setErr('');
    const r = await submitContact({ name, email, reason, message });
    if (r.ok) {
      setState('sent');
      setName(''); setEmail(''); setReason('general'); setMessage('');
    } else {
      setState('error');
      setErr(r.error || 'Something went wrong');
    }
  };

  if (state === 'sent') {
    return (
      <div style={{
        background: '#F0FDF4', border: '2px solid #14B8A6', borderRadius: 20,
        padding: 40, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💌</div>
        <h3 style={{ color: '#065F46', marginBottom: 8 }}>Thanks, we’ve got it.</h3>
        <p style={{ color: '#0F766E', fontSize: 16 }}>
          We reply to every message personally, usually within 1–2 business days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{
      display: 'grid', gap: 20,
      background: '#FFFFFF', padding: 32, borderRadius: 20,
      border: '1px solid #E2E8F0',
    }}>
      <Field label="Your name">
        <input
          required
          value={name} onChange={(e) => setName(e.target.value)}
          style={inputStyle}
          placeholder="Jane Smith"
        />
      </Field>
      <Field label="Email">
        <input
          required type="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          placeholder="jane@example.com"
        />
      </Field>
      <Field label="What’s this about?">
        <select
          value={reason} onChange={(e) => setReason(e.target.value)}
          style={inputStyle}
        >
          <option value="general">General enquiry</option>
          <option value="membership">Joining as a Founding Member</option>
          <option value="support">Support / help</option>
          <option value="press">Press / media</option>
          <option value="partnership">Partnership / sponsorship</option>
        </select>
      </Field>
      <Field label="Your message">
        <textarea
          required
          value={message} onChange={(e) => setMessage(e.target.value)}
          rows={6}
          style={{ ...inputStyle, resize: 'vertical' as const, minHeight: 140 }}
          placeholder="Tell us a little about what's on your mind..."
        />
      </Field>
      {state === 'error' && (
        <div style={{ background: '#FEF2F2', color: '#B91C1C', padding: 14, borderRadius: 10, fontSize: 14 }}>
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="btn btn-primary"
        style={{ justifySelf: 'start', padding: '14px 30px', fontSize: 15 }}
      >
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 8 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: '1.5px solid #E2E8F0',
  fontSize: 16,
  fontFamily: 'inherit',
  background: '#F8FAFC',
  color: '#0F172A',
  outline: 'none',
};
