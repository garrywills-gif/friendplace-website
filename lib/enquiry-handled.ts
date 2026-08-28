'use client';

const STORAGE_KEY = 'friendplace:handled-enquiries:v1';
export const ENQUIRY_HANDLED_EVENT = 'friendplace:enquiry-handled';

function readIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function handledEnquiryIds(): Set<string> {
  return new Set(readIds());
}

export function isEnquiryHandled(id?: string | null): boolean {
  return !!id && handledEnquiryIds().has(id);
}

export function markEnquiryHandled(id?: string | null): void {
  if (!id || typeof window === 'undefined') return;
  const ids = handledEnquiryIds();
  ids.add(id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // The email was already sent; storage failure must never turn that into a send failure.
  }
  window.dispatchEvent(new CustomEvent(ENQUIRY_HANDLED_EVENT, { detail: { id } }));
}
