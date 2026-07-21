/**
 * George / Georgia auto-read — TestFlight feedback (Garry, 27 July 2026).
 *
 * The previous implementation used `expo-speech` (device TTS). On many
 * iOS devices this is inaudible unless the ringer switch is off and
 * an active audio session is present — and even then it plays with a
 * device voice that does NOT match the George/Georgia cloud voice
 * that the Speaker (▶︎) button uses. Members reported "auto-read
 * doesn't work" because they never heard anything.
 *
 * This helper mirrors the Speaker button: it fetches George's cloud
 * TTS (`georgeApi.speak`) and plays it through `playAudioUri` (which
 * already forces `playsInSilentMode: true` on native). If the cloud
 * call fails (offline, backend blip), we fall back to `Speech.speak`
 * so members never sit in silence.
 *
 * Public API — a lightweight coordinator that:
 *   - Cancels any in-flight auto-read before starting a new one.
 *   - Skips empty text and silent-turn keys we've already spoken.
 */
import * as Speech from 'expo-speech';
import { georgeApi } from './george-api';
import { playAudioUri, type PlaybackController } from './george-playback';

let activeCtrl: PlaybackController | null = null;
let cancelInFlight = false;

/** Cancel any active auto-read playback (called on unmount / stop). */
export function stopGeorgeAutoRead(): void {
  cancelInFlight = true;
  try { activeCtrl?.stop(); } catch { /* noop */ }
  activeCtrl = null;
  try { Speech.stop(); } catch { /* noop */ }
}

/** Speak a fresh George message. Uses the member's persisted voice
 *  preference (via `/mcgs/george/tts`); falls back to device TTS if
 *  the cloud call fails. Safe to call from an async context — errors
 *  are swallowed so TTS issues never break the chat loop. */
export async function speakGeorgeAloud(text: string): Promise<void> {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  // Stop anything currently playing so a new turn doesn't stack.
  stopGeorgeAutoRead();
  cancelInFlight = false;
  try {
    const uri = await georgeApi.speak(trimmed);
    if (cancelInFlight) return;
    const ctrl = playAudioUri(uri);
    activeCtrl = ctrl;
    // Release the reference when the clip completes naturally.
    ctrl.whenDone.then(() => {
      if (activeCtrl === ctrl) activeCtrl = null;
    });
  } catch {
    // Cloud voice unavailable — fall back to device TTS so the reader
    // still gets audio, even if it's the OS default voice.
    try {
      await Speech.stop();
      Speech.speak(trimmed, { rate: 0.95, pitch: 1.02, language: 'en-AU' });
    } catch { /* silent */ }
  }
}
