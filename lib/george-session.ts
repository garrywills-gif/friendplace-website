'use client';

/**
 * George conversation store — session-scoped continuity.
 *
 * Behaviour matrix (Batch 3 conversation continuity, agreed with Garry):
 *   ✅ Minimise        → retain
 *   ✅ Close (×)       → retain            (was: cleared)
 *   ✅ Page navigation → retain            (was: cleared on re-mount)
 *   ✅ Same login      → retain
 *   ❌ Logout          → clear
 *   ❌ "New conversation" button → clear (with confirm dialog)
 *
 * We deliberately use `sessionStorage`, not `localStorage`:
 * a fresh browser tab / new login should start clean, but hitting Close
 * or navigating between /admin/bridge and /admin/events must not lose
 * Garry's working conversation.
 *
 * The store is namespaced by admin id so two admins on the same machine
 * (or Garry logging in as a different account) never see each other's
 * transcript.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAdmin } from './cms-auth';

// ─── Shape ──────────────────────────────────────────────────────────────
//
// We persist a superset of the sheet's local Turn type so previews,
// plan/tool traces, and failure flags survive Close → reopen just like
// the plain transcript does. Anything set to `streaming: true` at write
// time is rewritten to `streaming: false` on read: mid-stream nav means
// that turn will render as a normal (non-cursor-flashing) bubble when
// Garry comes back.

export type GeorgeTurn = {
  role: 'user' | 'george';
  content: string;
  ts?: number;
  streaming?: boolean;
  failed?: boolean;
  plan?: unknown;
  results?: unknown;
  previews?: unknown;
};

type Snapshot = {
  chatId: string | null;
  turns: GeorgeTurn[];
  updatedAt: number;
};

const EMPTY: Snapshot = { chatId: null, turns: [], updatedAt: 0 };

// ─── Storage keys ──────────────────────────────────────────────────────

/** Legacy key from Batch-2 (single-tenant). We migrate on first read. */
const LEGACY_KEY = 'fp_george_conv';

function storageKey(adminId: string | null | undefined): string {
  // Anonymous fallback exists so a logged-out edge case still stores
  // something in memory rather than throwing — never persisted to disk.
  return `fp_george_conv:${adminId || 'anon'}`;
}

// ─── Read / write ──────────────────────────────────────────────────────

function safeRead(adminId: string | null | undefined): Snapshot {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const key = storageKey(adminId);
    let raw = window.sessionStorage.getItem(key);
    // One-time migration from the un-scoped legacy key.
    if (!raw) {
      const legacy = window.sessionStorage.getItem(LEGACY_KEY);
      if (legacy) {
        window.sessionStorage.setItem(key, legacy);
        window.sessionStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Snapshot;
    // Guard: only accept the expected shape so garbage doesn't crash us.
    if (!parsed || !Array.isArray(parsed.turns)) return EMPTY;
    // If a stream was interrupted (Close / nav mid-reply), rehydrate the
    // turn as a settled bubble rather than a perpetually-blinking cursor.
    for (const t of parsed.turns) {
      if (t && t.streaming) t.streaming = false;
    }
    return parsed;
  } catch {
    return EMPTY;
  }
}

function safeWrite(adminId: string | null | undefined, snap: Snapshot) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(adminId), JSON.stringify(snap));
  } catch {
    /* quota exceeded / storage blocked \u2014 in-memory copy is still fine */
  }
}

// ─── Cross-component sync ──────────────────────────────────────────────
//
// Multiple components can observe the same conversation at once (the
// sheet, the minimise pill\u2019s unread dot, any future notification
// surface). We use a tiny pub/sub so a `setTurns()` in the sheet is
// reflected everywhere without a full context tree.

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() { listeners.forEach(l => l()); }

// ─── Public API ────────────────────────────────────────────────────────

/**
 * React hook: snapshot of the George conversation for the current admin.
 * All setters go through here so every mount stays in sync.
 */
export function useGeorgeSession() {
  const adminId = typeof window !== 'undefined' ? getAdmin()?.id ?? null : null;
  const [snap, setSnap] = useState<Snapshot>(() => safeRead(adminId));

  // Subscribe to cross-component updates.
  useEffect(() => {
    const l: Listener = () => setSnap(safeRead(adminId));
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [adminId]);

  // Re-hydrate whenever we regain focus \u2014 covers the case where an
  // admin has two tabs open and clears in one; the other tab picks it up
  // the next time it comes to the foreground.
  useEffect(() => {
    const onFocus = () => setSnap(safeRead(adminId));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [adminId]);

  const setTurns = useCallback((updater: GeorgeTurn[] | ((prev: GeorgeTurn[]) => GeorgeTurn[])) => {
    const current = safeRead(adminId);
    const next = typeof updater === 'function' ? (updater as any)(current.turns) : updater;
    const merged: Snapshot = { ...current, turns: next, updatedAt: Date.now() };
    safeWrite(adminId, merged);
    setSnap(merged);
    notify();
  }, [adminId]);

  const setChatId = useCallback((id: string | null) => {
    const current = safeRead(adminId);
    const merged: Snapshot = { ...current, chatId: id, updatedAt: Date.now() };
    safeWrite(adminId, merged);
    setSnap(merged);
    notify();
  }, [adminId]);

  /**
   * Wipe the conversation for the current admin. Use for:
   *   \u2022 explicit "New conversation" button (with confirm dialog)
   *   \u2022 logout (called from clearAuth)
   */
  const resetConversation = useCallback(() => {
    safeWrite(adminId, EMPTY);
    setSnap(EMPTY);
    notify();
  }, [adminId]);

  return {
    turns: snap.turns,
    chatId: snap.chatId,
    setTurns,
    setChatId,
    resetConversation,
    hasConversation: snap.turns.length > 0,
  };
}

/**
 * Non-hook wipe for use outside React (e.g. `clearAuth()` in cms-auth.ts).
 * Clears BOTH the per-admin bucket and the legacy key.
 */
export function clearAllGeorgeSessions() {
  if (typeof window === 'undefined') return;
  try {
    const keysToDrop: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && (k === LEGACY_KEY || k.startsWith('fp_george_conv'))) keysToDrop.push(k);
    }
    keysToDrop.forEach(k => window.sessionStorage.removeItem(k));
    notify();
  } catch {
    /* storage blocked \u2014 nothing to do */
  }
}
