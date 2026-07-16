import Link from 'next/link';
import Butterfly from './Butterfly';
import { site } from '@/lib/brand';

/**
 * Site footer — dark-navy band with brand promise, sitemap, and legal
 * links. Signals "real, trustworthy company" without being corporate.
 */
export default function SiteFooter() {
  return (
    <footer style={{ background: '#0A2540', color: '#CBD5E1', marginTop: 96 }}>
      <div className="container" style={{ padding: '64px 24px 32px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 40,
            marginBottom: 48,
          }}
        >
          {/* Brand column */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Butterfly size={28} color="#5EEAD4" />
              <span style={{ fontWeight: 900, fontSize: 20, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
                Friend<span style={{ color: '#5EEAD4' }}>Place</span>
              </span>
            </div>
            <p style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
              {site.tagline}
            </p>
            <p style={{ color: '#64748B', fontSize: 13 }}>Made in Australia 🇦🇺</p>
          </div>

          <FooterCol title="Product" links={[
            { label: 'About', href: '/about' },
            { label: 'How It Works', href: '/how-it-works' },
            { label: 'Features', href: '/features' },
            { label: 'FAQs', href: '/faqs' },
          ]} />
          <FooterCol title="Community" links={[
            { label: 'Founding Members', href: '/#founders' },
            { label: 'Success Stories', href: '/#stories' },
            { label: 'Contact Us', href: '/contact' },
          ]} />
          <FooterCol title="Legal" links={[
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
          ]} />
        </div>

        <div
          style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
            alignItems: 'center', gap: 12,
            paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: 13, color: '#64748B',
          }}
        >
          <span>© {new Date().getFullYear()} FriendPlace. All rights reserved.</span>
          <span>{site.emailContact}</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 800, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </h4>
      <ul style={{ listStyle: 'none' }}>
        {links.map((l) => (
          <li key={l.href} style={{ marginBottom: 10 }}>
            <Link href={l.href} style={{ color: '#CBD5E1', fontSize: 14 }}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
