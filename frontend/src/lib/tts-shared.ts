/**
 * tts-shared — module-level singletons for cloud TTS UX:
 *
 *   1. `_activeStop` registry: only ONE speaker component (SpeakButton or
 *      GeorgeSpeakButton) plays at a time. Tapping a new speaker button
 *      stops any previously-playing one. Matches iMessage/notes-app
 *      behaviour.
 *   2. `uriCache`: in-memory Map<voice+text, uri> so multiple speaker
 *      buttons rendering the same content (e.g. the same "Today's
 *      Thought" appearing on home + notices) share a single cloud fetch
 *      per app session. `georgeApi.speak` also writes to disk with a
 *      content-hash filename, so hitting the network at all after the
 *      first successful play is rare.
 *
 * Kept intentionally tiny so we don't add another React context just to
 * coordinate audio. All state lives in module scope which is exactly
 * what we want for "there is only one speaker".
 */

type StopFn = () => void;
let _activeStop: StopFn | null = null;

/** Register `stop` as the active speaker. Any previously-active speaker
 *  is stopped first. Safe to call repeatedly. */
export function claimActiveSpeaker(stop: StopFn) {
  if (_activeStop && _activeStop !== stop) {
    try { _activeStop(); } catch { /* noop */ }
  }
  _activeStop = stop;
}

/** Release the given `stop` if it's still the active one. Called on
 *  playback done / component unmount. */
export function releaseActiveSpeaker(stop: StopFn) {
  if (_activeStop === stop) _activeStop = null;
}

// -- URI cache -----------------------------------------------------------

const uriCache = new Map<string, string>();

export function cacheKey(voice: string, text: string): string {
  // Trim + collapse whitespace so "Hello  world" and "Hello world" share
  // a cache entry. Voice matters because the same text spoken as George
  // vs Georgia produces different mp3s.
  return `${voice}::${text.trim().replace(/\s+/g, ' ')}`;
}

export function getCachedUri(voice: string, text: string): string | null {
  return uriCache.get(cacheKey(voice, text)) ?? null;
}

export function setCachedUri(voice: string, text: string, uri: string) {
  uriCache.set(cacheKey(voice, text), uri);
}

/** Called when the persona voice preference changes — the previously
 *  cached URIs point to files spoken in the OLD voice, so we must drop
 *  them. Files on disk are named by content-hash so they can safely
 *  stay; the next tap will regenerate. */
export function clearUriCache() {
  uriCache.clear();
}
