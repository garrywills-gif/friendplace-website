'use client';

/**
 * /meet — the centrepiece of FriendPlace.
 *
 * Phase A (this file) ships:
 *   \u2022 The natural companion-choice moment ("Who would you like to
 *     show you around today?"). Not a setup step \u2014 the invitation
 *     itself.
 *   \u2022 A warm, honest "we're still preparing" hand-off. The full
 *     butterfly-steps-out-of-the-logo choreography and the guided
 *     tour arrive in Phase B \u2014 we don't fake them in the meantime.
 *
 * Read /app/JOURNEY_CONTINUITY.md and /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md
 * before touching anything here. Especially the north star:
 *
 *   > Does this make someone feel welcome?
 *
 * If any word or button on this page reads like software or a form,
 * it's the wrong word. Rewrite it.
 */

import Link from 'next/link';
import { brandAssets } from '@/lib/brand-assets';
import { useCompanion, COMPANIONS, type CompanionId } from '@/lib/companion-context';

export default function MeetPage() {
  const { companion, meta, choose, ready } = useCompanion();

  // Before hydration, render the SSR-safe "no choice yet" state so the
  // first paint is identical for every visitor.
  const showChoice = !ready || !companion;

  return (
    <div style={pageBg}>
      <div className="container" style={{ paddingTop: 72, paddingBottom: 96 }}>

        {/* Landing plate \u2014 soft cream card so the moment sits in a
            room of its own rather than floating on the site chrome.
            Phase A: no motion \u2014 the room is already lit when Garry
            walks in. Phase B introduces the butterfly-from-logo
            choreography with a proper motion pass. */}
        <div style={plate}>

          {showChoice ? (
            <>
              {/* The butterfly sits gently above the words. In Phase B
                  it will fly here from the FriendPlace logo in the
                  header. For now it just rests, which is honest. */}
              <img
                src={brandAssets.butterfly.src}
                alt=""
                aria-hidden
                style={{ width: 96, height: 'auto', margin: '0 auto 20px', display: 'block' }}
              />

              <h1 style={openingLine}>Come in.</h1>

              <p style={leadCopy}>
                Who would you like to show you around today?
              </p>

              <div style={choiceRow}>
                <ChoiceCard companionId="george"  onChoose={choose} />
                <ChoiceCard companionId="georgia" onChoose={choose} />
              </div>

              <p style={footNote}>
                George and Georgia are the same person &mdash; same warmth, same
                honesty, same voice. The choice is simply what feels right to you.
              </p>
            </>
          ) : (
            <ChosenCompanionGreeting name={meta!.name} greeting={meta!.greetingLine} />
          )}

        </div>

      </div>
    </div>
  );
}

// ─── Companion choice card ────────────────────────────────────────────

function ChoiceCard({ companionId, onChoose }: { companionId: CompanionId; onChoose: (id: CompanionId) => void }) {
  const meta = COMPANIONS[companionId];
  return (
    <button
      type="button"
      onClick={() => onChoose(companionId)}
      style={choiceCard}
      aria-label={`Choose ${meta.name}`}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
    >
      <span style={choiceButterfly} aria-hidden>&#129419;</span>
      <span style={choiceName}>{meta.name}</span>
    </button>
  );
}

// ─── First-greeting hand-off ──────────────────────────────────────────

function ChosenCompanionGreeting({ name, greeting }: { name: string; greeting: string }) {
  return (
    <>
      <img
        src={brandAssets.butterfly.src}
        alt=""
        aria-hidden
        style={{ width: 96, height: 'auto', margin: '0 auto 20px', display: 'block' }}
      />
      <h1 style={openingLine}>{greeting}</h1>
      <p style={leadCopy}>
        I&rsquo;m still getting the room ready for a proper welcome. In a moment
        I&rsquo;ll be able to walk you through what FriendPlace is and show you
        around a little. For now, if you&rsquo;d like, you can leave your name
        and I&rsquo;ll make sure you&rsquo;re one of the first to know when we&rsquo;re
        ready for you.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
        <Link href="/register-interest" style={primaryCta}>Register your interest</Link>
        <Link href="/" style={secondaryCta}>Have a look around first</Link>
      </div>
      <p style={{ ...footNote, marginTop: 32 }}>
        {name} will be here when you come back.
      </p>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
//
// All values pulled to obey the community-centre feel: warm cream
// surfaces, generous space, gentle shadows, no hard corners. No
// gradients that shout. Motion is 240ms with a soft ease \u2014 the same
// pace as a hand opening a door.

const pageBg: React.CSSProperties = {
  minHeight: 'calc(100vh - 200px)',
  background: '#FEFCF8',
};

const plate: React.CSSProperties = {
  maxWidth: 720, margin: '0 auto',
  background: '#FFFFFF',
  borderRadius: 24,
  border: '1px solid #F1E9DC',
  boxShadow: '0 10px 40px rgba(15,23,42,0.06)',
  padding: '56px 40px 48px',
  textAlign: 'center',
};

const openingLine: React.CSSProperties = {
  fontSize: 40, lineHeight: 1.15, fontWeight: 800,
  color: '#0A2540', margin: '0 0 16px', letterSpacing: '-0.02em',
};

const leadCopy: React.CSSProperties = {
  fontSize: 19, lineHeight: 1.55, color: '#334155',
  margin: '0 auto 32px', maxWidth: 520,
};

const choiceRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'center', gap: 20,
  flexWrap: 'wrap', margin: '4px 0 24px',
};

const choiceCard: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
  gap: 10,
  padding: '24px 28px', minWidth: 180,
  background: '#F0FDFA',
  border: '1.5px solid #99F6E4',
  borderRadius: 20,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'transform 200ms ease, box-shadow 200ms ease, background 200ms ease',
};

const choiceButterfly: React.CSSProperties = {
  fontSize: 36, lineHeight: 1,
};

const choiceName: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: '#0F766E',
  letterSpacing: '-0.01em',
};

const footNote: React.CSSProperties = {
  fontSize: 14, color: '#64748B',
  margin: '24px auto 0', maxWidth: 480, lineHeight: 1.55,
};

const primaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 24px',
  background: 'linear-gradient(135deg,#14B8A6,#0EA5A0)',
  color: '#FFFFFF',
  fontSize: 15, fontWeight: 800, textDecoration: 'none',
  borderRadius: 12,
  boxShadow: '0 6px 20px rgba(20,184,166,0.28)',
};

const secondaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '14px 24px',
  background: '#FFFFFF',
  color: '#0F766E',
  fontSize: 15, fontWeight: 700, textDecoration: 'none',
  border: '1.5px solid #99F6E4',
  borderRadius: 12,
};
