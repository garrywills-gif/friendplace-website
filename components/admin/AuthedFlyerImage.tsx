'use client';

/**
 * AuthedFlyerImage — renders a flyer preview thumbnail from an
 * authenticated backend endpoint.
 *
 * WHY: the `/api/cms/flyer-templates/{key}/render` endpoint sits
 * behind CMS admin Bearer auth, and a plain `<img src="…" />` cannot
 * attach the `Authorization` header — the browser fires that request
 * without credentials and gets a 401. Result before this component:
 * every dynamically-rendered flyer thumbnail appeared as a broken
 * image icon in the Flyer Publishing Centre (Garry, 5 Aug 2026 QA).
 *
 * FIX: fetch the render bytes with the admin token attached, wrap in
 * a Blob, and hand back an object URL for the `<img>` tag. Cleans up
 * the object URL on unmount / dep-change so we don't leak memory when
 * the grid re-renders.
 *
 * Static thumbnails (e.g. `community_notice` → `/flyer-mockups/…`)
 * remain the caller's responsibility — this component is purely for
 * the authenticated render endpoint.
 */

import { useEffect, useState } from 'react';
import { flyersApi } from '@/lib/cms-api';

type Props = {
  templateKey: string;
  layout: string;
  alt: string;
  fields?: Record<string, string | undefined>;
  className?: string;
  style?: React.CSSProperties;
  /** Fired when the fetch fails so the caller can surface a fallback. */
  onError?: (message: string) => void;
};

export function AuthedFlyerImage({
  templateKey,
  layout,
  alt,
  fields,
  className,
  style,
  onError,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let current: string | null = null;
    setStatus('loading');
    setUrl(null);

    (async () => {
      try {
        const res = await flyersApi.renderBlob(templateKey, { layout, fields });
        if (cancelled) {
          URL.revokeObjectURL(res.url);
          return;
        }
        current = res.url;
        setUrl(res.url);
        setStatus('ready');
      } catch (e: any) {
        if (!cancelled) {
          setStatus('error');
          onError?.(e?.message || 'Preview could not be loaded');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
    // Rebuild whenever the identity of the render changes. Serialising
    // `fields` keeps the effect stable across renders with the same
    // input dict; keys not present in the object have no effect.
  }, [templateKey, layout, JSON.stringify(fields ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'error') {
    return (
      <div
        role="img"
        aria-label={`${alt} — preview unavailable`}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FEF2F2',
          color: '#7F1D1D',
          fontSize: 12,
          fontWeight: 600,
          padding: 12,
          textAlign: 'center',
          ...style,
        }}
        className={className}
      >
        Preview unavailable
      </div>
    );
  }

  if (!url) {
    return (
      <div
        role="img"
        aria-label={`${alt} — loading preview`}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F1F5F9',
          color: '#64748B',
          fontSize: 12,
          fontWeight: 600,
          ...style,
        }}
        className={className}
      >
        Loading preview…
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }}
      className={className}
    />
  );
}
