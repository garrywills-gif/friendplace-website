'use client';

/* ─────────────────────────────────────────────────────────────
 * 🔒 APPROVED BASELINE — iter152, June 2026
 *   The Founding Member reveal (celebration line → number card →
 *   auto-playing personalised TTS → replay pill → farewell → two
 *   ✅ ticks → "Continue Exploring →") is LOCKED. Scroll-to-top
 *   on `done`, preview-aware whyHref, and Ash/Nova voice mapping
 *   are all approved. See /app/website/APPROVED_ONBOARDING_JOURNEY.md
 *   before changing anything on this page.
 * ─────────────────────────────────────────────────────────── */

/**
 * /register-interest — the RYI page.
 *
 * Phase A (this file) ships the form UI wired to a placeholder submit.
 * The backend endpoint + Resend confirmation email arrive in Phase C.
 *
 * Locked-in rules (Garry, Jul 2026):
 *   • Required: first name + email.
 *   • Optional: state/country, how did you hear about us.
 *   • Nothing else. The goal is <20 seconds to submit.
 *   • The companion the visitor chose is recorded alongside so
 *     "Welcome back" on first app login is genuine.
 *
 * Read /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md before editing.
 * The form is not a form — it's a conversation with 4 questions.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCompanion, COMPANIONS } from '@/lib/companion-context';
import { API_BASE } from '@/lib/api-base';

export default function RegisterInterestPage() {
  // We still read the companion so we can record their choice with the
  // registration (drives the "Welcome back" moment on first app login).
  // But we no longer NAME them in the page copy — the visitor has
  // just come off the tour and George's closing line; the form is not
  // the moment for another host greeting.
  const { companion, meta } = useCompanion();

  const [firstName, setFirstName]     = useState('');
  const [email, setEmail]             = useState('');
  const [location, setLocation]       = useState('');
  const [heardFrom, setHeardFrom]     = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);
  const [founderNumber, setFounderNumber] = useState<number | null>(null);
  const [error, setError]             = useState<string | null>(null);

  // Audio state for the celebration line.
  //
  //   audioBlobUrl        — object-URL of the fetched MP3, injected
  //                         into <audio src>. Null while we haven't
  //                         fetched (or the fetch failed silently).
  //   audioBlocked        — true if autoplay was refused (Safari
  //                         will do this if the visitor hasn't
  //                         gestured on the page since navigation).
  //                         Drives a subtle "Hear George" prompt.
  //   audioReplaying      — true briefly after Replay is tapped so
  //                         the button can dim/lock while playing.
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioReplaying, setAudioReplaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // The Continue Exploring button deep-links to the "Why FriendPlace?"
  // section on the homepage. In production this lives at
  // `/#why-friendplace`. In the preview environment served by
  // Emergent (`*.preview.emergentagent.com`) the root path "/" is
  // claimed by the Expo mobile app; the marketing homepage is
  // reachable via the `/site` alias. We resolve the correct href on
  // the client so refreshes/deploys behave the same in both worlds.
  // Locked with Garry (iter152, June 2026).
  const [whyHref, setWhyHref] = useState<string>('/#why-friendplace');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname || '';
    if (host.endsWith('.preview.emergentagent.com')) {
      setWhyHref('/site#why-friendplace');
    } else {
      setWhyHref('/#why-friendplace');
    }

    // Referral links use the Founding Member's permanent number, e.g.
    // ?ref=FM0033. We keep this deliberately lightweight and record it
    // through the existing `heard_from` field so the current production
    // backend can track referral registrations without a schema change.
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get('ref') || '').trim().toUpperCase();
    if (/^FM\d{1,6}$/.test(ref)) setReferralSource(ref);
  }, []);

  // Reveal-moment side-effects — run once when the form flips from
  // pending → done.
  //
  //   1. Scroll to the very top so the visitor's first sight is the
  //      celebration headline + Founding Member number, not whatever
  //      the form had scrolled into view during submission. Locked
  //      with Garry (iter152, June 2026): "The celebration is the
  //      reward — it should never open halfway down the page."
  //   2. Fetch the personalised TTS clip ("Congratulations, {name}!
  //      You're officially Founding Member number {n}.") and attempt
  //      to auto-play in the host's voice. Safari may block autoplay
  //      if the user hasn't gestured since page load — in that case
  //      we surface a small "Hear George/Georgia" prompt instead.
  useEffect(() => {
    if (!done) return;

    // 1. Scroll to top. Instant, no animation — the visitor should
    // see the headline the moment the reveal renders. Also reset
    // the documentElement scrollTop for iOS Safari where the body
    // occasionally holds a stale scroll position.
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    } catch { /* non-fatal */ }

    // 2. Fetch the TTS clip. Guard against missing data.
    if (!founderNumber || !firstName.trim()) return;
    const chosen = (companion === 'georgia') ? 'georgia' : 'george';
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/founding-member-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: firstName.trim(),
            founder_number: founderNumber,
            companion: chosen,
          }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioBlobUrl(objectUrl);
      } catch { /* non-fatal; page still renders without audio */ }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [done, founderNumber, firstName, companion]);

  // Auto-play the celebration clip once the audio element receives
  // its src. Safari may refuse — we detect that and surface a
  // "Hear George/Georgia" replay prompt.
  useEffect(() => {
    if (!audioBlobUrl) return;
    const el = audioRef.current;
    if (!el) return;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => setAudioBlocked(true));
    }
  }, [audioBlobUrl]);

  function replayCelebration() {
    const el = audioRef.current;
    if (!el || !audioBlobUrl) return;
    try {
      el.currentTime = 0;
      setAudioBlocked(false);
      setAudioReplaying(true);
      const p = el.play();
      const clear = () => setAudioReplaying(false);
      el.addEventListener('ended', clear, { once: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => { setAudioBlocked(true); setAudioReplaying(false); });
      }
    } catch { setAudioReplaying(false); }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firstName.trim() || !email.trim()) {
      setError('Please leave your first name and email so we know how to reach you.');
      return;
    }
    // Very light email sanity check — the backend is the source of truth.
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That email doesn't look quite right — could you double-check it?");
      return;
    }
    setSubmitting(true);
    try {
      // Phase-C endpoint: persists to `interest_registrations` and
      // sends a warm, in-voice confirmation email signed by the
      // chosen companion. Any non-2xx surfaces as a friendly error;
      // the DB write itself is the source of truth so an email
      // failure never punishes the visitor.
      const referralHeardFrom = referralSource
        ? `referral:${referralSource}${heardFrom.trim() ? ` | ${heardFrom.trim()}` : ''}`
        : (heardFrom.trim() || null);
      const res = await fetch(`${API_BASE}/api/public/register-interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          email: email.trim().toLowerCase(),
          state_country: location.trim() || null,
          heard_from: referralHeardFrom,
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
          setError('It looks like a few of you might be registering from the same place — give it a moment and try again.');
        } else {
          setError(msg || "Something went wrong on our side — could you try again in a moment?");
        }
        return;
      }
      // Success: the response now carries the visitor's permanent
      // Founding Member Number (#0003, #0004, …). We surface it
      // proudly on the thank-you page — mirrors the celebratory
      // hero in the acknowledgement email.
      try {
        const body = await res.json();
        if (typeof body?.founder_number === 'number' && body.founder_number > 0) {
          setFounderNumber(body.founder_number);
        }
      } catch { /* non-fatal; page still renders without the number */ }
      setDone(true);
    } catch (err) {
      console.error('[ryi] submit failed', err);
      // Network hiccup on the visitor's side — don't punish them
      // for it; the retry is just a tap away.
      setError("Your internet seems a little slow. Could you try again?");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const signOff = meta?.emailSignatureName || 'George';
    const displayName = firstName.trim() || 'friend';
    return (
      <div style={pageBg}>
        <div className="container" style={{ paddingTop: 72, paddingBottom: 96 }}>
          <div style={plate}>
            {/* ─── The reveal ────────────────────────────────────
             *  Founding Membership is NOT promised during the
             *  tour or the form — it is REVEALED here as the
             *  reward for saying yes. The order matters:
             *    1) Celebration     — "🎉 Congratulations…"
             *    2) The status      — "…officially a Founding Member"
             *    3) The number card — permanent, yours forever
             *    4) The farewell    — George/Georgia's own voice
             *    5) The two ticks   — plain, reassuring
             *    6) One CTA         — Continue Exploring →
             *  Locked with Garry (iter151, June 2026). Do not
             *  add a "Thank you" beat before the celebration —
             *  that softens the reveal.
             */}
            <h1 style={celebrationLine}>
              <span aria-hidden style={{ marginRight: 8 }}>🎉</span>
              Congratulations, {displayName}!
            </h1>
            <p style={{ ...leadCopy, marginTop: 14, fontSize: 18 }}>
              You&rsquo;re officially one of FriendPlace&rsquo;s{' '}
              <span style={{ fontWeight: 800, color: '#0F766E' }}>Founding Members</span>.
            </p>

            {founderNumber && founderNumber > 0 && (
              <div style={{
                marginTop: 26,
                marginBottom: 6,
                padding: '24px 24px 22px',
                background: 'linear-gradient(135deg, #0F766E 0%, #14B8A6 100%)',
                borderRadius: 22,
                color: '#FFFFFF',
                boxShadow: '0 16px 40px rgba(20,184,166,0.28)',
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
                  fontWeight: 800, opacity: 0.9,
                }}>Founding Member</div>
                <div style={{
                  fontSize: 56, fontWeight: 900, lineHeight: 1, marginTop: 8,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  #{String(founderNumber).padStart(4, '0')}
                </div>
                <div style={{ fontSize: 13, marginTop: 10, opacity: 0.92 }}>
                  Permanent · Yours forever · Never reassigned
                </div>
              </div>
            )}

            {/* ── Celebration audio ─────────────────────────────
             *  A single spoken line in the host's voice:
             *  "Congratulations, {first_name}! You're officially
             *  Founding Member number {n}." Auto-plays when the
             *  reveal renders (Safari may block — the "Hear
             *  {host} again" prompt below picks that up). We do
             *  NOT read the farewell or the ticks aloud — the
             *  spoken introduction is enough to make the moment
             *  feel special; anything more would over-narrate
             *  and take the visitor's own pace away.
             *  Locked with Garry (iter152, June 2026). */}
            <audio
              ref={audioRef}
              src={audioBlobUrl || undefined}
              preload="auto"
              playsInline
              // eslint-disable-next-line react/no-unknown-property
              // @ts-ignore — playsInline is valid on HTMLAudioElement
            />
            {(audioBlobUrl || audioBlocked) && (
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={replayCelebration}
                  disabled={!audioBlobUrl || audioReplaying}
                  style={{
                    ...replayButton,
                    opacity: (!audioBlobUrl || audioReplaying) ? 0.55 : 1,
                    cursor: (!audioBlobUrl || audioReplaying) ? 'default' : 'pointer',
                  }}
                  aria-label={audioBlocked
                    ? `Hear ${signOff} say hello`
                    : `Hear ${signOff} again`}
                >
                  <span aria-hidden style={{ fontSize: 15, marginRight: 6 }}>🔊</span>
                  {audioBlocked
                    ? `Hear ${signOff} say hello`
                    : `Hear ${signOff} again`}
                </button>
              </div>
            )}

            {/* ── Host's farewell — exact copy locked with Garry
                (iter151). George/Georgia speaks one warm paragraph
                on this page and this page only. Do not split it
                into two paragraphs; do not rewrite; do not add a
                supporting line. */}
            <p style={{ ...leadCopy, marginTop: 26, fontSize: 17 }}>
              I&rsquo;m so pleased you&rsquo;ve decided to join us.
              You&rsquo;re one of the very first people helping shape
              FriendPlace, and I&rsquo;ll make sure you&rsquo;re among
              the first to know when FriendPlace launches. Until then,
              take care, and I&rsquo;ll see you soon.
            </p>
            <p style={{ ...leadCopy, marginTop: 16, fontStyle: 'italic', color: '#0F766E' }}>
              <span aria-hidden style={{ fontSize: 22, verticalAlign: '-3px', marginRight: 6 }}>&#129419;</span>
              {signOff}
            </p>

            {/* ── Two clear takeaways. Plain, reassuring, no
                marketing tone. Answers the visitor's silent
                question: "What just happened, and what happens
                next?" */}
            <ul style={ticksList} aria-label="What this means">
              <li style={tickItem}>
                <span aria-hidden style={tickMark}>✅</span>
                <span>You are now officially a Founding Member.</span>
              </li>
              <li style={tickItem}>
                <span aria-hidden style={tickMark}>✅</span>
                <span>We&rsquo;ll be in touch as soon as FriendPlace launches.</span>
              </li>
            </ul>

            {founderNumber && founderNumber > 0 && (
              <ReferralSharePanel founderNumber={founderNumber} />
            )}

            <div style={{ marginTop: 32 }}>
              {/* Continue Exploring — deep-links to the "Why
                  FriendPlace?" section on the homepage (NOT the
                  hero). By this point the visitor has already
                  said yes; the hero has done its job.
                  We use a plain <a> (NOT next/link) because in
                  the preview environment the target lives at
                  /site (the marketing homepage alias) which
                  Next.js's client router doesn't know about —
                  a full navigation lets nginx route to the
                  correct upstream. In production this resolves
                  to /#why-friendplace (a normal same-app deep
                  link). Locked with Garry (iter152, June 2026). */}
              <a href={whyHref} style={secondaryCta}>Continue Exploring &rarr;</a>
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
          {/* No explanation, no persuasion. By the time a visitor
              reaches this page they've had the whole story. RYI is
              the moment they say yes — nothing more. Locked with
              Garry (Dec 2026): "This should be the natural conclusion
              after they've explored the story." */}
          <h1 style={openingLine}>Whenever you&rsquo;re ready.</h1>
          {/* No explanation, no persuasion. By the time a visitor
              reaches this page they've had the whole story. RYI is
              the moment they say yes — nothing more. The Founding
              Member moment is now the REWARD after they submit, not
              a promise before (Garry, iter151 — June 2026). Do not
              re-introduce a pre-tease here. */}

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
                {submitting ? 'Sending…' : 'That’s my hello'}
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

function ReferralSharePanel({ founderNumber }: { founderNumber: number }) {
  const [copied, setCopied] = useState(false);
  const code = `FM${String(founderNumber).padStart(4, '0')}`;
  const url = `https://www.friendplace.com.au/register-interest?ref=${code}`;
  const text = 'I’ve just become a FriendPlace Founding Member. It’s an Australian community for making genuine friendships and connecting locally. Have a look 🦋';

  async function shareMore() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'FriendPlace', text, url });
        return;
      } catch { /* cancelled or unavailable — no action needed */ }
    }
    if (typeof window !== 'undefined') window.open(`mailto:?subject=${encodeURIComponent('Have a look at FriendPlace')}&body=${encodeURIComponent(`${text}\n\n${url}`)}`);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  }

  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent('Have a look at FriendPlace')}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
  const smsHref = `sms:?&body=${encodeURIComponent(`${text} ${url}`)}`;

  return (
    <div style={referralPanel}>
      <div style={{ fontSize: 20, fontWeight: 850, color: '#0A2540' }}>
        Know someone who might enjoy FriendPlace too?
      </div>
      <p style={{ ...leadCopy, fontSize: 15, marginTop: 8 }}>
        Share FriendPlace with a friend and help us welcome the next Founding Member. 🦋
      </p>
      <div style={referralButtons}>
        <a href={facebook} target="_blank" rel="noreferrer" style={referralButton}>Facebook</a>
        <button type="button" onClick={shareMore} style={referralButton}>Messenger / More</button>
        <a href={emailHref} style={referralButton}>Email</a>
        <a href={smsHref} style={referralButton}>SMS</a>
        <button type="button" onClick={copyLink} style={referralButton}>{copied ? 'Copied ✓' : 'Copy link'}</button>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#94A3B8' }}>
        Your share link includes your Founding Member referral code {code}.
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
        {optional && <span style={optionalTag}>{' — optional'}</span>}
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

// Slightly larger and more celebratory than openingLine — reserved
// for the Founding Member reveal beat. Tight line-height keeps the
// two-line headline ("🎉 Congratulations, {firstName}!") coherent
// even for longer first names on mobile.
const celebrationLine: React.CSSProperties = {
  fontSize: 34, lineHeight: 1.18, fontWeight: 900,
  color: '#0A2540', margin: '0 0 4px', letterSpacing: '-0.02em',
};

const ticksList: React.CSSProperties = {
  listStyle: 'none', padding: 0, margin: '28px auto 0',
  maxWidth: 460, textAlign: 'left',
  display: 'flex', flexDirection: 'column', gap: 10,
};

const tickItem: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  fontSize: 16, lineHeight: 1.5, color: '#0F172A',
  background: '#F0FDFA',
  border: '1px solid #99F6E4',
  borderRadius: 12,
  padding: '12px 14px',
};

const tickMark: React.CSSProperties = {
  fontSize: 18, lineHeight: 1.4, flex: '0 0 auto',
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

const referralPanel: React.CSSProperties = {
  marginTop: 28,
  padding: '22px 18px',
  borderRadius: 18,
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
};

const referralButtons: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 8,
  marginTop: 16,
};

const referralButton: React.CSSProperties = {
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  padding: '9px 13px',
  borderRadius: 999,
  border: '1.5px solid #99F6E4',
  background: '#FFFFFF',
  color: '#0F766E',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 750,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

// Quiet, secondary — sits under the number card, doesn't fight
// with the celebration or the farewell. Matches the pattern used
// by "Hear George again" on /meet so the same button reads the
// same across the whole journey.
const replayButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '9px 16px',
  background: 'rgba(94, 234, 212, 0.12)',
  color: '#0F766E',
  border: '1.5px solid rgba(94, 234, 212, 0.55)',
  borderRadius: 999,
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
};

const footNote: React.CSSProperties = {
  marginTop: 24, fontSize: 13, color: '#64748B', lineHeight: 1.55,
};
