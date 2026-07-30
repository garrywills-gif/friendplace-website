import type { Metadata, Viewport } from 'next';
import { site } from '@/lib/brand';
import './globals.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { CompanionProvider } from '@/lib/companion-context';
import { ConciergeOverlay } from '@/components/site/ConciergeOverlay';

export const metadata: Metadata = {
  metadataBase: new URL(site.urlProduction),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  keywords: [
    'FriendPlace',
    'friendship app Australia',
    'community app',
    'make new friends',
    'local meetups',
    'belonging',
    'social community',
  ],
  authors: [{ name: 'FriendPlace' }],
  // Pre-launch privacy: force noindex on EVERY page unless the Vercel
  // env var FRIENDPLACE_INDEXABLE is explicitly set to "true". Combined
  // with robots.txt + X-Robots-Tag header this makes three layers of
  // defence — the site cannot be crawled or listed until launch.
  robots:
    process.env.FRIENDPLACE_INDEXABLE === 'true'
      ? { index: true, follow: true }
      : {
          index: false,
          follow: false,
          nocache: true,
          googleBot: { index: false, follow: false, noimageindex: true },
        },
  openGraph: {
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: site.urlProduction,
    siteName: site.name,
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  icons: {
    icon: '/brand-assets/favicon.png',
    apple: '/brand-assets/favicon.png',
  },
};

// Next.js 14 wants viewport-related fields in a separate `viewport`
// export (rather than the deprecated position inside `metadata`). Kept
// here so the browser tab colour matches our navy brand.
export const viewport: Viewport = {
  themeColor: '#0A2540',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        {/* Public Sans — our closest free web equivalent of the mobile
            app's Plus Jakarta Sans. Preconnect keeps first paint fast. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CompanionProvider>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
          {/* Concierge overlay — a global welcome that any surface can
              summon by dispatching `friendplace:meet-george`. Renders
              nothing until invited. */}
          <ConciergeOverlay />
        </CompanionProvider>
      </body>
    </html>
  );
}
