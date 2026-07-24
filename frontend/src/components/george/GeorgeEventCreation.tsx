import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Animated, Easing, Platform, Linking,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, getRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { EventChangeSummaryCard } from './EventChangeSummaryCard';
import { resolveGeorgeNavigate } from '@/src/lib/george-nav-map';
import { useGeorge } from '@/src/lib/george-context';
import { useToast } from '@/src/lib/toast';
import { useTheme } from '@/src/lib/theme';
import { subscribeVoice, useGeorgeVoice, VOICE_LABELS } from '@/src/lib/george-voice';
import { playAudioUri, type PlaybackController } from '@/src/lib/george-playback';
import { speakGeorgeAloud, stopGeorgeAutoRead } from '@/src/lib/george-auto-read';
import { useComposerLock } from '@/src/lib/composer-lock';
import {
  georgeApi,
  type EventSession, type EventDraft, type EventApprovalResult,
  type EventTurn, type EventSuggestion,
} from '@/src/lib/george-api';

/**
 * George's Event Creation surface — Milestone B5 (mobile) + polish pass.
 *
 * Continuous conversation. No form. No interrogation.
 *
 * Polish additions (locked with Garry, 20 July 2026):
 *   - Staged reveal: excitement → working → warmth → message, with
 *     brief, natural pauses (Sonnet already takes 3–9s to think, and
 *     the staged reveal makes those seconds feel like typing rhythm
 *     instead of empty waiting).
 *   - Warmth line: quiet encouragement ("I think people are really
 *     going to enjoy this.") rendered above the message when earned.
 *   - Suggestions: George can offer to suggest names / write a
 *     description / warm the invitation up. Rendered as chip pair
 *     under the message ("Yes please" / "Not just yet"). Only ever
 *     offered once per conversation.
 *   - Description feedback: after George writes a description on
 *     request, the turn shows three buttons: I like it / Let's
 *     tweak it / Show me another version.
 *
 * Principle #18: George earns trust before collecting information.
 */

interface Props {
  onDone: (result: EventApprovalResult) => void;
  onLeave: () => void;
  /**
   * If provided, resume this paused session instead of starting fresh.
   * George will open with a warm, age-aware "welcome back" turn and
   * the member can choose to carry on or start something new.
   */
  resumeSessionId?: string | null;
}

// A local turn extends the API turn with reveal-timing state.
type LocalTurn = EventTurn & { revealAt?: number };

// Staged-reveal timings — deliberately fast so a whole George reply
// completes in under a second once the API has returned. The perceived
// "typing rhythm" is the 3–9s Sonnet response plus these micro-beats.
const BEAT = {
  typingDots: 480,
  betweenParts: 320,
  afterMessage: 240,
};

