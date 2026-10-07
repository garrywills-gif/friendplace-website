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

  // iter234 (Neo, Oct 2026 — POLISH #4): FIRST transcription after
  // opening the companion chat was consistently slow on real device —
  // iOS needs several hundred ms to spin up the audio stack
  // (AVAudioSession config, codec warm-up) before `record()` yields
  // real audio bytes. Members felt this as "my first question took
  // forever to transcribe". Pre-warm those paths on mount:
  //   1. Flip audio mode to "allows recording" so AVAudioSession is
  //      configured ahead of time.
  //   2. Call `prepareToRecordAsync` which lazily creates the AVAudio
  //      Recorder instance so the first real `record()` has nothing
  //      left to initialise.
  //   3. Immediately set audio mode back to playback-only so this
  //      pre-warm doesn't accidentally hog the mic indicator.
  // Done exactly once per hook mount; subsequent re-prepares happen
  // naturally when `startRecording` is tapped.
  const prewarmedRef = useRef(false);
  useEffect(() => {
    if (prewarmedRef.current) return;
    prewarmedRef.current = true;
    // Fire-and-forget: warm the server Whisper client in parallel
    // with the iOS audio stack. Both finish well before the member
    // taps the mic, taking the full cold-start cost off the first
    // transcription.
    void georgeApi.transcribeWarmup();
    void (async () => {
      try {
        // Check permission silently — we DO NOT want to trigger the
        // permission prompt here; `startRecording` still does that
        // contextually when the member taps the mic.
        const perm = await getRecordingPermissionsAsync();
        if (perm.status !== 'granted') return;
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await audioRecorder.prepareToRecordAsync();
        // Flip back to playback-only so the OS mic indicator / audio
        // session doesn't visibly engage before the member taps record.
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch {
        // Silent — pre-warm is best effort. The hook still works
        // without it; the first tap will warm cold.
      }
    })();
  }, [audioRecorder]);

  const stopRecording = useCallback(async () => {
    if (voicePhase !== 'recording') return;
    setVoicePhase('transcribing');
    // TestFlight feedback (Neo, Feb 2026 — item #4): per-stage timing
    // logs so we can measure the induction talk-to-text pipeline
    // from the backend logs. Each stage is tagged `voice.stt:<label>`
    // with millisecond deltas:
    //   • stop             → audioRecorder.stop() returned
    //   • grace            → 100 ms disk-finalise grace completed
    //   • upload_start     → transport layer handed the request to fetch
    //   • upload_done      → multipart body ACK'd by server
    //   • transcribe_done  → text returned from server
    //   • rendered         → onTranscript() invoked (text now in UI)
    // The grace is kept at 100 ms (verified sufficient across TestFlight
    // builds); only the measurement is new, so recording accuracy is
    // untouched.
    const _t0 = Date.now();
    const _mark = (stage: string, extra?: string) => {
      try {
        const dt = Date.now() - _t0;
        // eslint-disable-next-line no-console
        console.log(`[voice.stt] ${stage} +${dt}ms${extra ? ' ' + extra : ''}`);
      } catch { /* noop */ }
    };
    try {
      await audioRecorder.stop();
      _mark('stop');
      // iter214 (Garry, Oct 2026 — POLISH #3): the disk-finalise grace
      // period used to be 250ms; member feedback was transcription felt
      // noticeably slow on real device after speech ends. 100ms is still
      // enough for iOS to flush the .m4a container to disk (verified
      // across the TestFlight builds) but shaves ~150ms off perceived
      // latency — target "transcript appears about a second after
      // speech ends" is now reachable on a healthy network.
      await new Promise((r) => setTimeout(r, 100));
      _mark('grace');
      const uri = audioRecorder.uri;
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* noop */ }
      if (!uri) {
        setVoiceError("I couldn't quite catch that. Please try again.");
        setVoicePhase('idle');
        return;
      }
      if (voiceSeconds < 1) {
        _mark('too_short_dropped', `seconds=${voiceSeconds}`);
        setVoicePhase('idle');
        return;
      }
      const isWeb = Platform.OS === 'web';
      const name = isWeb ? 'george-voice.webm' : 'george-voice.m4a';
      const type = isWeb ? 'audio/webm' : 'audio/m4a';
      _mark('upload_start', `seconds=${voiceSeconds}`);
      const text = await georgeApi.transcribe(uri, name, type);
      _mark('transcribe_done', `chars=${text ? text.length : 0}`);
      if (text) {
        onTranscript(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
        _mark('rendered');
      } else {
        setVoiceError("I couldn't quite catch that. Mind trying again?");
        _mark('empty_result');
      }
    } catch (e) {
      _mark('error', (e as Error)?.message || 'unknown');
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
      // TestFlight iter136 (Garry, 5 Aug 2026): match the exact
      // warm-up ordering VoiceInputButton uses. iOS needs ~150ms
      // between `prepareToRecordAsync` and the first `record()` call
      // to actually start writing audio samples; without this the
      // encoder is still warming and the resulting file is empty.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      await new Promise((r) => setTimeout(r, 150));
      audioRecorder.record();
      if ((audioRecorder as any).isRecording === false) {
        throw new Error('audio recorder failed to start');
      }
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
