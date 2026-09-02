'use client';

import { useEffect } from 'react';

const APPLY_KEY = 'friendplace.mcgs.campaignTemplateToApply.v1';
const SUBJECT_PLACEHOLDER = 'Leave blank to use the template default';
const BODY_PLACEHOLDER = 'Write the letter. Blank lines start new paragraphs.';

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

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof HTMLElement)) return '';

  const tag = node.tagName.toLowerCase();
  const children = () => Array.from(node.childNodes).map(nodeToMarkdown).join('');

  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') {
    const inner = children();
    return inner ? `**${inner}**` : '';
  }
  if (tag === 'em' || tag === 'i') {
    const inner = children();
    return inner ? `*${inner}*` : '';
  }
  if (tag === 'a') {
    const inner = children();
    const href = node.getAttribute('href') || '';
    return href && inner ? `[${inner}](${href})` : inner;
  }
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(node.children)
      .filter(child => child.tagName.toLowerCase() === 'li')
      .map(child => `- ${Array.from(child.childNodes).map(nodeToMarkdown).join('').replace(/\u00a0/g, ' ').trim()}`)
      .filter(line => line !== '- ');
    return items.length ? `${items.join('\n')}\n\n` : '';
  }
  if (tag === 'li') return children();

  if (
    tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' ||
    tag === 'blockquote' || tag === 'header' || tag === 'footer'
  ) {
    const inner = children().replace(/\u00a0/g, ' ').trim();
    return inner ? `${inner}\n\n` : '\n\n';
  }

  return children();
}

function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes)
    .map(nodeToMarkdown)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    const subjectValue = pending.subject || '';
    const bodyValue = pending.body_html
      ? htmlToMarkdown(pending.body_html)
      : (pending.body || '');

    let attempts = 0;
    let successfulApplies = 0;
    let stopped = false;

    const apply = () => {
      if (stopped) return;
      attempts += 1;

      const subjectInput = document.querySelector(
        `input[placeholder="${SUBJECT_PLACEHOLDER}"]`,
      ) as HTMLInputElement | null;
      const bodyTextarea = document.querySelector(
        `textarea[placeholder="${BODY_PLACEHOLDER}"]`,
      ) as HTMLTextAreaElement | null;

      if (subjectInput) {
        setNativeValue(subjectInput, subjectValue);
      }
      if (bodyTextarea) {
        setNativeValue(bodyTextarea, bodyValue);
      }
      if (subjectInput && bodyTextarea) {
        successfulApplies += 1;
      }

      // Existing drafts hydrate asynchronously. Keep the selected template
      // authoritative for a short settling window so saved draft values cannot
      // overwrite it after returning from the Templates page.
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
