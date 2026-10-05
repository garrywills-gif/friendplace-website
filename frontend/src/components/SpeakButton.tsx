/**
 * SpeakButton — tap-to-read accessibility button.
 *
 * TestFlight round-5 (Garry, Feb 2026 #15): historically this button
 * used `expo-speech` which plays the OS default voice (Siri's robotic
 * voice on iOS). Meanwhile George's own bubbles use the cloud
 * OpenAI TTS via `GeorgeSpeakButton`, leaving members hearing TWO
 * different voices in the same app — jarring, and it breaks George's
 * personality.
 *
 * George is FriendPlace's voice. Every read-aloud button — home
 * "Today's Thought", notices, DM messages, recipes, events, and every
 * game's how-to-play — now speaks in George's cloud voice. Same call
 * signature as before, so all ~30 existing call sites work unchanged.
 *
 * Cost containment:
 *   • First tap on a piece of text hits OpenAI TTS. The mp3 bytes are
 *     saved to the app cache directory named by (voice + content-hash),
 *     so subsequent taps of the same text — from any component, any
 *     screen, across app restarts until iOS reclaims the cache — return
 *     instantly with zero network calls.
 *   • In-memory `uriCache` (see `tts-shared.ts`) additionally short-
 *     circuits the disk check within the same session.
 *
 * `rate` and `pitch` are accepted for backwards compatibility but no
 * longer used (cloud TTS controls prosody server-side).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { georgeApi } from '@/src/lib/george-api';
import { getVoice, DEFAULT_VOICE, subscribeVoice } from '@/src/lib/george-voice';
import { playAudioUri, prewarmAudioSession, type PlaybackController } from '@/src/lib/george-playback';
import {
  claimActiveSpeaker,
  releaseActiveSpeaker,
  getCachedUri,
  setCachedUri,
  prewarmTts,
} from '@/src/lib/tts-shared';

type Props = {
  text: string;
  size?: number;
  color?: string;
  bg?: string;
  testID?: string;
  /** Ignored — kept for backwards compatibility with old call sites. */
  rate?: number;
  /** Ignored — kept for backwards compatibility with old call sites. */
  pitch?: number;
  /** iter234 — if `true`, kick off a background prewarm of this text's
   *  TTS the first time the component mounts. Dramatically reduces
   *  perceived latency on the first tap (OpenAI cold-start can be
   *  several seconds). Opt-in because most speaker buttons live inside
   *  rotating/lazy content where prewarming would be wasteful. */
  prewarm?: boolean;
};

type Phase = 'idle' | 'loading' | 'playing';

export default function SpeakButton({
  text,
  size = 22,
  color = '#1E3A7F',
  bg = 'transparent',
  testID,
  prewarm,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const activeCtrlRef = useRef<PlaybackController | null>(null);
  const stopRef = useRef<() => void>(() => {});

  // iter234 (Neo, Oct 2026 — POLISH #2): opt-in prewarm. Kick off a
  // background TTS fetch for this text on mount so the first tap plays
  // instantly instead of waiting ~2–3s for OpenAI's cold-start. Safe
  // to call across renders — `prewarmTts` is idempotent.
  //
  // iter237 (Neo, Oct 2026 — RED #1 recurrence): ALWAYS warm the iOS
  // AVAudioSession on mount, even when text-prewarm is off. The
  // session activation alone was ~400-500ms of the first-tap delay
  // (the TTS fetch was the other ~500-1500ms). Doing this unconditionally
  // costs nothing (setAudioModeAsync is cheap and idempotent) and
  // guarantees any speaker button pays zero audio-stack cost when the
  // member finally taps it.
  useEffect(() => {
    if (Platform.OS !== 'web') void prewarmAudioSession();
    if (!prewarm) return;
    void prewarmTts(text);
  }, [prewarm, text]);

  const stop = useCallback(() => {
    try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
    activeCtrlRef.current = null;
    setPhase('idle');
    releaseActiveSpeaker(stopRef.current);
  }, []);
  stopRef.current = stop;

  const play = useCallback(async () => {
    if (phase === 'playing') { stop(); return; }
    if (phase === 'loading') return;

    const clean = (text || '').toString().trim();
    if (!clean) return;

    setPhase('loading');
    claimActiveSpeaker(stopRef.current);
    try {
      const voice = (await getVoice()) ?? DEFAULT_VOICE;

      // Session-level in-memory cache (shared with GeorgeSpeakButton).
      let uri = getCachedUri(voice, clean);
      if (!uri) {
        // Falls through to `georgeApi.speak` which itself checks the
        // on-disk cache before hitting the network — so this is at most
        // one filesystem stat call on repeat taps.
        uri = await georgeApi.speak(clean);
        setCachedUri(voice, clean, uri);
      }

      const ctrl = playAudioUri(uri);
      activeCtrlRef.current = ctrl;
      setPhase('playing');
      ctrl.whenDone.then(() => {
        if (activeCtrlRef.current === ctrl) {
          activeCtrlRef.current = null;
          setPhase('idle');
          releaseActiveSpeaker(stopRef.current);
        }
      });
    } catch (e) {
      if (__DEV__) console.warn('[SpeakButton] playback failed', e);
      // Silent failure — no toast context here (SpeakButton is used all
      // over the app including inside game screens where a toast would
      // be intrusive). Members can retry with another tap.
      setPhase('idle');
      releaseActiveSpeaker(stopRef.current);
    }
  }, [text, phase, stop]);

  // Voice-preference change: drop the current playback and reset. The
  // in-memory `uriCache` in `tts-shared.ts` is cleared globally by the
  // settings screen when the voice changes, so the next play() will
  // fetch fresh.
  useEffect(() => {
    const unsub = subscribeVoice(() => {
      try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
      activeCtrlRef.current = null;
      setPhase('idle');
    });
    return unsub;
  }, []);

  // Cleanup on unmount — stop any in-flight playback so navigating
  // away from a screen doesn't leave audio playing. URIs live in the
  // shared `tts-shared` cache and are managed there.
  useEffect(() => () => {
    try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
    releaseActiveSpeaker(stopRef.current);
  }, []);

  // Hit area padding for large finger targets (older members).
  const pad = Math.max(8, Math.round(size * 0.4));
  const dim = size + pad * 2;

  const iconName =
    phase === 'playing'  ? 'stop-circle' :
    phase === 'loading'  ? 'ellipsis-horizontal' :
    'volume-high';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={phase === 'playing' ? 'Stop reading aloud' : 'Read aloud'}
      accessibilityHint="Reads the content aloud in George's voice"
      testID={testID || 'speak-button'}
      onPress={play}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: bg,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View>
        <Ionicons name={iconName as any} size={size} color={color} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
});
