'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandMark } from './Butterfly';
import { site } from '@/lib/brand';

/**
 * Site header — sticky, translucent nav bar with the butterfly wordmark
 * on the left and the primary nav on the right. Collapses to a hamburger
 * on mobile.
 *
 * Behaviour notes:
 *   • `client component` because it needs interactive mobile-nav state.
 *   • Uses backdrop-filter for a frosted-glass effect on scroll.
 *   • The Butterfly is teal against the cream background — mirrors the
 *     app icon's colour scheme so returning users get an instant
 *     brand-recognition hit.
 */
export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        backdropFilter: 'saturate(180%) blur(12px)',
        background: 'rgba(254, 252, 248, 0.85)',
        borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
      }}
    >
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <BrandMark size={36} color="#14B8A6" />
          <span style={{ fontWeight: 900, fontSize: 22, color: '#0A2540', letterSpacing: '-0.02em' }}>
            Friend<span style={{ color: '#14B8A6' }}>Place</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} style={{ color: '#0A2540', fontWeight: 600, fontSize: 15 }}>
              {n.label}
            </Link>
          ))}
          <Link href="/#download" className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 14 }}>
            Get the App
          </Link>
        </nav>

        {/* Mobile burger */}
        <button
          className="nav-mobile-toggle"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'none', background: 'transparent', border: 0,
            width: 40, height: 40, borderRadius: 999,
          }}
        >
          <span style={{
            display: 'block', width: 20, height: 2, background: '#0A2540',
            margin: '4px auto', transition: 'transform 200ms',
            transform: open ? 'translateY(6px) rotate(45deg)' : 'none',
          }} />
          <span style={{ display: 'block', width: 20, height: 2, background: '#0A2540', margin: '4px auto', opacity: open ? 0 : 1 }} />
          <span style={{
            display: 'block', width: 20, height: 2, background: '#0A2540',
            margin: '4px auto', transition: 'transform 200ms',
            transform: open ? 'translateY(-6px) rotate(-45deg)' : 'none',
          }} />
        </button>
      </div>

      {/* Mobile menu drop-panel */}
      {open && (
        <div className="nav-mobile-panel" style={{ background: '#FEFCF8', borderTop: '1px solid #E2E8F0', padding: '16px 24px' }}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '12px 0', fontWeight: 600, color: '#0A2540', borderBottom: '1px solid #F1F5F9' }}
            >
              {n.label}
            </Link>
          ))}
          <Link href="/#download" onClick={() => setOpen(false)} className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}>
            Get the App
          </Link>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-toggle { display: block !important; }
        }
      `}</style>
    </header>
  );
}

const NAV = [
  { label: 'About', href: '/about' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Features', href: '/features' },
  { label: 'FAQs', href: '/faqs' },
  { label: 'Contact', href: '/contact' },
];

// suppress unused var to satisfy TS strict on site import
void site;
