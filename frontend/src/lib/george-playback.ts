/**
 * Cross-platform audio playback helper for George's TTS.
 *
 * We hit a stubborn playback bug where `useAudioPlayer` from
 * `expo-audio` (v1.1.1) would restart the clip a beat after the
 * first word on web — the "G'day, I'm George" / "Hi there, I'm
 * Georgia" restarts the user reported. Best guess is a double
 * play() emission across the wrapper and the underlying
 * HTMLAudioElement.
 *
 * To sidestep it entirely we use the browser's native `Audio()`
 * element on web (predictable, well-behaved) and `expo-audio`'s
 * imperative `createAudioPlayer` factory on native (a fresh
 * player per clip — no shared state).
 *
 * Every play() call returns a `PlaybackController` with:
 *   - `stop()`  — pause + release
 *   - `whenDone` — a Promise that resolves when the clip finishes
 *
 * The caller drives UI state (spinner → stop icon → back to play).
 * We don't touch React here; this is deliberately pure.
 */
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type PlaybackController = {
  stop: () => void;
  whenDone: Promise<void>;
};

/** Play an audio URI. Returns a controller so the caller can stop
 *  playback and await natural completion. */
export function playAudioUri(uri: string): PlaybackController {
  if (Platform.OS === 'web') return _playOnWeb(uri);
  return _playOnNative(uri);
}

function _playOnWeb(uri: string): PlaybackController {
  const audio = new Audio(uri);
  let done = false;
  let resolveDone: () => void = () => {};
  const whenDone = new Promise<void>((r) => { resolveDone = r; });

  const finish = () => {
    if (done) return;
    done = true;
    try { audio.pause(); } catch { /* noop */ }
    // Detach handlers so the element can be GC'd.
    audio.onended = null;
    audio.onerror = null;
    resolveDone();
  };

  audio.onended = finish;
  audio.onerror = finish;

  // `play()` returns a Promise on web — swallow rejections (autoplay
  // policy, etc.) and treat them as "done" so the UI un-sticks.
  const p = audio.play();
  if (p && typeof p.then === 'function') {
    p.catch(() => finish());
  }

  return { stop: finish, whenDone };
}

function _playOnNative(uri: string): PlaybackController {
  // Ensure audio can route through earpiece / speaker even when the
  // ringer switch is on silent (iOS especially).
  setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {
    // Non-fatal — playback still tends to work if this rejects.
  });

  // Create a fresh player per clip so there's no state contamination
  // between successive taps. Autoplay is not the default; we call
  // `.play()` explicitly below.
  const player: AudioPlayer = createAudioPlayer(uri);

  let done = false;
  let resolveDone: () => void = () => {};
  const whenDone = new Promise<void>((r) => { resolveDone = r; });

  const finish = () => {
    if (done) return;
    done = true;
    try { player.pause(); } catch { /* noop */ }
    try { player.remove(); } catch { /* noop */ }
    resolveDone();
  };

  // No native "ended" event surfaces from `SharedObject` in this
  // version, so poll `playing` + `didJustFinish`-ish state via
  // `currentTime`/`duration`. Cheap and reliable enough for one-off
  // preview clips.
  const started = Date.now();
  const tick = setInterval(() => {
    if (done) { clearInterval(tick); return; }
    // If we've been ticking for at least 400ms (initial load leeway)
    // AND the player is no longer playing, the clip has ended.
    const elapsed = Date.now() - started;
    if (elapsed > 400 && !player.playing) {
      clearInterval(tick);
      finish();
    }
  }, 150);

  try { player.play(); } catch {
    clearInterval(tick);
    finish();
  }

  return {
    stop: () => { clearInterval(tick); finish(); },
    whenDone,
  };
}
