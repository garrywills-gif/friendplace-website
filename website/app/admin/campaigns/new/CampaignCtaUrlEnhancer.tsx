'use client';

import { useEffect } from 'react';

/**
 * Keeps the Campaign Composer CTA field friendly: admins can type
 * `friendplace.com.au/...` and the composer stores `https://friendplace.com.au/...`.
 * Empty remains genuinely empty so an optional CTA is not accidentally saved.
 */
export function CampaignCtaUrlEnhancer() {
  useEffect(() => {
    const selector = 'input[placeholder="https://…"]';
    const bound = new WeakSet<HTMLInputElement>();

    const bind = (input: HTMLInputElement) => {
      if (bound.has(input)) return;
      bound.add(input);

      input.placeholder = 'https://';
      input.setAttribute('inputmode', 'url');
      input.setAttribute('autocomplete', 'url');

      const normalise = (event: Event) => {
        const el = event.target as HTMLInputElement;
        const raw = el.value.trimStart();
        if (!raw) return;

        if (/^https:\/\//i.test(raw)) return;

        // If somebody pastes an http:// URL, upgrade it rather than
        // producing https://http://… . Otherwise prepend the permanent
        // secure scheme automatically.
        const next = /^http:\/\//i.test(raw)
          ? `https://${raw.replace(/^http:\/\//i, '')}`
          : `https://${raw}`;

        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(el, next);
      };

      // Capture phase means React's controlled onChange receives the
      // already-normalised URL and saves the full https:// value.
      input.addEventListener('input', normalise, true);
    };

    const scan = () => {
      document.querySelectorAll<HTMLInputElement>(selector).forEach(bind);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
