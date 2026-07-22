/**
 * GeorgeSpeakButton — cloud voice speaker for George / Georgia bubbles.
 *
 * TestFlight round-2 v2 (Garry, 28 July 2026 #10): the onboarding
 * George chat used the generic `<SpeakButton>` which drives `expo-
 * speech` (Apple default voice on iOS). Members hearing "Apple's
 * robotic voice" instead of George/Georgia was jarring. This
 * component fetches the persona voice from `/api/mcgs/george/speak`
 * (OpenAI TTS onyx/nova) and plays it through the same
 * `playAudioUri` helper the main chat speaker uses.
 *
 * Behaviour:
 *   • First tap  → loading state → cloud fetch → play
 *   • Second tap → stop
 *   • Voice preference change → drop cache + stop
 *   • Never falls back to device TTS. If cloud fails, we show a
 *     toast — silence is better than the wrong voice.
 */
import React from 'react';
import { Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '@/src/lib/toast';
import { georgeApi } from '@/src/lib/george-api';
import { subscribeVoice } from '@/src/lib/george-voice';
import { playAudioUri, type PlaybackController } from '@/src/lib/george-playback';

type Props = {
  text: string;
  color?: string;
  bg?: string;
  size?: number;
  testID?: string;
};

// Only one George speaker plays at a time (matches SpeakerButton
// semantics inside the main chat modal).
let _activeStop: null | (() => void) = null;
function _claimActive(stop: () => void) {
  if (_activeStop && _activeStop !== stop) _activeStop();
  _activeStop = stop;
}
function _releaseActive(stop: () => void) {
  if (_activeStop === stop) _activeStop = null;
}

export default function GeorgeSpeakButton({
  text,
  color = '#0F766E',
  bg,
  size = 22,
  testID,
}: Props) {
  const { show } = useToast();
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'playing'>('idle');
  const cachedUriRef = React.useRef<string | null>(null);
  const activeCtrlRef = React.useRef<PlaybackController | null>(null);

  const stopRef = React.useRef<() => void>(() => {});
  const stop = React.useCallback(() => {
    try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
    activeCtrlRef.current = null;
    setPhase('idle');
    _releaseActive(stopRef.current);
  }, []);
  stopRef.current = stop;

  const play = React.useCallback(async () => {
    if (phase === 'playing') { stop(); return; }
    if (phase === 'loading') return;
    setPhase('loading');
    _claimActive(stopRef.current);
    try {
      let uri = cachedUriRef.current;
      if (!uri) {
        uri = await georgeApi.speak(text);
        cachedUriRef.current = uri;
      }
      const ctrl = playAudioUri(uri);
      activeCtrlRef.current = ctrl;
      setPhase('playing');
      ctrl.whenDone.then(() => {
        if (activeCtrlRef.current === ctrl) {
          activeCtrlRef.current = null;
          setPhase('idle');
          _releaseActive(stopRef.current);
        }
      });
    } catch (e: any) {
      if (__DEV__) {
         
        console.warn('[GeorgeSpeakButton] playback failed', e);
      }
      show('Could not play George\u2019s voice. Please try again.');
      cachedUriRef.current = null;
      setPhase('idle');
      _releaseActive(stopRef.current);
    }
  }, [text, phase, stop, show]);

  React.useEffect(() => () => {
    try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
    if (cachedUriRef.current && Platform.OS === 'web') {
      try { URL.revokeObjectURL(cachedUriRef.current); } catch { /* noop */ }
    }
    _releaseActive(stopRef.current);
  }, []);

  // Drop cache + stop on voice-preference change so the next tap
  // fetches with the newly-selected voice.
  React.useEffect(() => {
    const unsub = subscribeVoice(() => {
      if (Platform.OS === 'web' && cachedUriRef.current) {
        try { URL.revokeObjectURL(cachedUriRef.current); } catch { /* noop */ }
      }
      cachedUriRef.current = null;
      try { activeCtrlRef.current?.stop(); } catch { /* noop */ }
      activeCtrlRef.current = null;
      setPhase('idle');
    });
    return unsub;
  }, []);

  const iconName =
    phase === 'playing'  ? 'stop-circle' :
    phase === 'loading'  ? 'ellipsis-horizontal' :
    'volume-high';

  return (
    <Pressable
      testID={testID}
      onPress={play}
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        bg ? { backgroundColor: bg } : null,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={phase === 'playing' ? 'Stop speaking' : 'Read aloud'}
    >
      <Ionicons name={iconName as any} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    padding: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