export function GeorgeEventCreation({ onDone, onLeave, resumeSessionId = null }: Props) {
  const insets = useSafeAreaInsets();
  const {
    currentScreen, activeSessionId, setActiveSessionId, clearActiveSession,
    markGeorgeLedNavigation, consumePendingOpener,
  } = useGeorge();
  const { voice } = useGeorgeVoice();
  const personaName = VOICE_LABELS[voice].short;
  const { prefs } = useTheme();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<LocalTurn[]>([]);
  // TestFlight round-2 v2 (Garry, 28 July 2026) safety net: ensure
  // the post-approval scrollback is NEVER empty. If for any reason
  // turns becomes empty while postApproval is true, restore from the
  // preserved history ref. This guards against any accidental state
  // reset triggered by re-renders or hydration races.
  useEffect(() => {
    if (postApproval && turns.length === 0 && preApprovalHistoryRef.current.length > 0) {
      setTurns([...preApprovalHistoryRef.current]);
    }
  }, [postApproval, turns.length]);

  // Mirror `turns` in a ref so callbacks that fire during async flows
  // (approve, sendText response) can read the latest snapshot without
  // needing to be re-created on every turn change.
  const turnsRef = useRef<LocalTurn[]>([]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  const [status, setStatus] = useState<EventSession['status']>('in_progress');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<EventSuggestion | null>(null);
  const [, setSuggestionOffered] = useState<boolean>(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [typing, setTyping] = useState(false); // typing-dots

  // ------------------------------------------------------------------
  // Voice input (C1 Voice Phase 1, Garry 22 July 2026)
  // Tap-to-toggle recording. Whilst recording:
  //   - mic turns red with a pulsing glow
  //   - a timer counts up (00:07 ...)
  //   - George shows "I'm listening…" above the composer
  // When the member taps stop, we upload to /mcgs/george/transcribe
  // and land the transcript in the text box (review-first).
  // ------------------------------------------------------------------
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // We don't need the fine-grained recorder state right now — the
  // 500 ms poll is enough context, and our own 1 s timer drives the
  // display. Keep the hook wired for future waveform / metering work.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _recorderState = useAudioRecorderState(audioRecorder, 500);
  const [voicePhase, setVoicePhase] = useState<'idle' | 'recording' | 'transcribing'>('idle');

  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock while the member is drafting an event with George or the
  // voice pipeline is engaged so the GlobalDmPrompt defers instead
  // of interrupting.
  useComposerLock(
    input.length > 0 ||
      voicePhase === 'recording' ||
      voicePhase === 'transcribing',
  );
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Elapsed recording seconds, driven by a lightweight local timer so
  // the display stays responsive even when the recorder state pushes
  // updates only every 500ms.
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const voiceTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pulsing red glow around the mic while recording.
  const micPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (voicePhase === 'recording') {
      micPulse.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(micPulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ]),
      );
      loop.start();
      return () => { loop.stop(); };
    }
  }, [voicePhase, micPulse]);

  useEffect(() => {
    if (voicePhase === 'recording') {
      if (voiceTickRef.current) clearInterval(voiceTickRef.current);
      setVoiceSeconds(0);
      voiceTickRef.current = setInterval(() => {
        setVoiceSeconds(n => n + 1);
      }, 1000);
    } else {
      if (voiceTickRef.current) { clearInterval(voiceTickRef.current); voiceTickRef.current = null; }
    }
    return () => {
      if (voiceTickRef.current) { clearInterval(voiceTickRef.current); voiceTickRef.current = null; }
    };
  }, [voicePhase]);

  // Hard cap at 60 seconds so a forgotten recording doesn't run forever.
  useEffect(() => {
    if (voicePhase === 'recording' && voiceSeconds >= 60) {
      stopVoiceRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSeconds, voicePhase]);

  const startVoiceRecording = useCallback(async () => {
    setVoiceError(null);
    if (voicePhase !== 'idle') return;
    try {
      // Contextual permission ask, per the permissions contract.
      let perm = await getRecordingPermissionsAsync();
      if (perm.status !== 'granted') {
        if (perm.canAskAgain !== false) {
          perm = await requestRecordingPermissionsAsync();
        }
      }
      if (perm.status !== 'granted') {
        // Blocked. Surface a warm inline message with "Open Settings".
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

  const stopVoiceRecording = useCallback(async () => {
    if (voicePhase !== 'recording') return;
    setVoicePhase('transcribing');
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      // Reset audio mode so playback of other media isn't affected.
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* noop */ }
      if (!uri) {
        setVoiceError("I couldn't quite catch that. Please try again.");
        setVoicePhase('idle');
        return;
      }
      // If they only tapped for a fraction of a second, skip the upload.
      if (voiceSeconds < 1) {
        setVoicePhase('idle');
        return;
      }
      // iOS records .m4a, Android .m4a too via HIGH_QUALITY preset; web
      // records .webm. Filename hint helps the backend route to Whisper.
      const isWeb = Platform.OS === 'web';
      const name = isWeb ? 'george-voice.webm' : 'george-voice.m4a';
      const type = isWeb ? 'audio/webm' : 'audio/m4a';
      const text = await georgeApi.transcribe(uri, name, type);
      if (text) {
        // Append to any existing text so voice + typing can mix.
        setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
      } else {
        setVoiceError("I couldn't quite catch that. Mind trying again?");
      }
    } catch {
      setVoiceError("I couldn't quite catch that. Please try again.");
    } finally {
      setVoicePhase('idle');
    }
  }, [voicePhase, audioRecorder, voiceSeconds]);

  const toggleVoice = useCallback(() => {
    if (voicePhase === 'idle') startVoiceRecording();
    else if (voicePhase === 'recording') stopVoiceRecording();
  }, [voicePhase, startVoiceRecording, stopVoiceRecording]);

  const openMicSettings = useCallback(async () => {
    // C1 Voice Phase 1 v2 (Garry, 22 July 2026): making sure Open
    // Settings actually opens Settings. `Linking.openSettings()` is
    // the canonical path on iOS and Android — but in Expo Go it may
    // route to Expo Go's own settings page rather than FriendPlace's
    // (there is no distinct FriendPlace settings page inside Expo Go).
    // On a real build / dev build it goes straight to FriendPlace's
    // permissions. As a belt-and-braces fallback for iOS we try the
    // `app-settings:` URL scheme.
    try {
      await Linking.openSettings();
      return;
    } catch { /* fall through */ }
    if (Platform.OS === 'ios') {
      try { await Linking.openURL('app-settings:'); } catch { /* ignore */ }
    }
  }, []);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  // TestFlight feedback #1/#2 — set once the current session has been
  // approved so the header switches from "Don't save / Save for later"
  // to the general-chat "Reset / Close" pair, and the composer stays
  // usable for the follow-up conversation.
  const [postApproval, setPostApproval] = useState<boolean>(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // TestFlight round-2 (Garry, 28 July 2026 #4): "George reads the
  // last message again when reopened." Cursor is now persisted per
  // session_id in AsyncStorage so reopens skip already-spoken turns,
  // and only fresh replies (turn count > persisted) get read aloud.
  const lastAutoReadCountRef = useRef<number>(0);
  // TestFlight round-2 (Garry, 28 July 2026 #1): "George chat closes
  // after final event confirmation." Root cause was the fresh session
  // spawned after approval — when the user next sent a message, its
  // response (with just the fresh opener + reply) REPLACED the local
  // turns state, wiping the pre-approval history + inline
  // celebration. We now retain the pre-approval turns here and
  // prepend them to every subsequent revealApiTurns call so the
  // scrollback stays whole.
  const preApprovalHistoryRef = useRef<LocalTurn[]>([]);
  const AUTO_READ_STORE_KEY = '@george.autoread.cursor.v1';
  const persistAutoReadCursor = useCallback(async (sid: string | null, count: number) => {
    if (!sid) return;
    try {
      const raw = await AsyncStorage.getItem(AUTO_READ_STORE_KEY);
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      map[sid] = count;
      // Bound the map so it doesn't grow forever — keep the last 30.
      const keys = Object.keys(map);
      if (keys.length > 30) {
        for (const k of keys.slice(0, keys.length - 30)) delete map[k];
      }
      await AsyncStorage.setItem(AUTO_READ_STORE_KEY, JSON.stringify(map));
    } catch { /* non-fatal */ }
  }, []);
  const loadAutoReadCursor = useCallback(async (sid: string): Promise<number> => {
    try {
      const raw = await AsyncStorage.getItem(AUTO_READ_STORE_KEY);
      const map: Record<string, number> = raw ? JSON.parse(raw) : {};
      return typeof map[sid] === 'number' ? map[sid] : 0;
    } catch { return 0; }
  }, []);

  // ---- Cleanup any pending reveal timers on unmount ---------------------
  useEffect(() => () => {
    revealTimers.current.forEach(t => clearTimeout(t));
    // Also stop any in-flight auto-read speech so a half-spoken bubble
    // doesn't keep talking after the modal is dismissed.
    stopGeorgeAutoRead();
  }, []);

  // ---- Boot -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        // Prefer explicit resumeSessionId (e.g. paused-event welcome-back
        // from GeorgeButterfly). Otherwise, if the global context has an
        // active session, restore it — this is what makes the
        // conversation follow George across screen navigation (C1 S3).
        // Fall back to a fresh session, sending our current screen so
        // Sonnet can quietly tailor the opener.
        let s: EventSession;
        if (resumeSessionId) {
          s = await georgeApi.eventResume(resumeSessionId);
        } else if (activeSessionId) {
          try {
            s = await georgeApi.eventGet(activeSessionId);
            // If the stored session is terminal, drop it and start fresh.
            if (s.status === 'approved' || s.status === 'cancelled') {
              clearActiveSession();
              s = await georgeApi.eventStart('', currentScreen);
            }
          } catch {
            // Stored id is stale / not ours / expired — start clean.
            clearActiveSession();
            s = await georgeApi.eventStart('', currentScreen);
          }
        } else {
          s = await georgeApi.eventStart('', currentScreen);
        }
        setSessionId(s.session_id);
        setActiveSessionId(s.session_id);
        setStatus(s.status || 'in_progress');
        setDraft(s.draft || null);
        setPendingSuggestion(s.pending_suggestion || null);
        setSuggestionOffered(!!s.suggestion_offered);
        // TestFlight round-2 #4 — load the persisted auto-read cursor
        // so reopens don't re-speak the tail message. For a brand-new
        // session (no persisted entry) the cursor starts at 0 and the
        // opener will be read once, then persisted.
        try {
          lastAutoReadCountRef.current = await loadAutoReadCursor(s.session_id);
        } catch { lastAutoReadCountRef.current = 0; }
        await revealApiTurns(s.turns || []);

        // B6 Session 3 — Consume any pending opener set by
        // `openGeorgeWithPrompt` (e.g. from the "Ask George to edit
        // this event" row on the event details screen). We drop it
        // into the composer so the member can review before sending
        // — trust-first, and it matches the review-first rule from
        // voice input.
        const opener = consumePendingOpener();
        if (opener) setInput(opener);
      } catch {
        setTurns([{
          role: 'george',
          content: "I'd love to help with that. Tell me about the kind of get-together you're hoping to create.",
          revealAt: Date.now(),
        }]);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Staged reveal ----------------------------------------------------
  const revealApiTurns = useCallback(async (apiTurns: EventTurn[]) => {
    // Replace non-latest George turns synchronously; only stage-reveal the
    // latest George turn. This keeps history stable and only animates the
    // new part.
    if (apiTurns.length === 0) { setTurns([...preApprovalHistoryRef.current]); return; }
    // TestFlight round-2 #1 — always prepend the pre-approval history
    // (if any) so a post-approval fresh session's turns append to the
    // previous conversation rather than replace it.
    const history = preApprovalHistoryRef.current;
    const lastIdx = apiTurns.length - 1;
    const last = apiTurns[lastIdx];
    const priorLocal: LocalTurn[] = apiTurns.slice(0, lastIdx).map((t) => ({
      ...t,
      revealAt: 0, // already visible
    }));
    if (last.role === 'user') {
      // No animation for user turns coming from the server.
      setTurns([...history, ...priorLocal, { ...last, revealAt: 0 }]);
      // Advance the auto-read cursor so subsequent George replies stay
      // "fresh" — otherwise a user echo alone would skip the very next
      // George reply.
      lastAutoReadCountRef.current = apiTurns.length;
      return;
    }

    // Show prior turns + a "typing" placeholder for George.
    setTurns([...history, ...priorLocal]);
    setTyping(true);
    await new Promise(r => {
      const t = setTimeout(r, BEAT.typingDots);
      revealTimers.current.push(t);
    });
    setTyping(false);
    // Reveal the George turn (excitement + working + warmth + message
    // all appear together — the individual "beats" between parts are
    // handled by Reanimated fade-in staggers inside the bubble itself).
    setTurns([...history, ...priorLocal, { ...last, revealAt: Date.now() }]);

    // TestFlight #6 follow-up (Garry, 27 July v2): auto-read fires
    // when the turn-count has advanced past our last-auto-read cursor.
    // Deterministic and immune to duplicate content / timestamps.
    if (
      prefs?.autoReadNewMessages
      && last.role === 'george'
      && apiTurns.length > lastAutoReadCountRef.current
    ) {
      lastAutoReadCountRef.current = apiTurns.length;
      // Persist immediately so a modal reopen won't re-speak this turn.
      void persistAutoReadCursor(sessionId, apiTurns.length);
      const text = (
        [last.excitement_line, last.working_line, last.warmth_line, last.content]
          .filter(Boolean) as string[]
      ).join(' ').trim();
      if (text) {
        // Fire-and-forget — errors are already swallowed inside.
        void speakGeorgeAloud(text);
      }
    } else {
      // Even if we skipped auto-read (pref off, or already-spoken),
      // advance the cursor so we don't re-read old turns on the next
      // reveal cycle.
      lastAutoReadCountRef.current = apiTurns.length;
      void persistAutoReadCursor(sessionId, apiTurns.length);
    }

    await new Promise(r => {
      const t = setTimeout(r, BEAT.afterMessage);
      revealTimers.current.push(t);
    });
  }, [prefs?.autoReadNewMessages, sessionId, persistAutoReadCursor]);

  // ---- Scroll -----------------------------------------------------------
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns.length, busy, typing, status, pendingSuggestion]);

  // ---- Send a turn ------------------------------------------------------
  const sendText = useCallback(async (t: string) => {
    if (!t || !sessionId || busy) return;
    setInput('');
    // Optimistic user turn
    setTurns(x => [...x, { role: 'user', content: t, revealAt: 0 }]);
    setBusy(true);
    setTyping(true);
    // Give the typing dots a moment before we swap in the reply
    const gate = new Promise<void>(r => {
      const to = setTimeout(r, BEAT.typingDots);
      revealTimers.current.push(to);
    });
    try {
      // TestFlight round-2 #1 — first message after event approval:
      // lazy-spawn a fresh session using this text as the seed so we
      // don't ping the backend with a redundant opener. The
      // pre-approval history stays in place via
      // preApprovalHistoryRef, which revealApiTurns prepends every
      // call, so the celebration + prior chat remain visible.
      if (postApproval) {
        setPostApproval(false);
        const fresh = await georgeApi.eventStart(t, currentScreen);
        setSessionId(fresh.session_id);
        setActiveSessionId(fresh.session_id);
        setStatus(fresh.status || 'in_progress');
        setDraft(fresh.draft || null);
        setPendingSuggestion(fresh.pending_suggestion || null);
        setSuggestionOffered(!!fresh.suggestion_offered);
        // Persist a fresh cursor for the new session so its opener
        // doesn't count against the auto-read dedup.
        lastAutoReadCountRef.current = 0;
        await gate;
        setTyping(false);
        await revealApiTurns(fresh.turns || []);
        return;
      }
      const [s] = await Promise.all([
        georgeApi.eventTurn(sessionId, t, currentScreen),
        gate,
      ]);
      setStatus(s.status || 'in_progress');
      setDraft(s.draft || null);
      setPendingSuggestion(s.pending_suggestion || null);
      setSuggestionOffered(!!s.suggestion_offered);
      setTyping(false);
      await revealApiTurns(s.turns || []);
    } catch (e) {
      if (__DEV__) console.warn('[GeorgeEventCreation] turn failed:', e);
      setTyping(false);
      setTurns(x => [...x, {
        role: 'george',
        content: "That didn't quite reach me — could you say that once more?",
        revealAt: Date.now(),
      }]);
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy, revealApiTurns, currentScreen, postApproval, setActiveSessionId]);

  // ---- B6 Session 3 — Edit chip handlers -------------------------------
  // Confirm / Keep-as-is / Undo tap turns straight back into normal
  // conversational replies. That way the same edit-flow logic on the
  // backend handles them exactly like a typed reply. The classifier's
  // `_looks_like_confirm` short-circuits these phrases without a real
  // LLM call, so latency stays snappy.
  const onEditAction = useCallback((action: 'confirm' | 'decline' | 'undo') => {
    if (action === 'confirm')      sendText('yes please');
    else if (action === 'decline') sendText('no, keep as is');
    else                           sendText('undo that');
  }, [sendText]);

  // Index of the latest George turn — we only make the change card's
  // chips interactive on this turn (older cards are a historical
  // record, so their chips are disabled and read-only).
  const latestGeorgeIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'george') return i;
    }
    return -1;
  }, [turns]);

  const send = useCallback(() => { sendText(input.trim()); }, [input, sendText]);

  // ---- Suggestion accept / decline --------------------------------------
  const acceptSuggestion = useCallback(() => {
    if (!pendingSuggestion) return;
    const acceptText = pendingSuggestion.kind === 'names'
      ? "Yes please, suggest a few names."
      : pendingSuggestion.kind === 'description'
      ? "Yes please, help me write a description."
      : "Yes please, help make it more inviting.";
    sendText(acceptText);
  }, [pendingSuggestion, sendText]);

  const declineSuggestion = useCallback(() => {
    sendText("Not just yet, thanks.");
  }, [sendText]);

  // ---- Description feedback (3 buttons) --------------------------------
  const descLike     = useCallback(() => sendText("I like it — let's keep that."), [sendText]);
  const descTweak    = useCallback(() => setInput("Let's tweak it — "), []);
  const descAnother  = useCallback(() => sendText("Show me another version."), [sendText]);

  // ---- Approve -----------------------------------------------------------
  // TestFlight feedback #1/#2 (Garry, 27 July 2026): The conversation
  // must NEVER disappear after approval. We now keep the modal open,
  // inject an inline celebration turn into the transcript, add a warm
  // "anything else I can help with?" follow-up, and silently spawn a
  // fresh session so subsequent messages have somewhere to land.
  const approve = useCallback(async () => {
    if (!sessionId || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await georgeApi.eventApprove(sessionId);
      // 1. Snapshot the current turns so they survive the fresh-session
      //    boundary. The pre-approval conversation is the whole reason
      //    the celebration exists — without this snapshot, the next
      //    user message would wipe it.
      const historyBefore: LocalTurn[] = [...turnsRef.current];
      // 2. Inline celebration turn (renders a warm card beneath the bubble)
      const celebrationTitle = result?.target?.title || 'your get-together';
      const isPublished = result?.outcome === 'published';
      const celebrationText = isPublished
        ? `That's lovely — it's live. I've added ${celebrationTitle} to today's activity.`
        : `Off to the FriendPlace team. I've sent ${celebrationTitle} for a quick look, and I'll let you know as soon as it's live.`;
      const celebrationTurn: LocalTurn = {
        role: 'george',
        content: celebrationText,
        revealAt: Date.now(),
        celebration: {
          outcome: result?.outcome || 'published',
          title: result?.target?.title,
          emoji: result?.target?.emoji || '🎉',
          event_id: result?.target?.id,
        },
      };
      // 2. Warm follow-up so the chat naturally continues
      const followUpTurn: LocalTurn = {
        role: 'george',
        content: "Anything else I can help you with?",
        revealAt: Date.now() + 500,
      };
      setTurns(prev => [...prev, celebrationTurn, followUpTurn]);
      // Snapshot AFTER appending celebration + follow-up so those turns
      // are part of the retained history that survives the fresh-session
      // switch below.
      preApprovalHistoryRef.current = [...historyBefore, celebrationTurn, followUpTurn];
      // Auto-read the follow-up too if the pref is on so members
      // don't have to tap Speaker on the celebration turn.
      if (prefs?.autoReadNewMessages) {
        const combined = `${celebrationText} ${followUpTurn.content}`.trim();
        if (combined) void speakGeorgeAloud(combined);
      }
      // 3. Reset event-mode state so composer, not preview, is shown
      setPostApproval(true);
      setStatus('in_progress');
      setDraft(null);
      setPendingSuggestion(null);
      setSuggestionOffered(false);
      setApprovalError(null);
      // 4. DO NOT spawn a fresh session synchronously — the members
      // most common next action is to close the modal ("thank you"),
      // and spawning a session they never use just noises up the
      // backend history. Instead we mark `postApproval = true` and
      // `sendText` will lazily spawn a fresh session the moment they
      // type anything (using their first message as the seed so we
      // skip George's redundant opener).
      // (Previously we called `georgeApi.eventStart` here — that
      // produced a duplicate George opener that clashed with the
      // "Anything else I can help with?" follow-up and confused
      // members. Locked with Garry, 28 July 2026 TestFlight #1.)
      // 5. Scroll to the celebration
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    } catch {
      setApprovalError("I couldn't quite get that through — mind trying again in a moment?");
    } finally {
      setApproving(false);
    }
  }, [sessionId, approving, prefs?.autoReadNewMessages]);

  const askForChanges = useCallback(() => {
    if (!sessionId || busy) return;
    setStatus('in_progress');
    setTurns(x => [...x, {
      role: 'george',
      content: "Of course — what would you like to change?",
      revealAt: Date.now(),
    }]);
  }, [sessionId, busy]);

  const saveForLater = useCallback(async () => {
    if (!sessionId) { onLeave(); return; }
    // Principle #17 + Garry's Option A: "Save for later" NEVER means
    // "delete". Preserve everything so George can pick up where we
    // left off next time. Keep activeSessionId so re-opening resumes.
    try { await georgeApi.eventPause(sessionId); } catch { /* silent */ }
    onLeave();
  }, [sessionId, onLeave]);

  // "Don't save" — the explicit "please forget this one" exit (Garry,
  // 20 July 2026). Cancels the session server-side AND clears our local
  // sticky sessionId, then closes the modal. No pause, no welcome-back
  // on the next tap.
  const dontSave = useCallback(async () => {
    if (!sessionId) { onLeave(); return; }
    try { await georgeApi.eventCancel(sessionId); } catch { /* silent */ }
    clearActiveSession();
    onLeave();
  }, [sessionId, onLeave, clearActiveSession]);

  const showPreview = status === 'drafted' && !!draft;

  // C1 Slice 3 v2 (Garry, 22 July 2026 post-testing): decide whether
  // this session is EVENT MODE (needs Save-for-later / Don't save) or
  // GENERAL CHAT (just Close). Event mode kicks in as soon as we have
  // a real draft OR the session is explicitly in a drafted/paused
  // state OR the composer has been signalling ready_to_draft. Otherwise
  // it's a companion chat and the event-specific labels are misleading.
  const isEventMode = useMemo(() => {
    // TestFlight feedback #1/#2 — once the current session has been
    // approved (celebration turn appended locally), we're back in
    // general-chat mode: header shows "Reset / Close", composer stays
    // usable, and no "Save for later" is offered.
    if (postApproval) return false;
    if (draft) return true;
    if (status === 'drafted' || status === 'paused') return true;
    // If any past George turn advanced to ready_to_draft, treat it as
    // event mode even if we've since backed out to needs_question.
    for (const t of turns) {
      if (t.role === 'george' && t.state === 'ready_to_draft') return true;
    }
    return false;
  }, [draft, status, turns, postApproval]);

  // The last George turn — used to decide whether to show suggestion
  // chips or description-feedback buttons below it.
  const lastGeorgeIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'george') return i;
    }
    return -1;
  }, [turns]);
  const lastGeorgeTurn = lastGeorgeIndex >= 0 ? turns[lastGeorgeIndex] : null;

  const showSuggestionChips =
    !!pendingSuggestion && !busy && !showPreview &&
    lastGeorgeTurn && !!lastGeorgeTurn.suggestion;
  const showDescriptionFeedback =
    !busy && !showPreview &&
    lastGeorgeTurn && !!lastGeorgeTurn.description_written;
  // Welcome-back chips appear when George's most recent turn is the
  // continuity-aware "we were putting together your coffee morning…"
  // opener. Two paths: carry on, or start something new. Guarded to
  // only fire on genuine event mode (Garry, 22 July 2026 v2 — the
  // false "Games hub" resume must not show these chips ever again).
  const showWelcomeBack =
    !busy && !showPreview && isEventMode &&
    lastGeorgeTurn && !!lastGeorgeTurn.welcome_back;

  // C1 Slice 2 — deep-link chip. Show a "Take me there" button when
  // George's most recent turn included a whitelisted navigate_to. Never
  // shown during event creation preview / draft flow.
  const navigateChip = useMemo(() => {
    if (busy || showPreview) return null;
    if (!lastGeorgeTurn || !lastGeorgeTurn.navigate_to) return null;
    return resolveGeorgeNavigate(lastGeorgeTurn.navigate_to);
  }, [busy, showPreview, lastGeorgeTurn]);

  const goNavigate = useCallback(() => {
    if (!navigateChip) return;
    // Close the modal via onLeave (the parent decides whether to
    // "Save for later" or "Don't save" — we just leave), then push
    // to the target route on the next tick so the modal has time to
    // dismiss cleanly. Also mark this as a George-led navigation so
    // the butterfly can flutter into the destination page.
    const href = navigateChip.target.href;
    const destKey = navigateChip.target.key;
    try { markGeorgeLedNavigation(destKey as any); } catch { /* ignore */ }
    try { onLeave?.(); } catch { /* ignore */ }
    setTimeout(() => {
      try { router.push(href as any); } catch { /* ignore */ }
    }, 60);
  }, [navigateChip, onLeave, markGeorgeLedNavigation]);

  const carryOn = useCallback(() => {
    // The member just wants to continue where they left off. We nudge
    // George forward with a warm, natural continuation prompt so he
    // picks up naturally without repeating himself.
    sendText("Yes, let's carry on from where we left off.");
  }, [sendText]);

  const startSomethingNew = useCallback(async () => {
    if (!sessionId) return;
    // Mark the paused conversation as cancelled (the member has moved
    // on) and boot a completely fresh session with George's opener.
    setBusy(true);
    setTyping(true);
    try {
      try { await georgeApi.eventCancel(sessionId); } catch { /* ignore */ }
      // Clear the sticky session id BEFORE starting the new session so
      // an intermediate re-render never resurrects the cancelled one.
      clearActiveSession();
      const s = await georgeApi.eventStart('', currentScreen);
      setSessionId(s.session_id);
      setActiveSessionId(s.session_id);
      setStatus(s.status || 'in_progress');
      setDraft(null);
      setPendingSuggestion(null);
      setSuggestionOffered(false);
      setTyping(false);
      // Replace the whole conversation — the paused thread has ended.
      setTurns([]);
      await revealApiTurns(s.turns || []);
    } catch {
      setTyping(false);
      setTurns([{
        role: 'george',
        content: "I'd love to help with that. Tell me about the kind of get-together you're hoping to create.",
        revealAt: Date.now(),
      }]);
    } finally {
      // Always release busy so the composer keyboard remains available
      // even if the network hiccups (Garry regression, 22 July 2026 —
      // the composer was staying locked after "Start something new").
      setBusy(false);
      setTyping(false);
    }
  }, [sessionId, revealApiTurns, currentScreen, clearActiveSession, setActiveSessionId]);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.wrap, { paddingTop: insets.top + 20 }]}
    >
      <View style={styles.header}>
        <GeorgeButterflyMark size={40} />
        <Text style={styles.headerName}>{personaName}</Text>
        {/* TestFlight round-2 v2 (Garry, 28 July 2026 #5): the two
            header actions are ALWAYS "Save for later" and "Clear
            chat" — never "Reset" or "Don't save". Semantics:
            - Save for later: pauses the session on the server so the
              conversation can be resumed later, then closes the modal.
            - Clear chat: irreversibly forgets the current thread and
              starts fresh next time (still closes the modal). */}
        <Pressable onPress={saveForLater} hitSlop={8}>
          <Text style={styles.headerAction}>Save for later</Text>
        </Pressable>
        <Pressable onPress={dontSave} hitSlop={8}>
          <Text style={styles.headerActionPrimary}>Clear chat</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.map((t, i) => (
          <React.Fragment key={i}>
            <GeorgeBubble
              turn={t}
              firstInThread={i === 0}
            />
            {t.role === 'george' && t.edit ? (
              <EventChangeSummaryCard
                edit={t.edit}
                busy={busy || i !== latestGeorgeIndex}
                onAction={onEditAction}
              />
            ) : null}
            {t.role === 'george' && t.celebration ? (
              <EventCelebrationCard celebration={t.celebration} />
            ) : null}
          </React.Fragment>
        ))}

        {typing && (
          <View style={styles.bubbleRow}>
            <View style={styles.avatarSlot} />
            <View style={[styles.bubble, styles.typingBubble]}>
              <TypingDots />
            </View>
          </View>
        )}

        {showWelcomeBack && (
          <View style={styles.chipsRow}>
            <Pressable
              onPress={carryOn}
              style={({ pressed }) => [styles.chipPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.chipPrimaryText}>Yes, let&rsquo;s carry on</Text>
            </Pressable>
            <Pressable
              onPress={startSomethingNew}
              style={({ pressed }) => [styles.chipSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.chipSecondaryText}>Start something new</Text>
            </Pressable>
          </View>
        )}

        {navigateChip && (
          <View style={styles.chipsRow}>
            <Pressable
              onPress={goNavigate}
              style={({ pressed }) => [styles.chipPrimary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={navigateChip.label}
            >
              <Text style={styles.chipPrimaryText}>{navigateChip.label}</Text>
            </Pressable>
          </View>
        )}

        {showSuggestionChips && (
          <View style={styles.chipsRow}>
            <Pressable
              onPress={acceptSuggestion}
              style={({ pressed }) => [styles.chipPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.chipPrimaryText}>Yes please</Text>
            </Pressable>
            <Pressable
              onPress={declineSuggestion}
              style={({ pressed }) => [styles.chipSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.chipSecondaryText}>Not just yet</Text>
            </Pressable>
          </View>
        )}

        {showDescriptionFeedback && (
          <View style={styles.chipsRow}>
            <Pressable
              onPress={descLike}
              style={({ pressed }) => [styles.chipPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.chipPrimaryText}>I like it</Text>
            </Pressable>
            <Pressable
              onPress={descTweak}
              style={({ pressed }) => [styles.chipSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.chipSecondaryText}>Let&rsquo;s tweak it</Text>
            </Pressable>
            <Pressable
              onPress={descAnother}
              style={({ pressed }) => [styles.chipSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.chipSecondaryText}>Show me another version</Text>
            </Pressable>
          </View>
        )}

        {showPreview && draft && <EventPreviewCard draft={draft} personaName={personaName} />}

        {approvalError ? (<Text style={styles.errText}>{approvalError}</Text>) : null}

        <View style={{ height: 20 }} />
      </ScrollView>

      {showPreview ? (
        <View style={[styles.actionsWrap, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={approve}
            disabled={approving}
            style={({ pressed }) => [styles.primaryBtn, (approving || pressed) && styles.pressed]}
          >
            {approving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>That looks right</Text>
            )}
          </Pressable>
          <Pressable
            onPress={askForChanges}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryBtnText}>Let&rsquo;s change something</Text>
          </Pressable>
          <Pressable
            onPress={saveForLater}
            style={({ pressed }) => [styles.tertiaryBtn, pressed && styles.pressed]}
          >
            <Text style={styles.tertiaryBtnText}>Save for later</Text>
          </Pressable>
          <Pressable
            onPress={dontSave}
            style={({ pressed }) => [styles.tertiaryBtn, pressed && styles.pressed]}
          >
            <Text style={styles.tertiaryBtnText}>Don&rsquo;t save</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.composerWrap}>
          {/* Recording state banner — locked with Garry 22 July 2026.
              Warm, short, clearly visible above the composer. */}
          {voicePhase === 'recording' && (
            <View style={styles.voiceBannerRecording}>
              <View style={styles.voiceDot} />
              <Text style={styles.voiceBannerText}>
                I&rsquo;m listening… {formatVoiceTimer(voiceSeconds)}
              </Text>
            </View>
          )}
          {voicePhase === 'transcribing' && (
            <View style={styles.voiceBannerBusy}>
              <ActivityIndicator size="small" color="#0F766E" />
              <Text style={styles.voiceBannerText}>Just a moment…</Text>
            </View>
          )}
          {permissionBlocked && voicePhase === 'idle' && (
            <View style={styles.voicePermRow}>
              <Text style={styles.voicePermText}>
                Microphone access is turned off. You can enable it in your device settings.
              </Text>
              <Pressable
                onPress={openMicSettings}
                style={({ pressed }) => [styles.voicePermBtn, pressed && styles.pressed]}
              >
                <Text style={styles.voicePermBtnText}>Open Settings</Text>
              </Pressable>
            </View>
          )}
          {voiceError && voicePhase === 'idle' && (
            <View style={styles.voiceErrRow}>
              <Text style={styles.voiceErrText}>{voiceError}</Text>
            </View>
          )}
          <View style={[styles.composerInner, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={`Tell ${personaName} anything\u2026`}
                placeholderTextColor="#94A3B8"
                multiline
                editable={!busy && voicePhase !== 'transcribing'}
                onFocus={() => {
                  requestAnimationFrame(() => {
                    scrollRef.current?.scrollToEnd({ animated: true });
                  });
                }}
              />
              {input.trim().length === 0 ? (
                // Mic mode — text box is empty. Tap to start recording;
                // tap again to stop. Red pulsing glow while recording.
                <Pressable
                  onPress={toggleVoice}
                  disabled={busy || voicePhase === 'transcribing'}
                  accessibilityRole="button"
                  accessibilityLabel={voicePhase === 'recording' ? 'Stop recording' : 'Start recording'}
                  style={({ pressed }) => [
                    styles.micBtn,
                    voicePhase === 'recording' && styles.micBtnRecording,
                    (busy || voicePhase === 'transcribing') && { opacity: 0.5 },
                    pressed && styles.pressed,
                  ]}
                >
                  {voicePhase === 'recording' && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.micPulse,
                        {
                          opacity: micPulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.6] }),
                          transform: [{ scale: micPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
                        },
                      ]}
                    />
                  )}
                  <Ionicons
                    name={voicePhase === 'recording' ? 'stop' : 'mic'}
                    size={22}
                    color="#FFFFFF"
                  />
                </Pressable>
              ) : (
                <Pressable
                  onPress={send}
                  disabled={busy || !input.trim()}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    (busy || !input.trim()) && { opacity: 0.5 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.sendBtnText}>Send</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function formatVoiceTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// -----------------------------------------------------------------------
// GeorgeBubble — staged fade-in reveal for excitement / working / warmth / message
// -----------------------------------------------------------------------

function GeorgeBubble({
  turn, firstInThread,
}: { turn: LocalTurn; firstInThread: boolean }) {
  // Fade-in stagger controls
  const excFade = useRef(new Animated.Value(0)).current;
  const wrkFade = useRef(new Animated.Value(0)).current;
  const wmFade  = useRef(new Animated.Value(0)).current;
  const msgFade = useRef(new Animated.Value(0)).current;
  const isGeorge = turn.role === 'george';
  const needsAnim = isGeorge && (turn.revealAt || 0) > 0;

  useEffect(() => {
    if (!needsAnim) {
      excFade.setValue(1); wrkFade.setValue(1); wmFade.setValue(1); msgFade.setValue(1);
      return;
    }
    excFade.setValue(0); wrkFade.setValue(0); wmFade.setValue(0); msgFade.setValue(0);
    const seq: Animated.CompositeAnimation[] = [];
    const beat = 320;
    // Stagger only the parts that actually exist. Each part gets a
    // 200ms fade + a 320ms pause before the next part.
    if (turn.excitement_line) {
      seq.push(Animated.timing(excFade, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.quad) }));
      seq.push(Animated.delay(beat));
    }
    if (turn.working_line) {
      seq.push(Animated.timing(wrkFade, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.quad) }));
      seq.push(Animated.delay(beat));
    }
    if (turn.warmth_line) {
      seq.push(Animated.timing(wmFade, { toValue: 1, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.quad) }));
      seq.push(Animated.delay(beat));
    }
    seq.push(Animated.timing(msgFade, { toValue: 1, duration: 260, useNativeDriver: true, easing: Easing.out(Easing.quad) }));
    Animated.sequence(seq).start();
  }, [needsAnim, turn.excitement_line, turn.working_line, turn.warmth_line, excFade, wrkFade, wmFade, msgFade]);

  if (!isGeorge) {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowRight]}>
        <View style={styles.userBubble}>
          <Text style={styles.userBubbleText}>{turn.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.bubbleRow}>
      <View style={styles.avatarSlot}>
        {firstInThread && <GeorgeButterflyMark size={28} />}
      </View>
      <View style={styles.bubble}>
        {turn.excitement_line ? (
          <Animated.Text style={[styles.excitementLine, { opacity: excFade }]}>
            {turn.excitement_line}
          </Animated.Text>
        ) : null}
        {turn.working_line ? (
          <Animated.Text style={[styles.workingLine, { opacity: wrkFade }]}>
            {turn.working_line}
          </Animated.Text>
        ) : null}
        {turn.warmth_line ? (
          <Animated.Text style={[styles.warmthLine, { opacity: wmFade }]}>
            {turn.warmth_line}
          </Animated.Text>
        ) : null}
        <Animated.Text style={[styles.bubbleText, { opacity: msgFade }]}>
          {turn.content}
        </Animated.Text>
        {/* C1 Voice Phase 2 — opt-in playback. Speaker icon appears
            beneath any George turn that has actual content. Tap to
            play, tap again to stop. Only one bubble plays at a time. */}
        {needsAnim === false || turn.content ? (
          <SpeakerButton text={buildTurnSpeakText(turn)} />
        ) : null}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------
// SpeakerButton — opt-in TTS playback per George bubble.
// -----------------------------------------------------------------------

/** Composes the text George should actually speak: excitement + working
 * + warmth + message, in reading order, joined by short pauses. Skips
 * anything empty. */
function buildTurnSpeakText(turn: LocalTurn): string {
  const parts = [
    turn.excitement_line, turn.working_line, turn.warmth_line, turn.content,
  ].filter(x => !!(x && x.trim()));
  return parts.join('  ');
}

/** Module-level coordinator: keeps track of the currently-playing
 * button so a new tap can stop the previous one. Only one George
 * bubble ever plays at a time, matching the "no surprise audio"
 * principle. */
let _activeStop: null | (() => void) = null;
function _claimActive(stop: () => void) {
  if (_activeStop && _activeStop !== stop) _activeStop();
  _activeStop = stop;
}
function _releaseActive(stop: () => void) {
  if (_activeStop === stop) _activeStop = null;
}

function SpeakerButton({ text }: { text: string }) {
  const { show } = useToast();
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'playing'>('idle');
  const cachedUriRef = React.useRef<string | null>(null);
  // Active playback controller (fresh Audio element on web,
  // createAudioPlayer on native). We stop this on: tap-to-stop, unmount,
  // voice-preference change, and natural completion.
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
        // No explicit persona — georgeApi.speak() reads the member's
        // persisted preference (Accessibility → George's voice).
        uri = await georgeApi.speak(text);
        cachedUriRef.current = uri;
      }
      // Use the cross-platform playback helper — sidesteps the
      // expo-audio double-play race on web that caused the
      // "restart-after-first-word" stutter.
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
      if (__DEV__) console.warn('[SpeakerButton] playback failed', e);
      const msg = (e?.message || 'Could not play George\u2019s voice');
      // Surface a warm, human error rather than silently no-op'ing.
      show(msg.length > 120 ? 'Could not play George\u2019s voice. Please try again.' : msg);
      // Drop any bad cached URI so the next tap re-fetches.
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

  // When the member switches George ↔ Georgia in Accessibility we
  // must drop the cached audio URI so the next tap re-fetches from
  // the backend with the new voice. Also stop anything playing.
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

  if (!text || !text.trim()) return null;

  return (
    <Pressable
      onPress={play}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={phase === 'playing' ? 'Stop listening' : 'Listen to George'}
      style={({ pressed }) => [styles.speakerBtn, pressed && styles.pressed]}
    >
      {phase === 'loading' ? (
        <ActivityIndicator size="small" color="#0F766E" />
      ) : (
        <Ionicons
          name={phase === 'playing' ? 'stop-circle' : 'volume-medium'}
          size={18}
          color="#0F766E"
        />
      )}
    </Pressable>
  );
}

// -----------------------------------------------------------------------
// Typing dots — three dots pulsing while George is thinking.
// -----------------------------------------------------------------------

function TypingDots() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(v, { toValue: 0, duration: 380, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]));
    const l = [pulse(a, 0), pulse(b, 160), pulse(c, 320)];
    l.forEach(x => x.start());
    return () => l.forEach(x => x.stop());
  }, [a, b, c]);
  const dotStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.05] }) }],
  });
  return (
    <View style={styles.typingWrap}>
      <Animated.View style={[styles.dot, dotStyle(a)]} />
      <Animated.View style={[styles.dot, dotStyle(b)]} />
      <Animated.View style={[styles.dot, dotStyle(c)]} />
    </View>
  );
}

