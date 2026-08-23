'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVoiceRecorderOptions {
  maxSeconds?: number;         // hard cap, default 60
  silenceSeconds?: number;     // auto-stop after N seconds of silence, default 3
  silenceThreshold?: number;   // 0-1 RMS threshold, default 0.02
  /**
   * RMS threshold above which we consider a frame "genuine speech"
   * (as opposed to background noise / silence). If the whole clip
   * stayed below this, the recorder returns ``null`` from ``stop()``
   * so the caller never uploads a silence-only blob (which Whisper
   * would otherwise hallucinate into a "Thank you for watching"
   * type phrase — iter164c).
   *
   * 0.05 sits comfortably above typical room noise on a laptop mic
   * but well below normal speaking level.
   */
  speechThreshold?: number;
}

export interface VoiceRecorderState {
  recording: boolean;
  seconds: number;
  level: number;               // instantaneous input level, 0-1
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

/**
 * Voice recorder hook with silence auto-stop, timer, level meter and
 * a hard maximum. All safeguards match the locked spec:
 *   * tap-to-toggle
 *   * 3s of silence auto-stops
 *   * 60s hard cap
 *   * transcript review is handled by the caller (this hook only
 *     produces a webm blob; the transcript endpoint is separate).
 */
export function useVoiceRecorder(opts: UseVoiceRecorderOptions = {}): VoiceRecorderState {
  const maxSeconds = opts.maxSeconds ?? 60;
  const silenceSeconds = opts.silenceSeconds ?? 3;
  const silenceThreshold = opts.silenceThreshold ?? 0.02;
  const speechThreshold = opts.speechThreshold ?? 0.05;

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const cancelledRef = useRef(false);
  // iter164c: peak RMS observed during the current recording. Used
  // to decide whether the clip contained any *genuine* speech — if
  // every frame stayed below ``speechThreshold`` we're almost
  // certainly holding a silence-only blob and MUST NOT upload it
  // (Whisper hallucinates known phrases from silence, e.g. the
  // Korean "Thank you for watching"). Reset on every ``start``.
  const peakRmsRef = useRef<number>(0);
  const hadSpeechRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      return null;
    }
    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      recorderRef.current!.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Audio analysis for silence detection.
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.fftSize);
      const tickLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        setLevel(rms);
        // iter164c: track peak + speech-detection. A single frame
        // over the speech threshold flips ``hadSpeech`` — after that
        // the flag is sticky for the rest of the clip.
        if (rms > peakRmsRef.current) peakRmsRef.current = rms;
        if (rms >= speechThreshold) hadSpeechRef.current = true;

        const now = performance.now();
        if (rms < silenceThreshold) {
          if (silenceStartRef.current === null) silenceStartRef.current = now;
          else if ((now - silenceStartRef.current) / 1000 >= silenceSeconds) {
            // Auto-stop.
            stop();
            return;
          }
        } else {
          silenceStartRef.current = null;
        }

        // Hard cap.
        if ((now - startTsRef.current) / 1000 >= maxSeconds) {
          stop();
          return;
        }

        rafRef.current = requestAnimationFrame(tickLevel);
      };

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        cleanup();
        const cancelled = cancelledRef.current;
        cancelledRef.current = false;
        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;
        if (cancelled || chunksRef.current.length === 0) {
          resolver?.(null);
          return;
        }
        // iter164c: reject silence-only recordings. If no frame ever
        // exceeded the speech threshold, the clip is background noise
        // — uploading it to Whisper produces a hallucinated phrase
        // (e.g. Korean "Thank you for watching"). Return null so the
        // caller shows "no speech detected" and never touches the input.
        if (!hadSpeechRef.current) {
          resolver?.(null);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mime });
        resolver?.(blob);
      };

      startTsRef.current = performance.now();
      silenceStartRef.current = null;
      // iter164c: reset speech-detection state for THIS recording so
      // stale peaks from a previous tap can't misclassify silence as
      // speech.
      peakRmsRef.current = 0;
      hadSpeechRef.current = false;
      setSeconds(0);
      recorder.start();
      setRecording(true);
      rafRef.current = requestAnimationFrame(tickLevel);
    } catch (err) {
      const msg = (err as Error).message || 'Microphone unavailable';
      setError(msg.includes('Permission') ? 'Microphone permission needed' : msg);
      cleanup();
    }
  }, [maxSeconds, silenceSeconds, silenceThreshold, speechThreshold, cleanup, stop]);

  // Second-level tick for the timer.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setSeconds(Math.floor((performance.now() - startTsRef.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { recording, seconds, level, error, start, stop, cancel };
}
