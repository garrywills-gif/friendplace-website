'use client';

import { useEffect } from 'react';

const APPLY_KEY = 'friendplace.mcgs.campaignTemplateToApply.v1';

type PendingTemplate = {
  returnTo?: string;
  subject?: string;
  body?: string;
  body_html?: string;
};

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function fieldAfterLabel(labelText: string, selector: 'input' | 'textarea') {
  const label = Array.from(document.querySelectorAll('label'))
    .find(node => (node.textContent || '').trim() === labelText);
  if (!label) return null;

  let node = label.nextElementSibling;
  while (node) {
    if (node.matches(selector)) return node as HTMLInputElement | HTMLTextAreaElement;
    const nested = node.querySelector?.(selector);
    if (nested) return nested as HTMLInputElement | HTMLTextAreaElement;
    if (node.tagName === 'LABEL') break;
    node = node.nextElementSibling;
  }
  return null;
}

export function CampaignTemplateApplyEnhancer() {
  useEffect(() => {
    let pending: PendingTemplate | null = null;
    try {
      const raw = window.sessionStorage.getItem(APPLY_KEY);
      if (!raw) return;
      pending = JSON.parse(raw) as PendingTemplate;
    } catch {
      return;
    }

    const current = `${window.location.pathname}${window.location.search}`;
    if (pending.returnTo && pending.returnTo !== current) return;

    let attempts = 0;
    let successfulApplies = 0;
    let stopped = false;

    const apply = () => {
      if (stopped) return;
      attempts += 1;

      const subjectInput = fieldAfterLabel('Subject', 'input') as HTMLInputElement | null;
      const bodyTextarea = fieldAfterLabel('Body', 'textarea') as HTMLTextAreaElement | null;

      if (subjectInput && bodyTextarea) {
        // Existing campaigns hydrate asynchronously. An earlier version applied
        // the selected template as soon as the fields mounted, then the saved
        // draft arrived and overwrote it. Re-apply for a short settling window
        // so the selected template is the final state.
        setNativeValue(subjectInput, pending?.subject || '');
        setNativeValue(bodyTextarea, pending?.body || '');
        successfulApplies += 1;
      }

      // Keep applying for ~4 seconds. This comfortably covers normal draft
      // hydration without leaving a persistent background loop.
      if (attempts < 40) {
        window.setTimeout(apply, 100);
        return;
      }

      stopped = true;
      if (successfulApplies > 0) {
        try {
          window.sessionStorage.removeItem(APPLY_KEY);
        } catch {
          // Best effort only.
        }
      }
    };

    window.setTimeout(apply, 0);

    return () => {
      stopped = true;
    };
  }, []);

  return null;
}
