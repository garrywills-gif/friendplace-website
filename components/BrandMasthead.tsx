import Link from 'next/link';
import { brandAssets } from '@/lib/brand-assets';
import { site } from '@/lib/brand';

/** Brand strip with the tagline beneath the wordmark on every screen size. */
export default function BrandMasthead() {
  return (
    <section
      aria-label="FriendPlace brand"
      style={{
        background: 'linear-gradient(90deg, #071A31 0%, #0A2540 55%, #12365B 100%)',
        color: '#FFFFFF',
        borderBottom: '1px solid rgba(94,234,212,0.15)',
      }}
    >
      <div
        className="container masthead-inner"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          minHeight: 80,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        {/* Butterfly + wordmark + tagline (always visible) */}
        <Link
          href="/"
          className="masthead-brand"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            textDecoration: 'none',
            flex: 1,
            minWidth: 0,
          }}
        >
          <img
            src={brandAssets.butterfly.src}
            alt={brandAssets.butterfly.alt}
            width={brandAssets.butterfly.width}
            height={brandAssets.butterfly.height}
            className="masthead-butterfly"
            style={{ width: 44, height: 'auto', display: 'block', flexShrink: 0 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
            <span
              className="masthead-wordmark"
              style={{
                fontSize: 26,
                fontWeight: 900,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              Friend<span style={{ color: '#5EEAD4' }}>Place</span>
            </span>
            <span
              className="masthead-tagline"
              style={{
                fontSize: 16,
                lineHeight: 1.4,
                fontWeight: 500,
                color: '#CBD5E1',
                letterSpacing: '0.01em',
              }}
            >
              {site.tagline}
            </span>
          </div>
        </Link>

        {/* Contact info — hidden on mobile so the strip stays clean */}
        <div className="masthead-contact" style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
          <a
            href={`mailto:${site.emailContact}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#CBD5E1',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <IconMail />
            <span>{site.emailContact}</span>
          </a>
          <a
            href={site.urlProduction}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#CBD5E1',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <IconGlobe />
            <span>friendplace.com.au</span>
          </a>
        </div>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .masthead-contact { display: none !important; }
        }
        @media (max-width: 520px) {
          .masthead-wordmark { font-size: 24px !important; }
          .masthead-butterfly { width: 40px !important; }
        }
        .masthead-brand:hover .masthead-wordmark {
          text-shadow: 0 0 12px rgba(94,234,212,0.35);
          transition: text-shadow 200ms ease;
        }
      `}</style>
    </section>
  );
}

/* Inline monoline icons — a tiny mail + globe glyph. Kept inline so no
   third-party icon package is needed just for two shapes. */
function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" stroke="#5EEAD4" strokeWidth="1.6" />
      <path d="m3 8 9 6 9-6" stroke="#5EEAD4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#5EEAD4" strokeWidth="1.6" />
      <path d="M3 12h18M12 3c2.5 2.6 4 6 4 9s-1.5 6.4-4 9M12 3c-2.5 2.6-4 6-4 9s1.5 6.4 4 9" stroke="#5EEAD4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
