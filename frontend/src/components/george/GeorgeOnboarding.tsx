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
import { speakGeorgeAloud, stopGeorgeAutoRead } from '@/src/lib/george-auto-read';
import { Ionicons } from '@expo/vector-icons';
import { useGeorgeVoiceInput } from '@/src/lib/useGeorgeVoiceInput';
import { useComposerLock } from '@/src/lib/composer-lock';

/**
 * George's onboarding conversation surface — Slice B4 mobile MVP.
 *
 * Principle #17: this is the same continuous conversation that began
 * with the first-meeting introduction. When Alex tapped "Yes, let's
 * begin," George promised to ask a few questions. The next tap of the
 * butterfly picks up exactly there.
 *
 * Design (locked with Garry):
 *   - No re-introduction, no "start onboarding" screen.
 *   - George's first line comes from the backend: warm continuation.
 *   - Listen, don't interrogate; the backend Sonnet prompt handles this.
 *   - Ends with a member-language preview ("Here's what I've learned
 *     about you") and three buttons: "That looks right" / "Change
 *     something" / "Finish later".
 *
 * This is intentionally functional-first — the polished shared engine
 * port is a follow-up slice. What we need this session is proof that
 * the conversation FEELS right.
 */

interface Props {
  onDone: () => void;      // profile written; return to Home
  onFinishLater: () => void;
}

type Turn = { role: 'user' | 'george'; content: string };
type Field = { value: any; source: 'stated' | 'inferred' };

