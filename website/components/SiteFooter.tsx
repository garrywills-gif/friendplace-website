'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { brandAssets } from '@/lib/brand-assets';
import { site } from '@/lib/brand';
import SecretAdminTrigger from './SecretAdminTrigger';

/**
 * Rich site footer — dark navy band matching the invite flyer.
 *
 * Layout (top → bottom):
 *   • Brand block: butterfly + wordmark + tagline + strapline
 *   • Sitemap columns: Product / Community / Legal / Contact
 *   • Legal line: copyright + "Made in Australia"
 *
 * All copy here is currently hardcoded but is CMS-ready — Mini-CMS
 * will surface the same tagline / strapline / email fields.
 */
export default function SiteFooter() {
  const pathname = usePathname();
  // Hide on Mini-CMS admin routes (which have their own shell).
  if (pathname?.startsWith('/admin')) return null;
  return (
    <footer style={{ background: '#0A2540', color: '#CBD5E1', marginTop: 96 }}>
      <div className="container" style={{ padding: '72px 24px 32px' }}>
        {/* Top brand block — butterfly + tagline + strapline */}
        <div style={{ textAlign: 'center', marginBottom: 56, paddingBottom: 48, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <SecretAdminTrigger>
              <img
                src={brandAssets.butterfly.src}
                alt={brandAssets.butterfly.alt}
                width={brandAssets.butterfly.width}
                height={brandAssets.butterfly.height}
                draggable={false}
                style={{ width: 44, height: 'auto', display: 'block' }}
              />
            </SecretAdminTrigger>
            <span style={{ fontWeight: 900, fontSize: 28, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
              Friend<span style={{ color: '#5EEAD4' }}>Place</span>
            </span>
          </div>
          {/* Tagline — the anchor. Bold + white so it sits above the
              strapline in the visual hierarchy. */}
          <p style={{ color: '#FFFFFF', fontSize: 20, fontWeight: 800, marginBottom: 14, letterSpacing: '-0.01em' }}>
            {site.tagline}
          </p>
          {/* Strapline — promoted to a proper brand line. Larger, teal-
              tinted, non-italic so it reads as a real brand promise
              rather than a caption. */}
          <p style={{
            color: '#5EEAD4',
            fontSize: 18,
            fontWeight: 600,
            maxWidth: 560,
            margin: '0 auto',
            letterSpacing: '0.005em',
          }}>
            Finding your people, one friendship at a time.
          </p>
        </div>

        {/* Sitemap columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 40, marginBottom: 48,
        }}>
          <FooterCol title="Product" links={[
            { label: 'About', href: '/about' },
            { label: 'How It Works', href: '/how-it-works' },
            { label: 'Features', href: '/features' },
            { label: 'FAQs', href: '/faqs' },
          ]} />
          <FooterCol title="Events" links={[
            { label: 'Browse events', href: '/events' },
            { label: 'List an event', href: '/list-your-event' },
          ]} />
          <FooterCol title="Community" links={[
            { label: 'Founding Members', href: '/#founders' },
            { label: 'Success Stories', href: '/#stories' },
            { label: 'Get the App', href: '/#download' },
          ]} />
          <FooterCol title="Legal" links={[
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
          ]} />
          <FooterCol title="Contact" links={[
            { label: site.emailContact, href: `mailto:${site.emailContact}` },
            { label: 'Contact form', href: '/contact' },
            { label: 'www.friendplace.com.au', href: site.urlProduction },
          ]} />
        </div>

        {/* Bottom legal line */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
          alignItems: 'center', gap: 12,
          paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: 13, color: '#64748B',
        }}>
          <span>© {new Date().getFullYear()} FriendPlace. All rights reserved.</span>
          <span>Made with warmth in Australia 🇦🇺</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 style={{
        color: '#FFFFFF', fontSize: 13, fontWeight: 800,
        marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
        {title}
      </h4>
      <ul style={{ listStyle: 'none' }}>
        {links.map((l) => (
          <li key={l.href + l.label} style={{ marginBottom: 10 }}>
            <Link href={l.href} style={{ color: '#CBD5E1', fontSize: 14, transition: 'color 160ms' }}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