// -----------------------------------------------------------------------

function EventPreviewCard({ draft, personaName }: { draft: EventDraft; personaName: string }) {
  const rows: { label: string; value: string; inferred?: boolean }[] = [];
  const sourceMap = new Map<string, string>();
  for (const s of draft.sources || []) {
    if (s?.field && s?.source) sourceMap.set(s.field, s.source);
  }
  const addRow = (label: string, field: keyof EventDraft, formatter?: (v: any) => string) => {
    const v = draft[field];
    if (v === undefined || v === null || v === '') return;
    const value = formatter ? formatter(v) : String(v);
    rows.push({ label, value, inferred: sourceMap.has(field as string) });
  };

  addRow('Get-together', 'title');
  addRow('Date', 'date', (v) => prettyDate(String(v)));
  addRow('Time', 'time', (v) => prettyTime(String(v)));
  addRow('Where', 'location');
  addRow('Room for', 'capacity', (v) => `${v} people`);
  addRow('Cost', 'price');
  addRow('For', 'audience');
  addRow('About it', 'description');

  return (
    <View style={styles.previewCard}>
      {draft.emoji ? (<Text style={styles.previewEmoji}>{draft.emoji}</Text>) : null}
      <Text style={styles.previewTitle}>Here&rsquo;s what I&rsquo;ve put together</Text>
      <Text style={styles.previewSubtitle}>Have I captured it properly?</Text>
      <View style={{ height: 8 }} />
      {rows.map((r) => (
        <View key={r.label} style={styles.previewRow}>
          <Text style={styles.previewLabel}>{r.label}</Text>
          <Text style={styles.previewValue}>
            {r.value}
            {r.inferred ? <Text style={styles.inferredTag}>  ({personaName} pencilled this in)</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------
// EventCelebrationCard — TestFlight feedback #1/#2 (Garry, 27 July 2026).
// Warm inline confirmation card rendered beneath the celebration turn's
// bubble so the conversation stays visible in the same scroll after an
// event is posted. Replaces the previous fullscreen celebration modal.
// -----------------------------------------------------------------------

function EventCelebrationCard({ celebration }: {
  celebration: NonNullable<LocalTurn['celebration']>;
}) {
  const published = celebration.outcome === 'published';
  const label = published ? 'It\u2019s live' : 'Off to the FriendPlace team';
  const emoji = celebration.emoji || '🎉';
  return (
    <View style={styles.celebrationCard}>
      <View style={styles.celebrationEmojiWrap}>
        <Text style={styles.celebrationEmoji}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.celebrationBadge}>{label}</Text>
        {celebration.title ? (
          <Text style={styles.celebrationTitle} numberOfLines={2}>
            {celebration.title}
          </Text>
        ) : null}
        <Text style={styles.celebrationHint}>
          {published
            ? 'Members can see this in Events now.'
            : 'We\u2019ll let you know as soon as it\u2019s live.'}
        </Text>
      </View>
    </View>
  );
}

function prettyDate(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function prettyTime(t: string): string {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return t;
  const [hh, mm] = t.split(':').map(Number);
  const period = hh >= 12 ? 'pm' : 'am';
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${String(mm).padStart(2, '0')}${period}`;
}

// -----------------------------------------------------------------------

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerName: { fontSize: 17, fontWeight: '800', color: '#0F172A', flex: 1, marginLeft: 6 },
  headerAction: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline', marginRight: 6 },
  headerActionPrimary: { fontSize: 13, color: '#0F766E', fontWeight: '700', textDecorationLine: 'underline' },
  finishLater: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6,
    // flexGrow + flex-end pins short conversations to the bottom of the
    // scroll view, so when the keyboard lifts the wrap and adds padding
    // the chat visually sticks to the composer instead of leaving a
    // large blank space above it. Garry, session 1 keyboard follow-up.
    flexGrow: 1, justifyContent: 'flex-end',
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  bubbleRowRight: { justifyContent: 'flex-end' },
  avatarSlot: { width: 32, height: 32, marginRight: 8, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: 300, backgroundColor: '#CCFBF1',
    borderColor: '#5EEAD4', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  typingBubble: { paddingVertical: 12, paddingHorizontal: 16 },
  typingWrap: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#0F766E' },
  bubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22 },
  excitementLine: {
    fontSize: 15, color: '#0F766E', fontWeight: '700', marginBottom: 4, lineHeight: 22,
  },
  workingLine: {
    fontSize: 13, color: '#475569', fontStyle: 'italic', marginBottom: 4, lineHeight: 18,
  },
  warmthLine: {
    fontSize: 13, color: '#0F766E', fontStyle: 'italic', marginBottom: 6, lineHeight: 18,
  },
  userBubble: {
    maxWidth: 300, backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0', borderWidth: 1,
    borderRadius: 18, borderBottomRightRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14, marginRight: 4,
  },
  userBubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22, fontWeight: '500' },
  chipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginLeft: 40, marginTop: 4, marginBottom: 8,
  },
  chipPrimary: {
    backgroundColor: '#14B8A6', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  chipPrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  chipSecondary: {
    backgroundColor: '#FFFFFF', borderColor: '#CBD5E1', borderWidth: 1, borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  chipSecondaryText: { color: '#0F172A', fontWeight: '700', fontSize: 14 },
  previewCard: {
    marginTop: 12, marginHorizontal: 4,
    backgroundColor: '#F0FDFA', borderColor: '#14B8A6', borderWidth: 1,
    borderRadius: 18, padding: 16,
  },
  previewEmoji: { fontSize: 32, marginBottom: 4 },
  previewTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', letterSpacing: -0.2 },
  previewSubtitle: { fontSize: 14, color: '#0F766E', fontStyle: 'italic', marginTop: 2 },
  previewRow: { marginBottom: 8 },
  previewLabel: { fontSize: 12, color: '#64748B', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  previewValue: { fontSize: 15, color: '#0F172A', lineHeight: 22, marginTop: 2 },
  inferredTag: { fontSize: 11, color: '#0F766E', fontStyle: 'italic' },
  // TestFlight feedback #1/#2 — inline celebration card
  celebrationCard: {
    marginTop: 12, marginHorizontal: 4, marginBottom: 4,
    flexDirection: 'row', gap: 14, alignItems: 'center',
    backgroundColor: '#ECFEFF', borderColor: '#14B8A6', borderWidth: 1,
    borderRadius: 18, padding: 14,
  },
  celebrationEmojiWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#CCFBF1',
    alignItems: 'center', justifyContent: 'center',
  },
  celebrationEmoji: { fontSize: 30 },
  celebrationBadge: {
    fontSize: 11, fontWeight: '800', color: '#0F766E',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  celebrationTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginTop: 2, letterSpacing: -0.2 },
  celebrationHint: { fontSize: 13, color: '#334155', marginTop: 4, lineHeight: 18 },
  errText: {
    fontSize: 13, color: '#DC2626', textAlign: 'center', marginTop: 12,
    paddingHorizontal: 16,
  },
  composerWrap: { backgroundColor: '#FFFFFF' },
  composerInner: { paddingHorizontal: 12, paddingTop: 8 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    backgroundColor: '#F1F5F9', borderRadius: 20, paddingLeft: 14, paddingRight: 4, paddingVertical: 4,
  },
  input: { flex: 1, fontSize: 15, color: '#0F172A', paddingVertical: 8, maxHeight: 120 },
  sendBtn: {
    backgroundColor: '#14B8A6', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 16, alignSelf: 'flex-end',
  },
  sendBtnText: { color: '#FFFFFF', fontWeight: '800' },
  actionsWrap: {
    paddingHorizontal: 16, paddingTop: 12, gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E2E8F0', backgroundColor: '#FFFFFF',
  },
  primaryBtn: {
    backgroundColor: '#14B8A6', paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1',
    paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  secondaryBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '700' },
  tertiaryBtn: { paddingVertical: 8, alignItems: 'center' },
  tertiaryBtnText: { color: '#94A3B8', fontSize: 13, textDecorationLine: 'underline' },
  pressed: { opacity: 0.75 },

  // C1 Voice Phase 1 (Garry 22 July 2026)
  micBtn: {
    backgroundColor: '#0F766E', // deeper teal so it reads as distinct from Send
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 999, alignSelf: 'flex-end',
    minWidth: 46, minHeight: 42,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'visible', // pulse ring extends beyond the button
  },
  micBtnRecording: {
    backgroundColor: '#DC2626', // clear red while listening
  },
  micPulse: {
    position: 'absolute',
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 999,
    backgroundColor: '#DC2626',
  },
  voiceBannerRecording: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FEF2F2',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#FCA5A5',
  },
  voiceBannerBusy: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#F0FDFA',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#99F6E4',
  },
  voiceBannerText: { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  voiceDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC2626',
  },
  voicePermRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#F1F5F9',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#CBD5E1',
  },
  voicePermText: { flex: 1, color: '#0F172A', fontSize: 13 },
  voicePermBtn: {
    backgroundColor: '#0F172A', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
  },
  voicePermBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  voiceErrRow: {
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FEF3F2',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#FEE4E2',
  },
  voiceErrText: { color: '#B42318', fontSize: 13 },
  speakerBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 4, paddingHorizontal: 6,
    borderRadius: 999,
    minWidth: 28, minHeight: 28,
    alignItems: 'center', justifyContent: 'center',
  },
});
