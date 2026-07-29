'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';

/**
 * Site header — sticky white nav bar with:
 *   • butterfly + wordmark on the left
 *   • primary nav on the right
 *   • hamburger on mobile
 *
 * Premium polish added:
 *   • Subtle 1 px light-grey divider + soft drop shadow underneath so
 *     the header separates cleanly from the navy masthead below.
 *   • Very subtle teal separators between menu items (14 px tall,
 *     15% opacity — visible only if you look for them).
 *   • Teal underline on the active page, drawn with a ::after pseudo
 *     so it never affects layout, only visual state.
 */
export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The Mini-CMS admin section has its own shell (sidebar layout, no
  // marketing header/footer). Bail out before rendering anything so the
  // /admin/* pages look like a proper app, not a marketing page with an
  // embedded editor.
  if (pathname?.startsWith('/admin')) return null;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        backdropFilter: 'saturate(180%) blur(12px)',
        background: 'rgba(254, 252, 248, 0.92)',
        // Subtle 1 px grey divider + soft drop shadow. Together they
        // give the header a premium lift without any single element
        // being loud. The shadow uses a slate tint (rather than pure
        // black) so it blends with the cream background.
        borderBottom: '1px solid #E5E9EF',
        boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img
            src={brandAssets.butterfly.src}
            alt={brandAssets.butterfly.alt}
            width={brandAssets.butterfly.width}
            height={brandAssets.butterfly.height}
            style={{ width: 36, height: 'auto', display: 'block' }}
          />
          <span style={{ fontWeight: 900, fontSize: 22, color: '#0A2540', letterSpacing: '-0.02em' }}>
            Friend<span style={{ color: '#14B8A6' }}>Place</span>
          </span>
        </Link>

        {/* Desktop nav — gap:0 because separators are drawn between
            items via ::before pseudo-elements. */}
        <nav className="nav-desktop" style={{ display: 'flex', alignItems: 'center' }}>
          {NAV.map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              className={`nav-link ${isActive(n.href) ? 'nav-link-active' : ''}`}
              data-first={i === 0 ? 'true' : undefined}
            >
              {n.label}
            </Link>
          ))}
          <Link href="/meet" className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 14, marginLeft: 20 }}>
            Meet George or Georgia
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
        <div className="nav-mobile-panel" style={{ background: '#FEFCF8', borderTop: '1px solid #E5E9EF', padding: '16px 24px' }}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '12px 0', fontWeight: 600,
                color: isActive(n.href) ? '#14B8A6' : '#0A2540',
                borderBottom: '1px solid #F1F5F9',
                borderLeft: isActive(n.href) ? '3px solid #14B8A6' : '3px solid transparent',
                paddingLeft: 12,
              }}
            >
              {n.label}
            </Link>
          ))}
          {MOBILE_EXTRAS.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '10px 0 10px 32px', fontWeight: 500,
                fontSize: 14,
                color: isActive(n.href) ? '#14B8A6' : '#475569',
                borderBottom: '1px solid #F1F5F9',
                borderLeft: isActive(n.href) ? '3px solid #14B8A6' : '3px solid transparent',
              }}
            >
              ↳ {n.label}
            </Link>
          ))}
          <Link href="/meet" onClick={() => setOpen(false)} className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}>
            Meet George or Georgia
          </Link>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        /* Base nav-link styling — full hover + tap responsiveness.
           Uses a soft teal wash background on hover so the button
           gives clear visual feedback the moment the cursor lands.
           The click flash (:active) also brightens the wash slightly
           so tapping feels tactile. */
        .nav-link {
          position: relative;
          color: #0A2540;
          font-weight: 600;
          font-size: 15px;
          padding: 10px 20px;
          border-radius: 10px;
          text-decoration: none;
          cursor: pointer;
          transition: color 140ms ease, background 140ms ease, transform 100ms ease;
        }
        .nav-link:hover {
          color: #0F766E;
          background: rgba(20, 184, 166, 0.08);
        }
        .nav-link:active {
          transform: translateY(1px);
          background: rgba(20, 184, 166, 0.14);
        }
        .nav-link:focus-visible {
          outline: 2px solid #14B8A6;
          outline-offset: 2px;
        }

        /* Subtle teal separator between adjacent nav items. Drawn via
           ::before as a 14 px vertical bar at 22 % opacity — visible
           enough to structure the row, quiet enough not to compete
           with the wordmark. Skipped on the first item so we do not
           create a leading rule. */
        .nav-link::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 1px;
          height: 14px;
          background: rgba(20, 184, 166, 0.22);
          pointer-events: none;
        }
        .nav-link[data-first]::before { display: none; }

        /* Teal underline on active page + hover-preview. Uses ::after
           so it never reflows layout — animates smoothly in from
           0 → 100 % width on hover, and stays fully drawn when active. */
        .nav-link::after {
          content: '';
          position: absolute;
          left: 50%;
          right: 50%;
          bottom: 2px;
          height: 2px;
          border-radius: 2px;
          background: rgba(20, 184, 166, 0.4);
          transition: left 220ms ease, right 220ms ease, background 180ms ease;
          pointer-events: none;
        }
        .nav-link:hover::after {
          left: 20px;
          right: 20px;
        }
        .nav-link-active {
          color: #0F766E !important;
        }
        .nav-link-active::after {
          left: 20px !important;
          right: 20px !important;
          background: #14B8A6 !important;
        }

        @media (max-width: 900px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-toggle { display: block !important; }
        }
      ` }} />
    </header>
  );
}

const NAV = [
  { label: 'About', href: '/about' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Features', href: '/features' },
  { label: 'Events', href: '/events' },
  { label: 'Stories', href: '/success-stories' },
  { label: 'FAQs', href: '/faqs' },
  { label: 'Contact', href: '/contact' },
];

// A small extra link surfaced only inside the mobile hamburger, so that
// organisations (RSLs, community groups, councils, libraries,
// retirement villages, sporting clubs) can find the event-submission
// entry without cluttering the desktop top-bar. Desktop users see the
// same option via the prominent CTA on /events and via the footer.
const MOBILE_EXTRAS = [
  { label: 'List an Event', href: '/list-your-event' },
];
