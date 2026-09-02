'use client';

import { useEffect } from 'react';

const APPLY_KEY = 'friendplace.mcgs.campaignTemplateToApply.v1';
const AUTOSAVE_DELAY_MS = 900;

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

export function CampaignAutosaveEnhancer() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

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

      // Template application fires synthetic input/change events repeatedly for
      // a few seconds. Schedule once instead of continually pushing the save
      // further away; normal typing still uses the usual debounce behaviour.
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

      // Signer choices, audience-mode buttons, status chips and similar
      // composer controls store their change in React state via button clicks.
      schedule(true);
    };

    document.addEventListener('input', onInputOrChange, true);
    document.addEventListener('change', onInputOrChange, true);
    document.addEventListener('click', onClick, true);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('input', onInputOrChange, true);
      document.removeEventListener('change', onInputOrChange, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}
