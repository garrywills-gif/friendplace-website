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
    const apply = () => {
      attempts += 1;
      const subjectInput = fieldAfterLabel('Subject', 'input') as HTMLInputElement | null;
      const bodyTextarea = fieldAfterLabel('Body', 'textarea') as HTMLTextAreaElement | null;

      if (!subjectInput || !bodyTextarea) {
        if (attempts < 50) window.setTimeout(apply, 100);
        return;
      }

      setNativeValue(subjectInput, pending?.subject || '');
      setNativeValue(bodyTextarea, pending?.body || '');

      try {
        window.sessionStorage.removeItem(APPLY_KEY);
      } catch {
        // Best effort only.
      }
    };

    window.setTimeout(apply, 0);
  }, []);

  return null;
}
