'use client';

import { useEffect, useState } from 'react';

export default function PreviewDiagnostics() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      try {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        const isPreviewCall = url.includes('/cms/campaigns/') &&
          (url.includes('/render-preview') || url.includes('/preview-audience'));

        if (isPreviewCall) {
          if (response.ok) {
            setMessage('');
          } else {
            const clone = response.clone();
            let detail = '';
            try {
              const data = await clone.json();
              detail = data?.detail || data?.error || data?.message || '';
            } catch {
              detail = await clone.text().catch(() => '');
            }
            setMessage(detail || `Preview request failed (${response.status})`);
          }
        }
      } catch {
        // Diagnostics must never interfere with the composer itself.
      }
      return response;
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch as typeof window.fetch;
    };
  }, []);

  if (!message) return null;

  return (
    <div style={{
      margin: '0 0 16px',
      padding: '12px 14px',
      borderRadius: 12,
      border: '1px solid #FCA5A5',
      background: '#FEF2F2',
      color: '#991B1B',
      fontSize: 13,
      lineHeight: 1.5,
      fontWeight: 700,
    }}>
      Preview error: {message}
    </div>
  );
}
