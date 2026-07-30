'use client';

/**
 * /preview/hero-cta — side-by-side mockup of two "Meet George or
 * Georgia" CTA placement approaches, so Garry can experience both
 * before we commit to a change.
 *
 * This route is INTENTIONALLY isolated:
 *   • SiteHeader + SiteFooter both bail out on `/preview/*` (see their
 *     respective files) so the real chrome does not appear here.
 *   • Nothing on this page mutates production behaviour — the real
 *     homepage stays exactly as-is.
 *   • ConciergeOverlay is still mounted globally in the root layout,
 *     so BOTH mocks' primary CTA can actually summon George live.
 *
 * When we settle on a direction, delete this route and apply the
 * winning layout to /app/page.tsx + SiteHeader.tsx.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';

// ─── Timing (proposed variant) ─────────────────────────────────────────
// The invitation pill waits for the visitor to read the hero before
// stepping forward. Two staggered beats — pill first, sub-line a soft
// breath later — so it reads as a considered arrival, not a popup.
const PILL_DELAY_MS  = 1700; // enough to read "Find your people." + intro
const CAPTION_DELAY_MS = 2100; // pill lands first, caption follows

// Small helper — fires the concierge overlay from either mock.
function summonConcierge(e: React.MouseEvent) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('friendplace:meet-george'));
}

// Detect prefers-reduced-motion so we can honour the visitor's OS
// setting — if they've asked for reduced motion, we still show the
// invitation, but skip the rise and shorten the delay.
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export default function HeroCtaComparePage() {
  return (
    <div style={{ background: '#F6F8FB', minHeight: '100vh', paddingBottom: 96 }}>
      {/* ── Preview toolbar ─────────────────────────────────────── */}
      <div style={toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }} aria-hidden>🦋</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#05192C' }}>
              Hero CTA Placement — Compare
            </div>
            <div style={{ fontSize: 12.5, color: '#64748B' }}>
              Preview only. Nothing here is live on the site yet.
            </div>
          </div>
        </div>
        <Link href="/site" style={toolbarBtn}>← Back to site</Link>
      </div>

      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 24px 0' }}>
        {/* ── Variant A ────────────────────────────────────────── */}
        <SectionLabel
          badge="A · CURRENT"
          title="CTA lives in the top navigation"
          note="Meet George or Georgia is a persistent right-side nav button."
        />
        <HeroMock variant="current" />

        {/* ── Variant B ────────────────────────────────────────── */}
        <div style={{ height: 64 }} />
        <SectionLabel
          badge="B · PROPOSED"
          title="CTA lives in the hero, under Get the App / See how it works"
          note="Full-width pill invitation with a warm helper line. Nav is quieter."
        />
        <HeroMock variant="proposed" />

        {/* ── Compare footnote ─────────────────────────────────── */}
        <div style={footnote}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>How to decide</div>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Give the proposed variant a moment — the invitation
              pill waits ~1.7s so visitors can read the hero before
              George steps forward. It should feel like he waited on
              purpose, not like something loaded late.</li>
            <li>Click the primary CTA in each variant — the concierge
              overlay works in both, so you can feel the whole moment.</li>
            <li>Try each on your phone — the mobile view of the
              proposed hero puts the pill front and centre.</li>
            <li>Read the hero copy top-to-bottom. Which order feels
              more like a natural visitor journey?</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section label
