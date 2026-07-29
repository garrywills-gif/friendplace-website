'use client';

/**
 * TapMeButterfly — the "quiet host" affordance for the tour pages.
 *
 * A small brand butterfly resting in the bottom-right of `/about`,
 * `/how-it-works` and `/features`. On hover / focus a single line
 * appears beside it:
 *
 *     "Tap me if you'd like to chat."
 *
 * On tap it opens a soft sheet with two options:
 *
 *   • "Take me back to the beginning."     → /meet
 *   • "I have a question."                 → /contact
 *
 * That's it. No unread badges. No pulsing pill. No "Chat with
 * George!" push. He is available; he is never in the way.
 *
 * Read the "Quiet Host" section in
 * `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` before changing
 * anything here. In particular:
 *
 *   - No George-voice copy on the tour pages themselves.
 *   - This component is the ONLY mark of him during the tour.
 *   - `/meet` and `/register-interest` MUST NOT render it — he is
 *     already present in those places.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';
import { useCompanion, COMPANIONS } from '@/lib/companion-context';

export default function TapMeButterfly() {
  const { companion } = useCompanion();
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The visitor has a companion by name IF they've been to /meet in
  // this browser before. If not, we still say "chat" — never a role
  // name or an assistant word.
  const companionName = companion ? COMPANIONS[companion].name : null;

  // Reveal the "Tap me if you'd like to chat." line the FIRST time
  // the visitor lingers on a tour page for a moment — quiet
  // introduction, not a nag. Auto-hides again after a few seconds
  // if they don't engage. We don't repeat this on later pages;
  // remembered in sessionStorage so the tour doesn't feel like it's
  // pestering.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let hideTimer: number | null = null;
    let showTimer: number | null = null;
    try {
      const seen = window.sessionStorage.getItem('fp_tap_hint_shown');
      if (seen === 'true') return;
      showTimer = window.setTimeout(() => {
        setShowHint(true);
        try { window.sessionStorage.setItem('fp_tap_hint_shown', 'true'); } catch { /* silent */ }
        hideTimer = window.setTimeout(() => setShowHint(false), 4500);
      }, 2600);
    } catch { /* silent */ }
    return () => {
      if (showTimer !== null) window.clearTimeout(showTimer);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, []);

  // Close the sheet on outside click / Escape. Same lightweight
  // pattern as the MCGS sheet but with no focus trap — this is not a
  // modal, it's a soft offering.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClickAway = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickAway);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickAway);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={dockWrap} aria-live="polite">
      {/* The gentle hint line — auto-shows once, or on hover/focus of
          the butterfly. Never a badge, never a "Chat!" pill. */}
      <div
        style={{
          ...hintPill,
          opacity: showHint || open ? 1 : 0,
          transform: showHint || open ? 'translateY(0)' : 'translateY(4px)',
          pointerEvents: 'none',
        }}
      >
        Tap me if you&rsquo;d like to chat.
      </div>

      {/* The soft sheet — appears above the butterfly when it's
          tapped. Two options, no more. */}
      {open && (
        <div style={sheetCard} role="dialog" aria-label="Talk to your companion">
          <div style={sheetHeader}>
            {companionName ? `${companionName} is here.` : 'I\u2019m here.'}
          </div>
          <Link href="/meet" onClick={() => setOpen(false)} style={sheetLink}>
            Take me back to the beginning.
          </Link>
          <Link href="/contact" onClick={() => setOpen(false)} style={sheetLink}>
            I have a question.
          </Link>
        </div>
      )}

      {/* The butterfly itself — a brand butterfly at rest, breathing.
          Uses the same "fpLogoBreath" keyframes as the site-header
          butterfly so the motion is identical across surfaces. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setShowHint(true)}
        onMouseLeave={() => setShowHint(false)}
        onFocus={() => setShowHint(true)}
        onBlur={() => setShowHint(false)}
        aria-label={companionName ? `Talk to ${companionName}` : 'Chat with your companion'}
        aria-expanded={open}
        style={btfBtn}
      >
        <img
          src={brandAssets.butterfly.src}
          alt=""
          aria-hidden
          style={{ width: 42, height: 'auto', display: 'block' }}
        />
      </button>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fpTapBreath {
          0%, 100% { transform: scale(1)    rotate(0deg); }
          50%      { transform: scale(0.98) rotate(-1.5deg); }
        }
        [data-fp-tapme] img { animation: fpTapBreath 5400ms ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          [data-fp-tapme] img { animation: none; }
        }
      ` }} />
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const dockWrap: React.CSSProperties = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 10,
  pointerEvents: 'none', // interactive children set their own
};

// Small line beside the butterfly. Deliberately not styled as a
// tooltip — no arrow, no bright bg. Reads like a whisper.
const hintPill: React.CSSProperties = {
  padding: '8px 14px',
  background: '#FFFFFF',
  color: '#0F766E',
  border: '1px solid #99F6E4',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.06)',
  transition: 'opacity 500ms ease, transform 500ms ease',
  whiteSpace: 'nowrap',
};

const btfBtn: React.CSSProperties = {
  pointerEvents: 'auto',
  background: '#FFFFFF',
  border: '1.5px solid #99F6E4',
  borderRadius: '50%',
  width: 60,
  height: 60,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.10)',
  padding: 0,
  transition: 'transform 220ms ease, box-shadow 220ms ease',
};

// The soft "sheet" that opens above the butterfly. Small, warm,
// two options. NOT a chat window; NOT a modal.
const sheetCard: React.CSSProperties = {
  pointerEvents: 'auto',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 18,
  padding: '18px 20px',
  minWidth: 240,
  boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const sheetHeader: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0F766E',
  letterSpacing: '0.02em',
  paddingBottom: 8,
  borderBottom: '1px solid #F1F5F9',
  marginBottom: 4,
};

const sheetLink: React.CSSProperties = {
  padding: '10px 8px',
  color: '#0A2540',
  fontSize: 15,
  fontWeight: 600,
  textDecoration: 'none',
  borderRadius: 10,
  transition: 'background 160ms ease',
};
