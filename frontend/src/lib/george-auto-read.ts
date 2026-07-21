/**
 * George / Georgia auto-read — TestFlight feedback (Garry, 27 July 2026).
 *
 * Public API:
 *   - `speakGeorgeAloud(text)`  → fetch cloud TTS + play. Stops any
 *     previous auto-read clip so a new turn doesn't stack.
 *   - `stopGeorgeAutoRead()`     → cancel any in-flight / active clip.
 *
 * v2 (Garry follow-up TestFlight report): the first auto-read plays
 * but subsequent turns fell silent. Root cause was a shared
 * `cancelInFlight` boolean that could be flipped by the SAME call's
 * `stopGeorgeAutoRead()` prelude when the previous playback had
 * already ended and the module state was mid-transition. We now use a
 * monotonic generation token so each call only ever cancels itself
 * against later calls — never against its own reset.
 */
import * as Speech from 'expo-speech';
import { georgeApi } from './george-api';
import { playAudioUri, type PlaybackController } from './george-playback';

let activeCtrl: PlaybackController | null = null;
let generation = 0;

/** Cancel any active auto-read playback. */
export function stopGeorgeAutoRead(): void {
  // Bump the generation so any in-flight `speakGeorgeAloud` awaiting
  // network response knows to abort BEFORE it starts playback.
  generation += 1;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
  try { Speech.stop(); } catch { /* noop */ }
}

/** Speak a fresh George message using the persisted cloud persona
 *  voice (via `/mcgs/george/tts`). Falls back to device TTS only if
 *  the cloud call fails. Errors are swallowed so TTS issues never
 *  interrupt the chat loop. */
export async function speakGeorgeAloud(text: string): Promise<void> {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  // Bump generation exactly once — this claims the slot for this
  // call. Any earlier in-flight call sees a mismatched generation
  // after its `await` and bails out cleanly.
  generation += 1;
  const myGen = generation;
  // Also stop anything currently playing so the two clips don't overlap.
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
  try {
    const uri = await georgeApi.speak(trimmed);
    // A newer call (or stopGeorgeAutoRead) has taken over — bail out
    // silently. This is the correct cancellation semantic: whichever
    // call generation matches at THIS moment gets to play.
    if (myGen !== generation) return;
    const ctrl = playAudioUri(uri);
    activeCtrl = ctrl;
    ctrl.whenDone.then(() => {
      if (activeCtrl === ctrl) activeCtrl = null;
    });
  } catch {
    // Cloud TTS unreachable — fall through to device TTS so members
    // never sit in silence. Still only if our generation is current.
    if (myGen !== generation) return;
    try {
      await Speech.stop();
      Speech.speak(trimmed, { rate: 0.95, pitch: 1.02, language: 'en-AU' });
    } catch { /* silent */ }
  }
}
