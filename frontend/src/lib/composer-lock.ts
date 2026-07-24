/**
 * composer-lock — tiny global gate that lets any composer say
 * "I'm busy right now, don't interrupt me". Consumed by the DM
 * notification prompt (`GlobalDmPrompt`) so an incoming-message
 * George prompt can defer to the next poll cycle instead of
 * popping up while a member is mid-sentence or mid-recording.
 *
 * Approved by Garry on 24 June 2026. Deliberately implemented as
 * a plain module-level ref count rather than a Context/Provider
 * so composers don't need any wrapping and callers pay zero re-
 * render cost when the lock toggles.
 *
 * Usage (any composer):
 *   const focused = useIsFocused(textInput);   // or Reanimated equivalent
 *   const recording = ...;                     // existing state
 *   useComposerLock(focused || recording);
 *
 * Usage (consumer that wants to defer):
 *   const busy = useComposerActive();
 *   if (busy) return skipThisCycle();
 *
 * The lock is process-scoped (in-memory only) — no persistence.
 * On app cold-start it starts at 0.
 */
import { useEffect, useSyncExternalStore } from "react";

let _count = 0;
const _subscribers = new Set<() => void>();

function _notify() {
  for (const fn of _subscribers) {
    try { fn(); } catch { /* subscriber threw — ignore */ }
  }
}

function _subscribe(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}

function _getSnapshot(): number {
  return _count;
}

/**
 * Increment the global "composer busy" count while `active` is true,
 * decrement when it flips back to false or on unmount. Safe to call
 * from any component — the effect handles the cleanup.
 *
 * The `active` boolean should represent "the member is actively
 * typing or recording right now". Typical composition:
 *   • `focused` from a controlled TextInput's onFocus/onBlur
 *   • `recording` from a voice/mic button's local state
 *   • OR-ed together so ANY of them keeps the lock held
 *
 * The hook is deliberately forgiving: if `active` never changes
 * from false, we never touch the count.
 */
export function useComposerLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    _count += 1;
    _notify();
    return () => {
      _count = Math.max(0, _count - 1);
      _notify();
    };
  }, [active]);
}

/**
 * Read the current global lock state. Re-renders the caller whenever
 * the count crosses zero (going busy / going idle). Uses
 * `useSyncExternalStore` so we integrate cleanly with React 18's
 * concurrent rendering without stale reads.
 */
export function useComposerActive(): boolean {
  const count = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  return count > 0;
}

/**
 * Escape hatch for non-hook callers (rare — mostly for one-shot
 * pollers that want to peek without subscribing). Do not use inside
 * a render function.
 */
export function isComposerActive(): boolean {
  return _count > 0;
}
