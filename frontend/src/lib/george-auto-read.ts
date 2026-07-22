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

let activeCtrl: PlaybackController | null = null;
let generation = 0;

/** Cancel any active auto-read playback. */
export function stopGeorgeAutoRead(): void {
  // Bump the generation so any in-flight `speakGeorgeAloud` awaiting
  // network response knows to abort BEFORE it starts playback.
  generation += 1;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
}

/** Speak a fresh George message using the persisted cloud persona
 *  voice (via `/mcgs/george/tts`). If the cloud call fails, we go
 *  silent — device TTS (which plays the OS default voice regardless
 *  of persona) is NEVER used as a fallback. Errors are logged in
 *  __DEV__ but never surfaced. */
export async function speakGeorgeAloud(text: string): Promise<void> {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  generation += 1;
  const myGen = generation;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
  try {
    const uri = await georgeApi.speak(trimmed);
    if (myGen !== generation) return;
    const ctrl = playAudioUri(uri);
    activeCtrl = ctrl;
    ctrl.whenDone.then(() => {
      if (activeCtrl === ctrl) activeCtrl = null;
    });
  } catch (e) {
    // Go silent — device TTS voice would be wrong. Log the error in
    // dev so we can spot cloud-call failures during smoke tests.
    if (__DEV__) {
       
      console.warn('[speakGeorgeAloud] cloud TTS failed:', (e as any)?.message || e);
    }
  }
}
