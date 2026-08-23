/**
 * MCGS audio playback singleton — one voice at a time.
 *
 * Prevents the "3 Georges talking over each other" bug: without this
 * guard, every `ChatBubble` in the transcript owns its own `<audio>`
 * element, so auto-speak on a fresh reply + a manual replay + a stale
 * clip finishing its buffer could all be audible at once.
 *
 * Contract:
 *   • Any code that is about to call `el.play()` on a George clip
 *     MUST first call `claimPlayback(el, onStopped)`. That stops and
 *     disposes whatever was playing before AND fires the previous
 *     owner's `onStopped` so it can reset its local UI state to idle.
 *   • On unmount, the owner MUST call `releasePlayback(el)` so a
 *     detached element isn't held forever.
 *   • On sheet close / minimise / logout / New Conversation, call
 *     `stopCurrentPlayback()`. No orphaned audio survives navigation.
 *
 * The registry lives at module scope so it's shared across every
 * bubble instance in the transcript. It is intentionally NOT a React
 * context — audio ownership is imperative, not declarative, and we
 * need synchronous access from inside a user-gesture callback.
 */

type Owner = {
  el: HTMLAudioElement;
  onStopped: () => void;
};

let currentOwner: Owner | null = null;

/**
 * Take ownership of the single playback slot. Stops and disposes the
 * previous owner FIRST so only one George clip is ever audible.
 *
 * Fires the previous owner's `onStopped` callback so its React
 * component can flip its local `playing`/`preparing` state to idle
 * without staying stuck as "⏸ Stop".
 *
 * Call this synchronously just before `el.play()`.
 */
export function claimPlayback(el: HTMLAudioElement, onStopped: () => void): void {
  stopCurrentPlayback();
  currentOwner = { el, onStopped };
}

/**
 * Stop and dispose the currently-playing audio (if any). Safe to
 * call when nothing is playing. Fires the previous owner's
 * `onStopped` callback.
 *
 * Use for: sheet close, minimise, logout, "New conversation", and
 * every fresh `claimPlayback` call.
 */
export function stopCurrentPlayback(): void {
  const prev = currentOwner;
  currentOwner = null;
  if (!prev) return;
  try { prev.el.pause(); } catch { /* noop */ }
  try { prev.el.currentTime = 0; } catch { /* noop */ }
  // Clearing the src stops Safari from continuing to buffer/play the
  // clip in the background — a subtle source of "ghost audio" during
  // route transitions.
  try {
    prev.el.removeAttribute('src');
    prev.el.load();
  } catch { /* noop */ }
  try { prev.onStopped(); } catch { /* noop */ }
}

/**
 * Release ownership if this element still holds it. Called from a
 * bubble's unmount effect so a re-mount (or GC) doesn't leak a
 * reference to a detached element.
 */
export function releasePlayback(el: HTMLAudioElement): void {
  if (currentOwner?.el === el) currentOwner = null;
}

/**
 * True when SOMETHING is currently playing (any bubble).
 * Exposed for tests and future UI (e.g. a "stop all" affordance).
 */
export function isSomethingPlaying(): boolean {
  return currentOwner !== null;
}

/** Test-only hook. Returns the current owner's element or null. */
export function _peekCurrentElementForTest(): HTMLAudioElement | null {
  return currentOwner?.el ?? null;
}

/** Test-only hook. Clears state between tests. */
export function _resetForTest(): void {
  currentOwner = null;
}