// ═══════════════════════════════════════════════════════════════════════
function SectionLabel({ badge, title, note }: { badge: string; title: string; note: string }) {
  return (
    <div style={{ marginBottom: 14, display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '4px 12px',
        borderRadius: 999, background: '#0A2540', color: '#5EEAD4',
        fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em',
      }}>{badge}</span>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0A2540' }}>{title}</div>
        <div style={{ fontSize: 13.5, color: '#475569', marginTop: 2 }}>{note}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Hero mock — one component, two variants. Kept as compact as possible
// while preserving the essential visual language of the real hero so
// the comparison feels fair.
// ═══════════════════════════════════════════════════════════════════════
function HeroMock({ variant }: { variant: 'current' | 'proposed' }) {
  const showNavCTA = variant === 'current';
  const showHeroCTA = variant === 'proposed';
  const reduced = useReducedMotion();

  // Staggered entrance for the proposed invitation. Two beats: pill
  // arrives first, sub-line a breath later. Reduced-motion visitors
  // get a shorter delay with no transform — the invitation still lands
  // but without any movement.
  const [pillIn, setPillIn] = useState(false);
  const [captionIn, setCaptionIn] = useState(false);
  useEffect(() => {
    if (!showHeroCTA) return;
    // Restart the animation whenever the variant becomes visible so a
    // page revisit (or a hot reload during authoring) shows the fade.
    setPillIn(false);
    setCaptionIn(false);
    const pillT = setTimeout(() => setPillIn(true), reduced ? 350 : PILL_DELAY_MS);
    const capT  = setTimeout(() => setCaptionIn(true), reduced ? 550 : CAPTION_DELAY_MS);
    return () => { clearTimeout(pillT); clearTimeout(capT); };
  }, [showHeroCTA, reduced]);

  return (
    <div style={mockShell}>
      {/* Mock header — matches the real SiteHeader visually */}
      <div style={mockHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src={brandAssets.butterfly.src}
            alt=""
            width={brandAssets.butterfly.width}
            height={brandAssets.butterfly.height}
            style={{ width: 32, height: 'auto', display: 'block' }}
          />
          <span style={{ fontWeight: 900, fontSize: 18, color: '#0A2540', letterSpacing: '-0.02em' }}>
            Friend<span style={{ color: '#14B8A6' }}>Place</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="mock-nav">
          {NAV_ITEMS.map((label) => (
            <span key={label} style={mockNavItem}>{label}</span>
          ))}
          {showNavCTA && (
            <a
              href="/meet"
              onClick={summonConcierge}
              style={{
                marginLeft: 12,
                padding: '9px 16px', borderRadius: 999,
                background: '#14B8A6', color: '#05192C',
                fontSize: 13, fontWeight: 800, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Meet George or Georgia
            </a>
          )}
        </div>
      </div>

      {/* Mock hero body */}
      <div style={mockHeroBody}>
        {/* soft teal glow */}
        <div aria-hidden style={{
          position: 'absolute', right: '-8%', top: '-30%',
          width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(94,234,212,0.22), transparent)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: '1.15fr 0.85fr',
          gap: 32, alignItems: 'center',
          padding: '48px 40px',
        }} className="mock-grid">
          {/* Left column — copy + CTAs */}
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 999,
              background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.35)',
              color: '#5EEAD4', fontSize: 11.5, fontWeight: 700, marginBottom: 20,
            }}>
              🦋 Now welcoming Founding Members
            </div>
            <h1 style={{
              color: '#FFFFFF', fontSize: 46, lineHeight: 1.05,
              margin: '0 0 18px', letterSpacing: '-0.02em', fontWeight: 900,
            }}>
              Find your <span style={{ color: '#5EEAD4' }}>people</span>.
            </h1>
            <p style={{ fontSize: 16.5, color: '#FFFFFF', lineHeight: 1.5, margin: '0 0 12px', fontWeight: 600 }}>
              Real friendships. Real communities.<br />
              Right where you live.
            </p>
            <p style={{ fontSize: 14.5, color: '#CBD5E1', lineHeight: 1.6, margin: '0 0 26px', maxWidth: 460 }}>
              FriendPlace is where genuine friendships begin. Meet local people,
              discover welcoming communities and enjoy real conversations —
              without swiping, followers or popularity contests.
            </p>

            {/* Row 1: the two primary CTAs (same in both variants) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <a href="#download" style={mockPrimaryBtn}>Get the App →</a>
              <a href="/how-it-works" style={mockGhostBtn}>See how it works</a>
            </div>

            {/* Row 2 (proposed only): full-width invitation pill. The
                whole invitation block waits ~1.7s so visitors can read
                the hero before George steps forward. Pill arrives
                first, sub-line follows a breath later. */}
            {showHeroCTA && (
              <div style={{ marginTop: 22 }}>
                <a
                  href="/meet"
                  onClick={summonConcierge}
                  style={{
                    ...mockInvitePill,
                    opacity: pillIn ? 1 : 0,
                    transform: reduced
                      ? 'none'
                      : (pillIn ? 'translateY(0)' : 'translateY(10px)'),
                    transition: reduced
                      ? 'opacity 500ms ease'
                      : 'opacity 900ms ease, transform 900ms cubic-bezier(0.22, 1, 0.36, 1)',
                    pointerEvents: pillIn ? 'auto' : 'none',
                  }}
                >
                  <span aria-hidden style={{ fontSize: 18 }}>🦋</span>
                  <span>Meet George or Georgia</span>
                </a>
                <div style={{
                  marginTop: 10, fontSize: 13.5, color: '#94A3B8',
                  fontStyle: 'italic', lineHeight: 1.5,
                  opacity: captionIn ? 1 : 0,
                  transform: reduced
                    ? 'none'
                    : (captionIn ? 'translateY(0)' : 'translateY(6px)'),
                  transition: reduced
                    ? 'opacity 500ms ease'
                    : 'opacity 800ms ease, transform 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}>
                  Take a friendly guided tour, or simply say hello.
                </div>
              </div>
            )}
          </div>

          {/* Right column — the butterfly */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={brandAssets.butterfly.src}
              alt=""
              width={brandAssets.butterfly.width}
              height={brandAssets.butterfly.height}
              style={{ width: 260, height: 'auto', display: 'block' }}
            />
          </div>
        </div>
      </div>

      {/* Mobile-friendly rules for the mock */}
      <style>{`
        @media (max-width: 780px) {
          .mock-grid { grid-template-columns: 1fr !important; padding: 32px 22px !important; }
          .mock-nav span { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════
const NAV_ITEMS = ['About', 'How It Works', 'Features', 'Events', 'Stories', 'FAQs', 'Contact'];

const toolbar: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 40,
  background: '#FFFFFF',
  borderBottom: '1px solid #E5E9EF',
  boxShadow: '0 1px 4px rgba(15,23,42,0.05)',
  padding: '10px 24px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

const toolbarBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  background: '#F1F5F9',
  color: '#0A2540',
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
  border: '1px solid #E2E8F0',
};

const mockShell: React.CSSProperties = {
  borderRadius: 20,
  overflow: 'hidden',
  background: '#FFFFFF',
  border: '1px solid #E5E9EF',
  boxShadow: '0 12px 40px rgba(15,23,42,0.08)',
};

const mockHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  background: 'rgba(254, 252, 248, 0.96)',
  borderBottom: '1px solid #E5E9EF',
  padding: '14px 24px',
  height: 60,
};

const mockNavItem: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#0A2540',
  padding: '6px 12px',
  borderRadius: 8,
};

const mockHeroBody: React.CSSProperties = {
  position: 'relative',
  background: 'linear-gradient(180deg, #0A2540 0%, #12365B 100%)',
  overflow: 'hidden',
};

const mockPrimaryBtn: React.CSSProperties = {
  padding: '13px 22px',
  background: '#14B8A6',
  color: '#05192C',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 800,
  textDecoration: 'none',
};

const mockGhostBtn: React.CSSProperties = {
  padding: '13px 22px',
  background: 'transparent',
  color: '#FFFFFF',
  border: '1.5px solid rgba(255,255,255,0.35)',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 700,
  textDecoration: 'none',
};

// Full-width invitation pill for the proposed variant. Warmer than the
// primary CTA — sits ONE level below Get the App visually, but occupies
// the whole row so it reads like an invitation, not a bonus button.
const mockInvitePill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  maxWidth: 460,
  padding: '15px 24px',
  background: 'rgba(94, 234, 212, 0.12)',
  color: '#5EEAD4',
  border: '1.5px solid rgba(94, 234, 212, 0.55)',
  borderRadius: 999,
  fontSize: 15,
  fontWeight: 800,
  textDecoration: 'none',
  boxShadow: 'inset 0 0 0 1px rgba(94,234,212,0.15), 0 8px 22px rgba(5,25,44,0.28)',
};

const footnote: React.CSSProperties = {
  marginTop: 48,
  padding: '18px 22px',
  background: '#FFFFFF',
  borderRadius: 14,
  border: '1px solid #E5E9EF',
  color: '#334155',
  fontSize: 14,
  lineHeight: 1.6,
};
