'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';

type Props = {
  slug: string;
  token: string;
};

/**
 * Two-tap RSVP cancel button.
 *
 * First tap arms the button ("Are you sure?"), second tap POSTs.
 * We avoid a full modal because this is a low-stakes destructive
 * action — an accidental cancel is annoying but recoverable (they
 * can RSVP again from the event page).
 */
export default function CancelRsvpButton({ slug, token }: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE}/api/public/events/${encodeURIComponent(slug)}/rsvp/${encodeURIComponent(token)}/cancel`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail || `Could not cancel (${res.status}).`);
        setSubmitting(false);
        return;
      }
      // Refresh so the page re-renders with the "cancelled" state.
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        style={{
          marginTop: 20, width: '100%', padding: '12px 18px',
          borderRadius: 12, border: '1px solid #FCA5A5', background: '#FEF2F2',
          color: '#991B1B', fontWeight: 800, cursor: 'pointer', fontSize: 14,
        }}
      >
        Cancel my RSVP
      </button>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13, color: '#7F1D1D', marginBottom: 12, textAlign: 'center' }}>
        Are you sure? Your spot will be released.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => setArmed(false)}
          disabled={submitting}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1px solid #CBD5E1', background: '#FFFFFF',
            color: '#0A2540', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Keep my RSVP
        </button>
        <button
          onClick={cancel}
          disabled={submitting}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: 'none', background: submitting ? '#94A3B8' : '#DC2626',
            color: '#FFFFFF', fontWeight: 800, cursor: submitting ? 'default' : 'pointer',
          }}
        >
          {submitting ? 'Cancelling…' : 'Yes, cancel'}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 10, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 8, fontSize: 13, textAlign: 'center' }}>
          {error}
        </div>
      )}
    </div>
  );
}