export function GeorgeOnboarding({ onDone, onFinishLater }: Props) {
  const insets = useSafeAreaInsets();
  const { voice } = useGeorgeVoice();
  const voiceLabel = VOICE_LABELS[voice]?.short || 'George';
  const { prefs } = useTheme();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<string>('in_progress');
  // TestFlight round-2 (Garry, 28 July 2026): profile summary card
  // retired. `known` is still populated from server responses so
  // downstream systems (analytics, retries) see the same payload,
  // but nothing renders it. Silence the unused-var warning.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [known, setKnown] = useState<Record<string, Field>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

  // B4 voice input — push-to-talk mic that transcribes into the composer.
  const voiceIn = useGeorgeVoiceInput(setInput);
  const isRecording = voiceIn.voicePhase === 'recording';
  const isTranscribing = voiceIn.voicePhase === 'transcribing';

  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock while the member is drafting, recording, or transcribing so
  // the GlobalDmPrompt defers to the next poll cycle instead of
  // interrupting.
  useComposerLock(input.length > 0 || isRecording || isTranscribing);

  // B4 accessibility — auto-read new George turns aloud when the
  // "Auto-read new messages" setting is on. TestFlight feedback
  // (Garry, 27 July 2026): route through the cloud persona voice so
  // members hear the SAME voice the Speaker (▶︎) button uses, and so
  // the clip plays even when the iOS ringer switch is muted.
  const spokenIdxRef = useRef<number>(-1);
  useEffect(() => {
    if (!prefs?.autoReadNewMessages) return;
    const last = turns.length - 1;
    if (last <= spokenIdxRef.current) return;
    const t = turns[last];
    if (!t || t.role !== 'george' || !t.content?.trim()) return;
    spokenIdxRef.current = last;
    void speakGeorgeAloud(t.content);
  }, [turns, prefs?.autoReadNewMessages]);

  // Stop any in-flight speech when the screen unmounts so a
  // half-spoken bubble doesn't linger after the user leaves.
  useEffect(() => () => { stopGeorgeAutoRead(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await georgeApi.onboardingStart();
        setSessionId(s.session_id);
        setTurns(s.turns || []);
        setStatus(s.status || 'in_progress');
        setKnown(s.known || {});
      } catch {
        setTurns([{ role: 'george', content: "Sorry \u2014 I couldn't quite connect. Give it a moment and try again?" }]);
      } finally { setBusy(false); }
    })();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns.length, busy]);

  async function send() {
    const t = input.trim();
    if (!t || !sessionId || busy) return;
    setInput('');
    setTurns(x => [...x, { role: 'user', content: t }]);
    setBusy(true);
    try {
      const s = await georgeApi.onboardingTurn(sessionId, t);
      // TestFlight round-2 (Garry, 28 July 2026) v2: profile summary
      // card retired. We now unconditionally REPLACE the closing
      // George turn on the drafted transition so the wording is
      // exact regardless of what the LLM produced.
      const returnedTurns: any[] = s.turns || [];
      const nextStatus = s.status || 'in_progress';
      if (nextStatus === 'drafted' && status !== 'drafted') {
        const firstName = (returnedTurns.find((tt: any) => tt.role === 'user')?.content?.split(/\s+/)[0]) || null;
        // TestFlight round-3 v3 (Garry, 29 July 2026 #14): the closing
        // turn now includes a warm invitation to the FP Café — the
        // obvious first destination for a brand-new member. Pairs
        // with the single "☕ Head to FP Café" button below.
        const thankYou = firstName
          ? `That's really helpful, ${firstName}. Thank you. I think I've got a lovely picture of what you enjoy. If I ever get something wrong, just let me know \u2014 I'm always learning.\n\nWhy not head over to the FP Caf\u00e9 first? It's a lovely place to say hello and see who's around. I'll be here if you need me.`
          : `That's really helpful. Thank you. I think I've got a lovely picture of what you enjoy. If I ever get something wrong, just let me know \u2014 I'm always learning.\n\nWhy not head over to the FP Caf\u00e9 first? It's a lovely place to say hello and see who's around. I'll be here if you need me.`;
        // Find the last George turn and replace it. If none exists, append.
        let replaced = false;
        for (let i = returnedTurns.length - 1; i >= 0; i--) {
          if (returnedTurns[i]?.role === 'george') {
            returnedTurns[i] = { ...returnedTurns[i], content: thankYou };
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          returnedTurns.push({ role: 'george', content: thankYou } as any);
        }
      }
      setTurns(returnedTurns);
      setStatus(nextStatus);
      setKnown(s.known || {});
    } catch {
      setTurns(x => [...x, { role: 'george', content: "That didn't quite reach me \u2014 could you say that once more?" }]);
    } finally { setBusy(false); }
  }

  async function sendSkip() {
    if (!sessionId || busy) return;
    setInput('');
    setTurns(x => [...x, { role: 'user', content: "I\u2019d rather skip that" }]);
    setBusy(true);
    try {
      const s = await georgeApi.onboardingTurn(sessionId, "I'd rather skip that");
      setTurns(s.turns || []);
      setStatus(s.status || 'in_progress');
      setKnown(s.known || {});
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!sessionId) return;
    setBusy(true);
    try { await georgeApi.onboardingApprove(sessionId); onDone(); }
    catch { setBusy(false); }
  }

  async function finishLater() {
    if (!sessionId) { onFinishLater(); return; }
    try { await georgeApi.onboardingFinishLater(sessionId); } catch { /* ignore */ }
    onFinishLater();
  }

  async function performClearChat() {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const s = await georgeApi.onboardingReset(sessionId);
      setSessionId(s.session_id);
      setTurns(s.turns || []);
      setStatus(s.status || 'in_progress');
      setKnown(s.known || {});
      setInput('');
      spokenIdxRef.current = -1;
      stopGeorgeAutoRead();
    } catch {
      setTurns(x => [...x, { role: 'george', content: "I couldn\u2019t quite start us over — give it a moment and try again?" }]);
    } finally { setBusy(false); }
  }

  function confirmClearChat() {
    if (!sessionId || busy) return;
    if (Platform.OS === 'web') {
      // React Native's Alert on web only surfaces the message and
      // resolves the first button; use the browser confirm for a
      // real yes/no dialog.
      if (typeof window !== 'undefined' && window.confirm(
        "Start over? This will clear our conversation and begin again from my opening greeting. Anything I\u2019ve already saved to your profile stays."
      )) {
        void performClearChat();
      }
      return;
    }
    Alert.alert(
      'Start over?',
      "This will clear our conversation and begin again from my opening greeting. Anything I\u2019ve already saved to your profile stays.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear chat', style: 'destructive', onPress: () => { void performClearChat(); } },
      ],
    );
  }

  const showPreview = status === 'drafted';

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.wrap, { paddingTop: insets.top + 20 }]}
    >
      <View style={styles.header}>
        <GeorgeButterflyMark size={40} />
        <Text style={styles.headerName}>{voiceLabel}</Text>
        <Pressable
          onPress={confirmClearChat}
          disabled={busy || !sessionId}
          hitSlop={8}
          style={({ pressed }) => [styles.clearChatBtn, (busy || !sessionId) && { opacity: 0.4 }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Clear chat and start over"
        >
          <Ionicons name="refresh" size={14} color="#0F766E" />
          <Text style={styles.clearChatText}>Clear chat</Text>
        </Pressable>
        <Pressable onPress={finishLater} hitSlop={8}>
          <Text style={styles.finishLater}>Finish later</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {turns.map((t, i) => (
          <View key={i} style={[styles.bubbleRow, t.role === 'user' && styles.bubbleRowRight]}>
            {t.role === 'george' ? (
              <View style={styles.avatarSlot}>
                {i === 0 && <GeorgeButterflyMark size={28} />}
              </View>
            ) : null}
            <View style={t.role === 'george' ? styles.bubble : styles.userBubble}>
              <Text style={t.role === 'george' ? styles.bubbleText : styles.userBubbleText}>{t.content}</Text>
              {/* B4 accessibility: tap-to-read on every George bubble
                  (parity with the main George chat). Uses on-device
                  `expo-speech` so it works offline / when the backend
                  can't be reached. */}
              {t.role === 'george' && t.content?.trim() ? (
                <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  <GeorgeSpeakButton text={t.content} color="#0F766E" size={18} />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {busy && !showPreview && (
          <View style={styles.bubbleRow}>
            <View style={styles.avatarSlot} />
            <View style={[styles.bubble, { paddingHorizontal: 18 }]}>
              <ActivityIndicator size="small" color="#14B8A6" />
            </View>
          </View>
        )}

        {/* TestFlight round-2 (Garry, 28 July 2026 addendum) — the
            profile summary card ("Here's what I've learned about
            you") was retired. George's own warm thank-you now
            closes the conversation instead; the two action buttons
            below let the member accept or make changes. */}

        <View style={{ height: 20 }} />
      </ScrollView>

      {showPreview ? (
        <View style={[styles.actionsWrap, { paddingBottom: insets.bottom + 12 }]}>
          {/* TestFlight round-3 (Garry, 29 July 2026 #14): retired the
              "That looks right / Change something" pair — there's no
              summary card to review anymore. Single warm CTA now
              points members to their obvious first destination: the
              FP Café. Finish later still available for pausers. */}
          <Pressable onPress={approve} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
            <Text style={styles.primaryBtnText}>☕ Head to FP Café</Text>
          </Pressable>
          <Pressable onPress={finishLater} style={({ pressed }) => [styles.tertiaryBtn, pressed && styles.pressed]}>
            <Text style={styles.tertiaryBtnText}>Finish later</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.composerWrap}>
          <View style={[styles.composerInner, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={`Reply to ${voiceLabel}\u2026`}
                placeholderTextColor="#94A3B8"
                multiline
                editable={!busy}
                onFocus={() => {
                  requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
                }}
              />
              <Pressable onPress={send} disabled={busy || !input.trim() || isRecording || isTranscribing} style={({ pressed }) => [styles.sendBtn, (busy || !input.trim() || isRecording || isTranscribing) && { opacity: 0.5 }, pressed && styles.pressed]}>
                <Text style={styles.sendBtnText}>Send</Text>
              </Pressable>
              {/* Push-to-talk mic — swaps in only when the composer is empty
                  so the Send action stays the primary tap target once
                  there's text to send. */}
              {!input.trim() && !busy ? (
                <Pressable
                  onPress={isRecording ? voiceIn.stopRecording : voiceIn.startRecording}
                  disabled={isTranscribing}
                  style={({ pressed }) => [
                    styles.micBtn,
                    isRecording && styles.micBtnActive,
                    (pressed || isTranscribing) && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? 'Stop recording' : 'Record voice message'}
                >
                  <Ionicons
                    name={isRecording ? 'stop' : 'mic'}
                    size={20}
                    color={isRecording ? '#FFFFFF' : '#0F766E'}
                  />
                </Pressable>
              ) : null}
            </View>
            {voiceIn.voiceError ? (
              <Pressable onPress={voiceIn.dismissError} hitSlop={6}>
                <Text style={styles.voiceErrorText}>{voiceIn.voiceError}</Text>
              </Pressable>
            ) : voiceIn.permissionBlocked ? (
              <Text style={styles.voiceErrorText}>Microphone access is off. Enable it in Settings to talk to {voiceLabel}.</Text>
            ) : isRecording ? (
              <Text style={styles.recordingHint}>Listening… tap ⏹ to stop ({voiceIn.voiceSeconds}s)</Text>
            ) : isTranscribing ? (
              <Text style={styles.recordingHint}>Transcribing…</Text>
            ) : null}
            <Pressable onPress={sendSkip} disabled={busy} hitSlop={6}>
              <Text style={styles.skipChip}>I&rsquo;d rather skip that</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// PreviewRow — retired 28 July 2026 with the profile summary card.
// Kept as a comment in git history via this stub to make future
// re-introduction trivial.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PreviewRow({ label, field }: { label: string; field: Field }) {
  const val = field?.value;
  const display = Array.isArray(val)
    ? val.map(mapConnectionValue).join(', ')
    : mapConnectionValue(String(val ?? ''));
  const inferred = field?.source === 'inferred';
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue}>
        {display}{inferred ? '  ' : ''}
        {inferred && <Text style={styles.inferredTag}>({voiceLabel} inferred this)</Text>}
      </Text>
    </View>
  );
}

// Turn machine values like `small_group` → human labels.
function mapConnectionValue(v: string): string {
  const m: Record<string, string> = {
    small_group: 'Small groups',
    one_to_one:  'One-to-one',
    large:       'Larger social activities',
    online:      'Online conversation',
    in_person:   'In-person',
    unsure:      'Still figuring out',
    local:       'Local, close-to-home connections',
    broader:     'Broader connections',
    mixed:       'A mix of local and broader',
  };
  return m[v] || v;
}

// ---- Styles -------------------------------------------------------------

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerName: { fontSize: 17, fontWeight: '800', color: '#0F172A', flex: 1, marginLeft: 6 },
  clearChatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, borderColor: '#CCFBF1',
    backgroundColor: '#F0FDFA', marginRight: 8,
  },
  clearChatText: { fontSize: 12, color: '#0F766E', fontWeight: '700' },
  finishLater: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6,
    flexGrow: 1,
    // Onboarding: keep the first George intro comfortably in the
    // upper-middle of the screen rather than tucked against the
    // composer at the bottom. Feels warmer for a new member who
    // just landed.
    justifyContent: 'center',
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  bubbleRowRight: { justifyContent: 'flex-end' },
  avatarSlot: { width: 32, height: 32, marginRight: 8, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    // Matched to the website's George bubble (Garry, 31 July 2026):
    // white + subtle teal border + soft teal glow.
    maxWidth: 300, backgroundColor: '#FFFFFF',
    borderColor: '#CCFBF1', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#14B8A6',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
    }),
  },
  bubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22 },
  userBubble: {
    maxWidth: 300, backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0', borderWidth: 1,
    borderRadius: 18, borderBottomRightRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14, marginRight: 4,
  },
  userBubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22, fontWeight: '500' },
  previewCard: {
    marginTop: 12, marginHorizontal: 4,
    backgroundColor: '#F0FDFA', borderColor: '#14B8A6', borderWidth: 1,
    borderRadius: 18, padding: 16,
  },
  previewTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 10, letterSpacing: -0.2 },
  previewRow: { marginBottom: 8 },
  previewLabel: { fontSize: 12, color: '#64748B', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  previewValue: { fontSize: 15, color: '#0F172A', lineHeight: 22, marginTop: 2 },
  inferredTag: { fontSize: 11, color: '#0F766E', fontStyle: 'italic' },
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
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: '#0F766E',
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: '#DC2626', borderColor: '#B91C1C',
  },
  voiceErrorText: {
    alignSelf: 'center', paddingVertical: 6, fontSize: 12,
    color: '#B91C1C', fontWeight: '600',
  },
  recordingHint: {
    alignSelf: 'center', paddingVertical: 6, fontSize: 12,
    color: '#0F766E', fontWeight: '700',
  },
  skipChip: { alignSelf: 'center', paddingVertical: 8, fontSize: 12, color: '#94A3B8', textDecorationLine: 'underline' },
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
