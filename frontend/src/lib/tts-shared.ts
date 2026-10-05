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

/**
 * iter234 (Neo, Oct 2026 — POLISH #2): pre-warm the TTS pipeline for a
 * piece of text so the first tap of the speaker button plays instantly
 * instead of waiting for OpenAI's cold-start + network round-trip.
 *
 * Call this on screen mount with the text that's about to appear (e.g.
 * George's opening onboarding line). The call races on a background
 * fiber: it checks the in-memory cache first, then falls through to the
 * disk cache (via georgeApi.speak), and finally hits the network. The
 * result URI is written back into the in-memory cache so when the member
 * eventually taps, the speaker goes from `idle` to `playing` without the
 * usual "loading" ellipsis step.
 *
 * Idempotent — if the same text is pre-warmed twice, the second call
 * returns immediately. Silent on failure (pre-warm is a courtesy, not a
 * contract — a real tap will retry).
 */
export async function prewarmTts(text: string, voiceOverride?: string): Promise<void> {
  const clean = (text || '').toString().trim();
  if (!clean) return;
  try {
    // iter237 (Neo, Oct 2026 — RED #1): fire the AVAudioSession
    // warm-up in parallel with the TTS fetch. On a cold iPhone the
    // session activation alone was ~400-500ms of the first-tap
    // delay; doing it here (before the member taps) collapses that
    // window entirely.
    const { prewarmAudioSession } = await import('./george-playback');
    void prewarmAudioSession();
    const { getVoice, DEFAULT_VOICE } = await import('./george-voice');
    // iter237 followup: respect any explicit voice override (companion
    // chat bubbles pass the persona they're drawn as). Otherwise fall
    // back to the member's saved voice.
    const voice = voiceOverride ?? ((await getVoice()) ?? DEFAULT_VOICE);
    if (getCachedUri(voice, clean)) return;      // already warm
    const { georgeApi } = await import('./george-api');
    const uri = await georgeApi.speak(clean, voice);
    setCachedUri(voice, clean, uri);
  } catch {
    // Pre-warm is best-effort. A real tap will retry and surface the
    // error through the usual phase('idle') path.
  }
}

/** Called when the persona voice preference changes — the previously
 *  cached URIs point to files spoken in the OLD voice, so we must drop
 *  them. Files on disk are named by content-hash so they can safely
 *  stay; the next tap will regenerate. */
export function clearUriCache() {
  uriCache.clear();
}

// -- Fire-and-forget speak (auto-read paths) -----------------------------
//
// Used by places that speak WITHOUT a visible speaker button — e.g. auto-
// read of an incoming DM, bingo-number call-outs. Async import of
// `georgeApi` / `playAudioUri` here to avoid a circular module load
// during app startup (this file is imported by SpeakButton which is
// imported very early).

/**
 * Speak `text` using George's cloud voice, coordinated with the same
 * active-speaker registry as `SpeakButton` / `GeorgeSpeakButton`. Safe
 * to await or ignore. Silently no-ops on error (auto-read paths must
 * never disrupt the UX — matches the intent of the old `Speech.speak`
 * calls we're replacing).
 */
export async function speakGeorgeAuto(text: string): Promise<void> {
  const clean = (text || '').toString().trim();
  if (!clean) return;
  try {
    // Dynamic imports break the SpeakButton → tts-shared → george-api →
    // (indirect) SpeakButton cycle that would otherwise happen if we
    // imported at the top of the file.
    const { georgeApi } = await import('./george-api');
    const { getVoice, DEFAULT_VOICE } = await import('./george-voice');
    const { playAudioUri } = await import('./george-playback');

    const voice = (await getVoice()) ?? DEFAULT_VOICE;
    let uri = getCachedUri(voice, clean);
    if (!uri) {
      uri = await georgeApi.speak(clean);
      setCachedUri(voice, clean, uri);
    }

    const ctrl = playAudioUri(uri);
    const stopFn = () => { try { ctrl.stop(); } catch { /* noop */ } };
    claimActiveSpeaker(stopFn);
    void ctrl.whenDone.finally(() => releaseActiveSpeaker(stopFn));
  } catch (e) {
    // Silent: this is a background courtesy, not a user action.
    if (__DEV__) console.warn('[speakGeorgeAuto] failed', e);
  }
}

/** Stop any in-flight George auto-read (matches `Speech.stop()` call
 *  sites we're replacing). */
export function stopGeorgeAuto() {
  if (_activeStop) {
    try { _activeStop(); } catch { /* noop */ }
    _activeStop = null;
  }
}
