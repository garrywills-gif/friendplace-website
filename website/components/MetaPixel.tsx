'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const PIXEL_ID = '4256953884595956';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export default function MetaPixel() {
  const pathname = usePathname();
  const firstPathRender = useRef(true);

  // The base Meta snippet in app/layout.tsx records the first PageView.
  // Record later client-side Next.js navigations as additional PageViews.
  useEffect(() => {
    if (firstPathRender.current) {
      firstPathRender.current = false;
      return;
    }
    window.fbq?.('track', 'PageView');
  }, [pathname]);

  // Registration stays on /register-interest after a successful submit,
  // so there is no thank-you URL for Meta to watch. Detect the successful
  // production API response instead and fire the standard Lead event only
  // after the backend has accepted the registration.
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      try {
        const input = args[0];
        const init = args[1];
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

        if (
          method === 'POST' &&
          url.includes('/api/public/register-interest') &&
          response.ok
        ) {
          window.fbq?.('track', 'Lead');
        }
      } catch {
        // Tracking must never interfere with the registration experience.
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <noscript>
      <img
        height="1"
        width="1"
        style={{ display: 'none' }}
        src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        alt=""
      />
    </noscript>
  );
}
