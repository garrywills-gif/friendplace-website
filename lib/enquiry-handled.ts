'use client';

import { API_BASE } from './api-base';
import { clearAuth, getToken } from './cms-auth';

const STORAGE_KEY = 'friendplace:handled-enquiries:v1';
export const ENQUIRY_HANDLED_EVENT = 'friendplace:enquiry-handled';

type EnquiryKind = 'contact' | 'interest' | 'support' | 'report' | 'waitlist';
type EnquiryStatus = 'new' | 'read' | 'replied' | 'resolved';
type EnquiryListRow = { id?: string | null; kind?: EnquiryKind; status?: EnquiryStatus | string };

let hydrationStarted = false;

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

function writeIds(ids: Iterable<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
  } catch {
    // Local storage is now only an optimistic UI cache; the backend is authoritative.
  }
}

function dispatchHandled(id?: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ENQUIRY_HANDLED_EVENT, { detail: { id } }));
}

async function cmsFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (res.status === 401) clearAuth();
  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed (${res.status})`;
    try {
      const json = text ? JSON.parse(text) : {};
      message = json?.detail || json?.error || message;
    } catch {
      // Keep the plain-text response.
    }
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  return res;
}

async function listRows(archived: boolean): Promise<EnquiryListRow[]> {
  const res = await cmsFetch(`/cms/enquiries?archived=${archived ? 'true' : 'false'}&limit=500`);
  const json = await res.json();
  return Array.isArray(json?.rows) ? json.rows : [];
}

async function findKindForId(id: string): Promise<EnquiryKind | null> {
  const active = await listRows(false);
  const activeMatch = active.find((row) => row.id === id && row.kind);
  if (activeMatch?.kind) return activeMatch.kind;

  const archived = await listRows(true);
  const archivedMatch = archived.find((row) => row.id === id && row.kind);
  return archivedMatch?.kind || null;
}

export async function setEnquiryStatus(
  kind: EnquiryKind,
  id: string,
  status: EnquiryStatus,
): Promise<void> {
  await cmsFetch(
    `/cms/enquiries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  );

  const ids = new Set(readIds());
  if (status === 'replied' || status === 'resolved') ids.add(id);
  else ids.delete(id);
  writeIds(ids);
  dispatchHandled(id);
}

export async function refreshHandledEnquiriesFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const rows = await listRows(false);
    const handled = rows
      .filter((row) => row.id && (row.status === 'replied' || row.status === 'resolved'))
      .map((row) => row.id as string);

    // Once the server answers successfully it is the source of truth, so replace
    // any stale browser-only state left over from the old implementation.
    writeIds(handled);
    dispatchHandled();
  } catch (error) {
    // Keep the existing optimistic cache if the backend is temporarily unavailable.
    console.warn('Could not refresh enquiry handled state from server', error);
  }
}

function ensureServerHydration() {
  if (hydrationStarted || typeof window === 'undefined') return;
  hydrationStarted = true;
  void refreshHandledEnquiriesFromServer();
}

export function handledEnquiryIds(): Set<string> {
  ensureServerHydration();
  return new Set(readIds());
}

export function isEnquiryHandled(id?: string | null): boolean {
  return !!id && handledEnquiryIds().has(id);
}

export function markEnquiryHandled(id?: string | null): void {
  if (!id || typeof window === 'undefined') return;

  // Keep the UI instant, then persist the same transition server-side.
  const ids = handledEnquiryIds();
  ids.add(id);
  writeIds(ids);
  dispatchHandled(id);

  void (async () => {
    try {
      const kind = await findKindForId(id);
      if (!kind) throw new Error(`Could not determine enquiry kind for ${id}`);
      await setEnquiryStatus(kind, id, 'replied');
    } catch (error) {
      console.warn('Could not persist enquiry replied status', error);
      // Reconcile with the backend on the next page load/refresh instead of
      // treating a persistence failure as an email-send failure.
    }
  })();
}
