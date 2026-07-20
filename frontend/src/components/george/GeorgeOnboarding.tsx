import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { georgeApi } from '@/src/lib/george-api';

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

// Member-language labels for the preview. NOT database field names.
const FIELD_LABELS: Record<string, string> = {
  preferred_name:    'What I should call you',
  area:              'Your area',
  interests:         'Things you enjoy',
  life_stage:        "What's on for you at the moment",
  availability:      'Times that may suit you',
  wants_more_of:     "You'd like more",
  connection_scope:  "You seem to prefer",
  connection_styles: 'You may prefer',
};

export function GeorgeOnboarding({ onDone, onFinishLater }: Props) {
  const insets = useSafeAreaInsets();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<string>('in_progress');
  const [known, setKnown] = useState<Record<string, Field>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);

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
      setTurns(s.turns || []);
      setStatus(s.status || 'in_progress');
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

  const showPreview = status === 'drafted';

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.wrap, { paddingTop: insets.top + 8 }]}
    >
      <View style={styles.header}>
        <GeorgeButterflyMark size={40} />
        <Text style={styles.headerName}>George</Text>
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

        {showPreview && (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Here&rsquo;s what I&rsquo;ve learned about you</Text>
            {Object.entries(known).map(([k, v]) => (
              <PreviewRow key={k} label={FIELD_LABELS[k] || k} field={v} />
            ))}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {showPreview ? (
        <View style={[styles.actionsWrap, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={approve} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
            <Text style={styles.primaryBtnText}>That looks right</Text>
          </Pressable>
          <Pressable onPress={() => setStatus('in_progress')} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
            <Text style={styles.secondaryBtnText}>Change something</Text>
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
                placeholder="Reply to George…"
                placeholderTextColor="#94A3B8"
                multiline
                editable={!busy}
                onFocus={() => {
                  requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
                }}
              />
              <Pressable onPress={send} disabled={busy || !input.trim()} style={({ pressed }) => [styles.sendBtn, (busy || !input.trim()) && { opacity: 0.5 }, pressed && styles.pressed]}>
                <Text style={styles.sendBtnText}>Send</Text>
              </Pressable>
            </View>
            <Pressable onPress={sendSkip} disabled={busy} hitSlop={6}>
              <Text style={styles.skipChip}>I&rsquo;d rather skip that</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

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
        {inferred && <Text style={styles.inferredTag}>(George inferred this)</Text>}
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
  finishLater: { fontSize: 13, color: '#94A3B8', fontWeight: '600', textDecorationLine: 'underline' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6,
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
