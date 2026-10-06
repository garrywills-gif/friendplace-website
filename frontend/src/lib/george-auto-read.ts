/**
 * George / Georgia auto-read — TestFlight feedback (Garry, 27 July 2026).
 *
 * Public API:
 *   - `speakGeorgeAloud(text)`  → fetch cloud TTS + play. Stops any
 *     previous auto-read clip so a new turn doesn't stack.
 *   - `stopGeorgeAutoRead()`     → cancel any in-flight / active clip.
 *
 * v3 (Garry manual smoke, 28 July): "no matter which voice you choose
 * you get the robotic voice in George". Root cause was the fallback
 * to `expo-speech` when the cloud `georgeApi.speak` call failed — the
 * device TTS plays the iOS default voice regardless of the persona
 * preference. We now go SILENT instead of falling back. A missed
 * turn is better than the wrong voice, and members can always tap
 * the Speaker (▶︎) button to hear it in the correct voice.
 */
import { georgeApi } from './george-api';
import { playAudioUri, type PlaybackController } from './george-playback';
import type { GeorgeVoice } from './george-voice';

let activeCtrl: PlaybackController | null = null;
// iter239 (Neo, Oct 2026 — UX #1): we also need to flag the WINDOW
// between a caller invoking `speakGeorgeAloud` and the cloud TTS fetch
// actually resolving. During those few hundred ms `activeCtrl` is
// still null, so a poller that races the fetch would read "not
// speaking", start the nav fuse, and cut George off before the clip
// even began. `pendingCount` lets `isGeorgeAutoReadActive()` return
// true from the first instant speech is requested until the clip
// finishes playing or is cancelled.
let pendingCount = 0;
let generation = 0;

/** Cancel any active auto-read playback. */
export function stopGeorgeAutoRead(): void {
  // Bump the generation so any in-flight `speakGeorgeAloud` awaiting
  // network response knows to abort BEFORE it starts playback.
  generation += 1;
  pendingCount = 0;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
}

/** iter238 (Neo, Oct 2026 — UX #3): true while a cloud-TTS clip is
 *  currently being fetched or played by the auto-read path. The
 *  companion chat polls this to delay the 2-second "Opening X…" fuse
 *  until speech has finished, so navigation never cuts George off
 *  mid-sentence. iter239 extends the check to include the fetch
 *  window — if we only looked at `activeCtrl`, a poller racing a
 *  slow network could read "idle" during the ~200-800ms the clip is
 *  being generated and start navigating too early. */
export function isGeorgeAutoReadActive(): boolean {
  return activeCtrl !== null || pendingCount > 0;
}

/** Speak a fresh George message using the cloud persona voice (via
 *  `/mcgs/george/speak`). Pass an explicit `persona` when the caller
 *  already knows which companion is active (e.g. the companion chat) so
 *  the spoken voice can never diverge from the on-screen persona; when
 *  omitted, `georgeApi.speak` falls back to the persisted global
 *  preference. If the cloud call fails, we go silent — device TTS
 *  (which plays the OS default voice regardless of persona) is NEVER
 *  used as a fallback. Errors are logged in __DEV__ but never surfaced.
 *
 * iter238 (Neo, Oct 2026 — UX #3): the returned Promise now resolves
 * when playback FINISHES (clip ended OR cancelled), not when it
 * starts. Companion-chat navigation uses this to wait for TTS to
 * finish before kicking off the 2-second "Opening X…" fuse — speech
 * is never cut off by navigation. If TTS fails or is cancelled, the
 * promise still resolves so the caller doesn't hang. */
export async function speakGeorgeAloud(text: string, persona?: GeorgeVoice): Promise<void> {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  generation += 1;
  const myGen = generation;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
  // Mark the auto-read as "pending" the moment we're requested — this
  // closes the race window where a poller could see no active clip
  // during the fetch and start navigating before speech begins. Paired
  // with a `finally` so an exception can never leak the pending count.
  pendingCount += 1;
  try {
    const uri = await georgeApi.speak(trimmed, persona);
    if (myGen !== generation) return;             // superseded while fetching
    const ctrl = playAudioUri(uri);
    activeCtrl = ctrl;
    // Await the clip's whenDone so callers can sequence actions
    // AFTER speech finishes.
    await ctrl.whenDone;
    if (activeCtrl === ctrl) activeCtrl = null;
  } catch (e) {
    // Go silent — device TTS voice would be wrong. Log the error in
    // dev so we can spot cloud-call failures during smoke tests.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[speakGeorgeAloud] cloud TTS failed:', (e as any)?.message || e);
    }
  } finally {
    pendingCount = Math.max(0, pendingCount - 1);
  }
}
