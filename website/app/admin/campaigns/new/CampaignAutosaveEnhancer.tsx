'use client';

import { useEffect } from 'react';

const APPLY_KEY = 'friendplace.mcgs.campaignTemplateToApply.v1';
const AUTOSAVE_DELAY_MS = 900;
const CAMPAIGN_SAVED_EVENT = 'friendplace:campaign-saved';

function findSaveButton(): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find(button =>
    (button.textContent || '').trim() === 'Save draft',
  ) as HTMLButtonElement | null;
}

function isComposerActionButton(button: HTMLButtonElement): boolean {
  const text = (button.textContent || '').trim();
  return (
    text === 'Save draft' ||
    text === 'Saving…' ||
    text.startsWith('Send campaign') ||
    text.startsWith('⏰ Schedule') ||
    text === 'Cancel' ||
    text === 'Open PDF' ||
    text === 'Remove'
  );
}

function isCampaignCreateRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, window.location.origin);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return method === 'POST' && /\/api\/cms\/campaigns\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function publishCampaignId(id: string) {
  if (!id) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL sync is best-effort; the event below is what sibling controls consume.
  }
  window.dispatchEvent(new CustomEvent(CAMPAIGN_SAVED_EVENT, { detail: { id } }));
}

export function CampaignAutosaveEnhancer() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // Capture the id from the very first campaign create. The composer already
    // keeps it in React state, but sibling Review/Test controls used to know only
    // ids that were present in the URL when the page first loaded. Publishing the
    // new id here lets those controls work immediately after Save Draft.
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const shouldCapture = isCampaignCreateRequest(input, init);
      const response = await originalFetch(input, init);
      if (shouldCapture && response.ok) {
        try {
          const payload = await response.clone().json();
          const id = String(payload?.id || '').trim();
          if (id) publishCampaignId(id);
        } catch {
          // Never interfere with a successful save because id capture failed.
        }
      }
      return response;
    };
    window.fetch = wrappedFetch;

    const runSave = () => {
      timer = null;
      if (stopped) return;
      const button = findSaveButton();
      if (!button || button.disabled) return;
      button.click();
    };

    const schedule = (reset = true) => {
      if (stopped) return;
      if (timer && reset) clearTimeout(timer);
      if (!timer || reset) timer = setTimeout(runSave, AUTOSAVE_DELAY_MS);
    };

    const onInputOrChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest('main, [role="main"], body')) return;

      let applyingTemplate = false;
      try {
        applyingTemplate = !event.isTrusted && Boolean(window.sessionStorage.getItem(APPLY_KEY));
      } catch {
        // sessionStorage is best-effort only.
      }
      schedule(!applyingTemplate);
    };

    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null;
      if (!button || isComposerActionButton(button)) return;
      schedule(true);
    };

    document.addEventListener('input', onInputOrChange, true);
    document.addEventListener('change', onInputOrChange, true);
    document.addEventListener('click', onClick, true);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      document.removeEventListener('input', onInputOrChange, true);
      document.removeEventListener('change', onInputOrChange, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}
