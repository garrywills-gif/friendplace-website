'use client';

/* ─────────────────────────────────────────────────────────────
 * /register-interest/finish — one-tap resume for Phase 2 of the
 * two-phase register-interest flow.
 *
 * Context (Neo, Feb 2026 — Vik's missing FMN investigation):
 *   /public/register-interest is a two-phase flow. Phase 1 saves the
 *   row with `status: pending_confirmation`, Phase 2 draws the
 *   Founding Member number via `POST /public/register-interest/
 *   {reg_id}/confirm`. Visitors who abandoned between Phase 1 and
 *   Phase 2 are reminded exactly once via the registration_reminder
 *   service; this page handles the tap-through from that email.
 *
 * Behaviour:
 *   • Requires `?rid=<reg_id>` — binds the resume to the specific
 *     saved row so the link cannot be reused to create a NEW
 *     registration or jump to a different member's record.
 *   • POSTs the existing /confirm endpoint — SAME path a self-confirm
 *     takes — so founder-number allocation, status flip, and ack
 *     email all run through the one official place in the backend.
 *   • Celebrates the allocated number on success with the same
 *     wording as the main /register-interest flow.
 *   • Degrades gracefully for already-confirmed rows (shows "You're
 *     in" + the stored number). Degrades friendly for missing rows.
 * ─────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/lib/api-base';

type ConfirmResponse = {
  ok: boolean;
  id?: string;
  founder_number?: number | null;
  founder_number_display?: string;
  already_confirmed?: boolean;
};

export default function RegisterInterestFinishPage() {
  const params = useSearchParams();
  const rid = params?.get('rid') || '';

  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error' | 'not_found'>('idle');
  const [founderNumber, setFounderNumber] = useState<number | null>(null);
  const [founderDisplay, setFounderDisplay] = useState('');
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [errMsg, setErrMsg] = useState<string>('');
  const firedRef = useRef(false);

  useEffect(() => {
    if (!rid) {
      setStatus('error');
      setErrMsg('This resume link is incomplete. Please tap the button in your reminder email again.');
      return;
    }
    if (firedRef.current) return;   // StrictMode double-mount guard
    firedRef.current = true;

    const run = async () => {
      setStatus('working');
      try {
        const res = await fetch(
          `${API_BASE}/api/public/register-interest/${encodeURIComponent(rid)}/confirm`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        );
        if (res.status === 404) {
          setStatus('not_found');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || 'We couldn’t finish just now.');
        }
        const data = (await res.json()) as ConfirmResponse;
        setFounderNumber(data.founder_number ?? null);
        setFounderDisplay(data.founder_number_display || '');
        setAlreadyConfirmed(Boolean(data.already_confirmed));
        setStatus('done');
      } catch (e: any) {
        setStatus('error');
        setErrMsg(e?.message || 'Something went wrong — please try again from the email link.');
      }
    };
    void run();
  }, [rid]);

  return (
    <main style={{
      maxWidth: 640, margin: '0 auto', padding: '48px 24px 96px', color: '#0A2540',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
    }}>
      <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.01em' }}>
        {status === 'done'
          ? (alreadyConfirmed ? 'You’re already in 🎉' : 'Welcome aboard 🎉')
          : status === 'not_found'
          ? 'We couldn’t find that registration'
          : status === 'error'
          ? 'Just one small hiccup'
          : 'Finishing your registration…'}
      </h1>

      {status === 'working' && (
        <p style={{ marginTop: 16, color: '#64748B', fontSize: 16, lineHeight: 1.6 }}>
          Give me a moment while I lock in your Founding Member spot — this takes about a second.
        </p>
      )}

      {status === 'done' && (
        <>
          <p style={{ marginTop: 16, fontSize: 18, lineHeight: 1.6 }}>
            {alreadyConfirmed
              ? 'You’d already finished before — nothing more to do here. We’ve got you.'
              : 'That’s your spot locked in. A warm acknowledgement email is on its way.'}
          </p>
          {founderNumber && founderNumber > 0 && (
            <div style={{
              marginTop: 24, padding: '20px 24px', borderRadius: 20,
              background: 'linear-gradient(135deg, #FDF6EC 0%, #FEF3C7 100%)',
              border: '2px solid #FBBF24', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#92400E', fontWeight: 800 }}>
                Your Founding Member number
              </div>
              <div style={{ fontSize: 42, fontWeight: 900, color: '#92400E', marginTop: 6 }}>
                {founderDisplay || `#${String(founderNumber).padStart(4, '0')}`}
              </div>
            </div>
          )}
          <p style={{ marginTop: 24 }}>
            <Link href="/" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
              Continue exploring →
            </Link>
          </p>
        </>
      )}

      {status === 'not_found' && (
        <p style={{ marginTop: 16, color: '#64748B', fontSize: 16, lineHeight: 1.6 }}>
          The link in your email doesn’t match a saved registration anymore — perhaps it was already
          finished from a different device, or the record has been archived. If you think this is a
          mistake, please reply to our last email and we’ll sort it out.
        </p>
      )}

      {status === 'error' && (
        <>
          <p style={{ marginTop: 16, color: '#B91C1C', fontSize: 16, lineHeight: 1.6 }}>
            {errMsg}
          </p>
          <p style={{ marginTop: 12, color: '#64748B', fontSize: 15 }}>
            You can safely tap the button in your reminder email again — your details are still saved.
          </p>
        </>
      )}
    </main>
  );
}
