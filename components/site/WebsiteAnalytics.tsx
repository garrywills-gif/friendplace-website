'use client';

import { Analytics } from '@vercel/analytics/next';
import { usePathname } from 'next/navigation';

/** Count marketing visits without including MCGS activity or URL query values. */
export default function WebsiteAnalytics() {
  const pathname = usePathname();
  if (!pathname || pathname === '/admin' || pathname.startsWith('/admin/')) return null;

  return <Analytics beforeSend={(event) => {
    const url = new URL(event.url, 'https://www.friendplace.com.au');
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return null;
    // Registration resume links can contain private identifiers. Only send the path.
    if (url.pathname.includes('/rsvp/')) return null;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  }} />;
}
