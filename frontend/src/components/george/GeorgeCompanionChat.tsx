import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { georgeApi } from '@/src/lib/george-api';
import GeorgeSpeakButton from '@/src/components/george/GeorgeSpeakButton';
import { useGeorgeVoice, VOICE_LABELS } from '@/src/lib/george-voice';
import { useTheme } from '@/src/lib/theme';
import { speakGeorgeAloud, stopGeorgeAutoRead, isGeorgeAutoReadActive } from '@/src/lib/george-auto-read';
import { Ionicons } from '@expo/vector-icons';
import { useGeorgeVoiceInput } from '@/src/lib/useGeorgeVoiceInput';
import { useComposerLock } from '@/src/lib/composer-lock';
import { resolveGeorgeNavigate } from '@/src/lib/george-nav-map';
import { useGeorge } from '@/src/lib/george-context';
import { useRouter } from 'expo-router';

/**
 * George & Georgia — always-available free-form companion chat.
 *
 * Core FriendPlace requirement (Garry, Sep 2026): an openly-AI friend
 * who listens, remembers and just chats — not a questionnaire, not a
 * feature-routing bot. The conversation itself is the purpose.
 *
 * Unlike onboarding this surface has no "profile summary / approve"
 * flow — it's a continuous conversation the member can return to any
 * time. Private memory lives server-side and is recalled naturally.
 */
interface Props {
  onClose: () => void;
}

type Turn = { role: 'user' | 'george'; content: string };

const NAV_COUNTDOWN_SECS = 5;

