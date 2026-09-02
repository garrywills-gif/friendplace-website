'use client';

import { useEffect } from 'react';
import { campaignsApi } from '@/lib/cms-api';

const OUTREACH_DEFAULT = 'Dear [Contact name],';
const PRESETS = [
  { value: 'Dear [Contact name],', label: 'Dear [Contact name],' },
  { value: 'Hi [Contact name],', label: 'Hi [Contact name],' },
  { value: 'Hello [Contact name],', label: 'Hello [Contact name],' },
  { value: '', label: 'No greeting' },
] as const;

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findGreetingInput(): HTMLInputElement | null {
  const labels = Array.from(document.querySelectorAll('label'));
  const label = labels.find((el) =>
    (el.textContent || '').trim().startsWith('Greeting / Addressee'),
  );
  if (!label) return null;

  let node: Element | null = label.nextElementSibling;
  while (node) {
    if (node instanceof HTMLInputElement) return node;
    const nested = node.querySelector?.('input');
    if (nested instanceof HTMLInputElement) return nested;
    node = node.nextElementSibling;
  }
  return null;
}

function findTemplateSelect(): HTMLSelectElement | null {
  return (
    Array.from(document.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'community_outreach'),
    ) || null
  );
}

/**
 * Progressive UI enhancement for Community / Outreach campaigns.
 *
 * The core composer still owns the React greeting state and save payload.
 * This component swaps the free-text control for the four approved outreach
 * presets while writing every selection back through the original React input.
 * Nothing is saved until the composer Save / Send / Schedule action runs.
 */
export function CampaignGreetingPresetEnhancer() {
  useEffect(() => {
    let disposed = false;
    let savedGreeting: string | null | undefined;
    let savedGreetingLoaded = false;

    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      void campaignsApi
        .get(id)
        .then((campaign) => {
          savedGreeting = campaign.greeting;
          savedGreetingLoaded = true;
          sync();
        })
        .catch(() => {
          savedGreetingLoaded = true;
          sync();
        });
    } else {
      savedGreetingLoaded = true;
    }

    const sync = () => {
      if (disposed) return;
      const input = findGreetingInput();
      const templateSelect = findTemplateSelect();
      const existing = document.querySelector<HTMLSelectElement>(
        '[data-fp-outreach-greeting-presets="1"]',
      );

      if (!input || !templateSelect || templateSelect.value !== 'community_outreach') {
        existing?.remove();
        if (input) input.style.display = '';
        return;
      }

      if (!savedGreetingLoaded) return;

      const permitted = PRESETS.some((preset) => preset.value === input.value);
      let value = permitted ? input.value : OUTREACH_DEFAULT;

      // Legacy Outreach drafts with greeting=null/missing must visibly default
      // to Dear. An explicit saved empty string remains the real No greeting
      // choice and is never silently changed.
      if (id && (savedGreeting === null || typeof savedGreeting === 'undefined')) {
        value = OUTREACH_DEFAULT;
      } else if (id && typeof savedGreeting === 'string') {
        value = PRESETS.some((preset) => preset.value === savedGreeting)
          ? savedGreeting
          : OUTREACH_DEFAULT;
      } else if (!id && input.value === '') {
        value = OUTREACH_DEFAULT;
      }

      if (input.value !== value) setReactInputValue(input, value);
      input.style.display = 'none';

      let select = existing;
      if (!select) {
        select = document.createElement('select');
        select.dataset.fpOutreachGreetingPresets = '1';
        select.setAttribute('aria-label', 'Greeting / Addressee');
        select.style.width = '100%';
        select.style.boxSizing = 'border-box';
        select.style.padding = '10px 12px';
        select.style.border = '1px solid #CBD5E1';
        select.style.borderRadius = '10px';
        select.style.background = '#FFFFFF';
        select.style.color = '#0A2540';
        select.style.fontSize = '14px';

        for (const preset of PRESETS) {
          const option = document.createElement('option');
          option.value = preset.value;
          option.textContent = preset.label;
          select.appendChild(option);
        }

        select.addEventListener('change', () => {
          setReactInputValue(input, select!.value);
        });
        input.parentElement?.insertBefore(select, input);
      }
      select.value = value;
    };

    const onChange = () => queueMicrotask(sync);
    document.addEventListener('change', onChange, true);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();

    return () => {
      disposed = true;
      document.removeEventListener('change', onChange, true);
      observer.disconnect();
      document
        .querySelector<HTMLSelectElement>('[data-fp-outreach-greeting-presets="1"]')
        ?.remove();
      const input = findGreetingInput();
      if (input) input.style.display = '';
    };
  }, []);

  return null;
}
