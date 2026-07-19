import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<LocalTurn[]>([]);
  const [status, setStatus] = useState<EventSession['status']>('in_progress');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<EventSuggestion | null>(null);
  const [, setSuggestionOffered] = useState<boolean>(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [typing, setTyping] = useState(false); // typing-dots
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ---- Cleanup any pending reveal timers on unmount ---------------------
  useEffect(() => () => {
    revealTimers.current.forEach(t => clearTimeout(t));
  }, []);

  // ---- Boot -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const s = resumeSessionId
          ? await georgeApi.eventResume(resumeSessionId)
          : await georgeApi.eventStart('');
        setSessionId(s.session_id);
        setStatus(s.status || 'in_progress');
        setDraft(s.draft || null);
        setPendingSuggestion(s.pending_suggestion || null);
        setSuggestionOffered(!!s.suggestion_offered);
        await revealApiTurns(s.turns || []);
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
    if (apiTurns.length === 0) { setTurns([]); return; }
    const lastIdx = apiTurns.length - 1;
    const last = apiTurns[lastIdx];
    const priorLocal: LocalTurn[] = apiTurns.slice(0, lastIdx).map((t) => ({
      ...t,
      revealAt: 0, // already visible
    }));
    if (last.role === 'user') {
      // No animation for user turns coming from the server.
      setTurns([...priorLocal, { ...last, revealAt: 0 }]);
      return;
    }

    // Show prior turns + a "typing" placeholder for George.
    setTurns(priorLocal);
    setTyping(true);
    await new Promise(r => {
      const t = setTimeout(r, BEAT.typingDots);
      revealTimers.current.push(t);
    });
    setTyping(false);
    // Reveal the George turn (excitement + working + warmth + message
    // all appear together — the individual "beats" between parts are
    // handled by Reanimated fade-in staggers inside the bubble itself).
    setTurns([...priorLocal, { ...last, revealAt: Date.now() }]);
    await new Promise(r => {
      const t = setTimeout(r, BEAT.afterMessage);
      revealTimers.current.push(t);
    });
  }, []);

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
      const [s] = await Promise.all([
        georgeApi.eventTurn(sessionId, t),
        gate,
      ]);
      setStatus(s.status || 'in_progress');
      setDraft(s.draft || null);
      setPendingSuggestion(s.pending_suggestion || null);
      setSuggestionOffered(!!s.suggestion_offered);
      setTyping(false);
      await revealApiTurns(s.turns || []);
    } catch {
      setTyping(false);
      setTurns(x => [...x, {
        role: 'george',
        content: "That didn't quite reach me — could you say that once more?",
        revealAt: Date.now(),
      }]);
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy, revealApiTurns]);

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
  const approve = useCallback(async () => {
    if (!sessionId || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await georgeApi.eventApprove(sessionId);
      onDone(result);
    } catch {
      setApprovalError("I couldn't quite get that through — mind trying again in a moment?");
      setApproving(false);
    }
  }, [sessionId, approving, onDone]);

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
    // left off next time.
    try { await georgeApi.eventPause(sessionId); } catch { /* silent */ }
    onLeave();
  }, [sessionId, onLeave]);

  const showPreview = status === 'drafted' && !!draft;

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
  // opener. Two paths: carry on, or start something new.
  const showWelcomeBack =
    !busy && !showPreview &&
    lastGeorgeTurn && !!lastGeorgeTurn.welcome_back;

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
      const s = await georgeApi.eventStart('');
      setSessionId(s.session_id);
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
      setBusy(false);
    }
  }, [sessionId, revealApiTurns]);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <GeorgeButterflyMark size={40} />
        <Text style={styles.headerName}>George</Text>
        <Pressable onPress={saveForLater} hitSlop={8}>
          <Text style={styles.finishLater}>Save for later</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.map((t, i) => (
          <GeorgeBubble
            key={i}
            turn={t}
            firstInThread={i === 0}
          />
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

        {showPreview && draft && <EventPreviewCard draft={draft} />}

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
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
          style={[styles.composerWrap, { paddingBottom: insets.bottom + 8 }]}
        >
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Tell George about your idea…"
              placeholderTextColor="#94A3B8"
              multiline
              editable={!busy}
            />
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
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
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
      </View>
    </View>
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

function EventPreviewCard({ draft }: { draft: EventDraft }) {
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
            {r.inferred ? <Text style={styles.inferredTag}>  (George pencilled this in)</Text> : null}
          </Text>
        </View>
      ))}
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
  finishLater: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 },
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
  errText: {
    fontSize: 13, color: '#DC2626', textAlign: 'center', marginTop: 12,
    paddingHorizontal: 16,
  },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#FFFFFF' },
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
});
