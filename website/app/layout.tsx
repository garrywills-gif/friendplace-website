import type { Metadata } from 'next';
import { site } from '@/lib/brand';
import './globals.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

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
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  themeColor: '#0A2540',
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
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
