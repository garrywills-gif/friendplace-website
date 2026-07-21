/**
 * useGeorgeVoiceInput — shared push-to-talk recorder used by
 * `GeorgeEventCreation` (main chat) and `GeorgeOnboarding` (first-run
 * chat) so both surfaces share exactly the same mic behaviour, permission
 * copy, and 60 s hard cap.
 *
 * Usage:
 *   const { voicePhase, startRecording, stopRecording, permissionBlocked,
 *           voiceError, voiceSeconds } = useGeorgeVoiceInput(setInput);
 *
 * The hook owns:
 *   • expo-audio recorder instance + a 1-second local timer for display
 *   • permission prompt / blocked-state tracking
 *   • upload to /api/mcgs/george/transcribe on stop
 *   • appending the transcript to whatever's already in the composer
 *
 * All UI (mic button, pulse animation, error toast) lives in the caller.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder, RecordingPresets,
  setAudioModeAsync,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { georgeApi } from '@/src/lib/george-api';

type VoicePhase = 'idle' | 'recording' | 'transcribing';

export function useGeorgeVoiceInput(
  onTranscript: (append: (prev: string) => string) => void,
) {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const voiceTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (voicePhase === 'recording') {
      if (voiceTickRef.current) clearInterval(voiceTickRef.current);
      setVoiceSeconds(0);
      voiceTickRef.current = setInterval(() => {
        setVoiceSeconds(n => n + 1);
      }, 1000);
    } else if (voiceTickRef.current) {
      clearInterval(voiceTickRef.current);
      voiceTickRef.current = null;
    }
    return () => {
      if (voiceTickRef.current) {
        clearInterval(voiceTickRef.current);
        voiceTickRef.current = null;
      }
    };
  }, [voicePhase]);

  const stopRecording = useCallback(async () => {
    if (voicePhase !== 'recording') return;
    setVoicePhase('transcribing');
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* noop */ }
      if (!uri) {
        setVoiceError("I couldn't quite catch that. Please try again.");
        setVoicePhase('idle');
        return;
      }
      if (voiceSeconds < 1) {
        setVoicePhase('idle');
        return;
      }
      const isWeb = Platform.OS === 'web';
      const name = isWeb ? 'george-voice.webm' : 'george-voice.m4a';
      const type = isWeb ? 'audio/webm' : 'audio/m4a';
      const text = await georgeApi.transcribe(uri, name, type);
      if (text) {
        onTranscript(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
      } else {
        setVoiceError("I couldn't quite catch that. Mind trying again?");
      }
    } catch {
      setVoiceError("I couldn't quite catch that. Please try again.");
    } finally {
      setVoicePhase('idle');
    }
  }, [voicePhase, audioRecorder, voiceSeconds, onTranscript]);

  // Hard cap at 60 s so a forgotten recording doesn't run forever.
  useEffect(() => {
    if (voicePhase === 'recording' && voiceSeconds >= 60) {
      stopRecording();
    }
  }, [voiceSeconds, voicePhase, stopRecording]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    if (voicePhase !== 'idle') return;
    try {
      let perm = await getRecordingPermissionsAsync();
      if (perm.status !== 'granted' && perm.canAskAgain !== false) {
        perm = await requestRecordingPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        setPermissionBlocked(true);
        return;
      }
      setPermissionBlocked(false);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setVoicePhase('recording');
    } catch {
      setVoiceError("I couldn't start the microphone. Please try again in a moment.");
      setVoicePhase('idle');
    }
  }, [voicePhase, audioRecorder]);

  return {
    voicePhase,
    permissionBlocked,
    voiceError,
    voiceSeconds,
    startRecording,
    stopRecording,
    dismissError: useCallback(() => setVoiceError(null), []),
  };
}