export function GeorgeCompanionChat({ onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { voice, hydrated } = useGeorgeVoice();
  const { markGeorgeLedNavigation } = useGeorge();
  const router = useRouter();
  const voiceLabel = VOICE_LABELS[voice]?.short || 'George';
  const { prefs } = useTheme();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  // iter244 (Neo, Oct 2026): automatic navigation handoff restored.
  // Once the reply is visible a "Taking you there in 5…4…3…2…1"
  // countdown runs; at zero we wait for any loading/playing speech to
  // finish, then open the page. Sending another message, closing the
  // companion, or unmounting cancels the pending navigation.
  const [pendingNav, setPendingNav] = useState<{ label: string; run: () => void } | null>(null);
  const [countdown, setCountdown] = useState<number>(NAV_COUNTDOWN_SECS);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!pendingNav) return;
    let cancelled = false;
    let n = NAV_COUNTDOWN_SECS;
    setCountdown(n);
    const iv = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n > 0) return;
      clearInterval(iv);
      void (async () => {
        // Never cut George off: hold at zero while speech is still
        // being fetched or played (safety cap so it can't hang).
        const t0 = Date.now();
        while (!cancelled && isGeorgeAutoReadActive() && Date.now() - t0 < 60000) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!cancelled) pendingNav.run();
      })();
    }, 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pendingNav]);

  const voiceIn = useGeorgeVoiceInput(setInput);
  const isRecording = voiceIn.voicePhase === 'recording';
  const isTranscribing = voiceIn.voicePhase === 'transcribing';
  useComposerLock(input.length > 0 || isRecording || isTranscribing);

  // Auto-read new George turns aloud when the accessibility setting is on.
  const spokenIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (!prefs?.autoReadNewMessages) return;
    const last = turns.length - 1;
    if (last <= spokenIdxRef.current) return;
    const t = turns[last];
    if (!t || t.role !== 'george' || !t.content?.trim()) return;
    spokenIdxRef.current = last;
    // iter225 (Garry, Oct 2026 — RED #3): speaker-name prefix is now
    // scoped to multi-person rooms only (FP Café). A 1-to-1 companion
    // chat with George/Georgia has exactly one speaker besides the
    // member, so prefixing every message with "Georgia said, …" is
    // noisy and clearly wrong on real-device playback. Speak the
    // message content only.
    void speakGeorgeAloud(t.content, voice);
  }, [turns, prefs?.autoReadNewMessages, voice]);

  useEffect(() => () => { stopGeorgeAutoRead(); }, []);

  // iter240 (Neo, Oct 2026 — TestFlight #2): on screen mount, kick off
  // the companion LLM warmup in parallel with the session fetch. The
  // backend fires a tiny "ok" prompt that establishes the Anthropic
  // TLS session + pages the model cache in, cutting ~5-10 seconds
  // off the FIRST turn's reply time without changing any user-visible
  // behaviour. Idempotent; the server short-circuits if already warm.
  useEffect(() => {
    void georgeApi.companionWarmup();
    void georgeApi.transcribeWarmup();
  }, []);

  useEffect(() => {
    // Wait for the persona preference to hydrate before loading the
    // session, and reload if the persona changes — otherwise a cold
    // start could capture the default 'george' before AsyncStorage
    // resolves to 'georgia', loading the wrong persona's history (and
    // making the on-screen persona disagree with the conversation).
    if (!hydrated) return;
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const s = await georgeApi.companionGet(voice);
        if (cancelled) return;
        const loaded = (s.turns || []).map((t: any) => ({ role: t.role, content: t.content }));
        // Do NOT auto-replay prior messages on reopen — only genuinely
        // new George turns should be read aloud (and only if the setting
        // is on). Manual replay is always available via the speaker.
        spokenIdxRef.current = loaded.length - 1;
        setTurns(loaded);
      } catch {
        if (cancelled) return;
        setTurns([{ role: 'george', content: "Sorry — I couldn't quite connect. Give it a moment and try again?" }]);
      } finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [hydrated, voice]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns.length, busy]);

  async function send() {
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    // iter244: a new message cancels any pending navigation countdown.
    setPendingNav(null);
    setTurns((x) => [...x, { role: 'user', content: t }]);
    setBusy(true);
    try {
      const s = await georgeApi.companionTurn(t, voice);
      setTurns((x) => [...x, { role: 'george', content: s.message }]);
      // Item 4: if George resolved a navigation intent, take the member
      // there — resolve against the whitelist, flag the George-led nav so
      // the destination plays its flutter-in, then close the chat.
      if (s.navigate_to) {
        const resolved = resolveGeorgeNavigate(s.navigate_to);
        if (resolved) {
          // iter244: staging pendingNav starts the countdown effect
          // above (same render as the reply, so it's already visible).
          const target = resolved;
          setPendingNav({
            label: target.label,
            run: () => {
              try { markGeorgeLedNavigation(target.target.key as any); } catch { /* non-fatal */ }
              try { router.push(target.target.href as any); } catch { /* non-fatal */ }
              setTimeout(() => { try { onClose(); } catch { /* non-fatal */ } }, 0);
            },
          });
        }
      }
    } catch {
      setTurns((x) => [...x, { role: 'george', content: "That didn't quite reach me — could you say that once more?" }]);
    } finally { setBusy(false); }
  }

  async function performClearChat() {
    if (busy) return;
    setBusy(true);
    try {
      const s = await georgeApi.companionReset(voice);
      setTurns((s.turns || []).map((t: any) => ({ role: t.role, content: t.content })));
      setInput('');
      spokenIdxRef.current = -1;
      stopGeorgeAutoRead();
    } catch {
      setTurns((x) => [...x, { role: 'george', content: "I couldn't quite start us over — give it a moment and try again?" }]);
    } finally { setBusy(false); }
  }

  function confirmClearChat() {
    if (busy) return;
    const msg = "Start over? This clears our conversation, but I'll still remember the important things you've told me.";
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) void performClearChat();
      return;
    }
    Alert.alert('Start over?', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear chat', style: 'destructive', onPress: () => { void performClearChat(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.wrap, { paddingTop: insets.top + 20 }]}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <GeorgeButterflyMark size={30} />
          <Text style={styles.headerName} numberOfLines={1}>{voiceLabel}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={confirmClearChat} disabled={busy} hitSlop={8}
          testID="companion-clear"
          style={({ pressed }) => [styles.clearChatBtn, busy && { opacity: 0.4 }, pressed && styles.pressed]}
          accessibilityRole="button" accessibilityLabel="Clear chat and start over">
          <Ionicons name="refresh" size={14} color="#0F766E" />
          <Text style={styles.clearChatText}>Clear chat</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            // iter244: closing the companion cancels pending navigation.
            setPendingNav(null);
            onClose();
          }}
          hitSlop={8}
          testID="companion-close"
        >
          <Text style={styles.finishLater}>Close</Text>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {turns.map((t, i) => (
          <View key={i} style={[styles.bubbleRow, t.role === 'user' && styles.bubbleRowRight]}>
            {t.role === 'george' ? (
              <View style={styles.avatarSlot}>{i === 0 && <GeorgeButterflyMark size={28} />}</View>
            ) : null}
            <View style={t.role === 'george' ? styles.bubble : styles.userBubble}>
              <Text style={t.role === 'george' ? styles.bubbleText : styles.userBubbleText}>{t.content}</Text>
              {t.role === 'george' && t.content?.trim() ? (
                <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  {/* iter225 (Garry, Oct 2026 — RED #3): speaker-name
                      prefix is now scoped to multi-person rooms only
                      (FP Café). This is the 1-to-1 companion chat with
                      George/Georgia, so there's only one speaker
                      besides the member — adding "Georgia said, …" to
                      every bubble was clearly wrong on device. Speak
                      the message content only. */}
                  {/* iter237 (Neo, Oct 2026 — RED #1): prewarm the
                      FIRST bubble so the opening greeting's speaker
                      tap plays instantly. Later bubbles arrive AS the
                      member interacts, so iOS audio session is
                      already warm by then. idx===0 captures the
                      "Hi, I'm Georgia / George" opening line that
                      members typically tap first. */}
                  <GeorgeSpeakButton
                    text={t.content}
                    color="#FFFFFF"
                    size={18}
                    voice={voice}
                    prewarm={i === 0}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {busy && (
          <View style={styles.bubbleRow}>
            <View style={styles.avatarSlot} />
            <View style={[styles.bubble, { paddingHorizontal: 18 }]}>
              <ActivityIndicator size="small" color="#14B8A6" />
            </View>
          </View>
        )}

        {/* iter244: automatic handoff countdown (no tap needed). */}
        {pendingNav ? (
          <View style={{ paddingHorizontal: 20, marginTop: 8, marginBottom: 12, alignItems: 'flex-start' }}>
            <View
              testID="companion-nav-countdown"
              accessibilityRole="text"
              accessibilityLiveRegion="polite"
              accessibilityLabel={countdown > 0 ? `Taking you to ${pendingNav.label} in ${countdown}` : `Taking you to ${pendingNav.label}`}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 999,
                backgroundColor: '#0A2540',
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 16 }}>
                {countdown > 0 ? `Taking you there in ${countdown}…` : 'Taking you there… 🦋'}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={[styles.composerInner, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              testID="companion-input"
              value={input}
              onChangeText={setInput}
              placeholder={`Chat with ${voiceLabel}…`}
              placeholderTextColor="#94A3B8"
              multiline
              // iter214 (Garry, Oct 2026 — RED #1): the post-induction
              // companion chat was gating editable on `!busy`, which left
              // the input READ-ONLY while any background API was in
              // flight (initial load, send, clear). On real device the
              // "busy spinner" could linger just long enough to feel
              // broken ("I can't type!"). Typing is now ALWAYS allowed;
              // Send is still gated so taps can't double-fire a message.
              editable
              onFocus={() => { requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }}
            />
            <Pressable onPress={send} disabled={busy || !input.trim() || isRecording || isTranscribing}
              testID="companion-send"
              style={({ pressed }) => [styles.sendBtn, (busy || !input.trim() || isRecording || isTranscribing) && { opacity: 0.5 }, pressed && styles.pressed]}>
              <Text style={styles.sendBtnText}>Send</Text>
            </Pressable>
            {!input.trim() && !busy ? (
              <Pressable onPress={isRecording ? voiceIn.stopRecording : voiceIn.startRecording} disabled={isTranscribing}
                style={({ pressed }) => [styles.micBtn, isRecording && styles.micBtnActive, (pressed || isTranscribing) && { opacity: 0.6 }]}
                accessibilityRole="button" accessibilityLabel={isRecording ? 'Stop recording' : 'Record voice message'}>
                <Ionicons name={isRecording ? 'stop' : 'mic'} size={20} color={isRecording ? '#FFFFFF' : '#0F766E'} />
              </Pressable>
            ) : null}
          </View>
          {voiceIn.voiceError ? (
            <Pressable onPress={voiceIn.dismissError} hitSlop={6}><Text style={styles.voiceErrorText}>{voiceIn.voiceError}</Text></Pressable>
          ) : voiceIn.permissionBlocked ? (
            <Text style={styles.voiceErrorText}>Microphone access is off. Enable it in Settings to talk to {voiceLabel}.</Text>
          ) : isRecording ? (
            <Text style={styles.recordingHint}>Listening… tap ⏹ to stop ({voiceIn.voiceSeconds}s)</Text>
          ) : isTranscribing ? (
            <Text style={styles.recordingHint}>Transcribing…</Text>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  identity: { alignItems: 'center', gap: 2 },
  headerName: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  clearChatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, borderColor: '#CCFBF1',
    backgroundColor: '#F0FDFA', marginRight: 8,
  },
  clearChatText: { fontSize: 12, color: '#0F766E', fontWeight: '700' },
  finishLater: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  bubbleRowRight: { justifyContent: 'flex-end' },
  avatarSlot: { width: 32, height: 32, marginRight: 8, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: 300, backgroundColor: '#14B8A6',
    borderColor: '#0F766E', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14,
    ...Platform.select({
      ios: { shadowColor: '#14B8A6', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
    }),
  },
  bubbleText: { fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  userBubble: {
    maxWidth: 300, backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0', borderWidth: 1,
    borderRadius: 18, borderBottomRightRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14, marginRight: 4,
  },
  userBubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22, fontWeight: '500' },
  composerWrap: { backgroundColor: '#FFFFFF' },
  composerInner: { paddingHorizontal: 12, paddingTop: 8 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    backgroundColor: '#F1F5F9', borderRadius: 20, paddingLeft: 14, paddingRight: 4, paddingVertical: 4,
  },
  input: { flex: 1, fontSize: 15, color: '#0F172A', paddingVertical: 8, maxHeight: 120 },
  sendBtn: { backgroundColor: '#14B8A6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, alignSelf: 'flex-end' },
  sendBtnText: { color: '#FFFFFF', fontWeight: '800' },
  micBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: '#0F766E', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { backgroundColor: '#DC2626', borderColor: '#B91C1C' },
  voiceErrorText: { alignSelf: 'center', paddingVertical: 6, fontSize: 12, color: '#B91C1C', fontWeight: '600' },
  recordingHint: { alignSelf: 'center', paddingVertical: 6, fontSize: 12, color: '#0F766E', fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
