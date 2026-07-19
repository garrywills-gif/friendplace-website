import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { georgeApi, type EventSession, type EventDraft, type EventApprovalResult } from '@/src/lib/george-api';

/**
 * George's Event Creation surface — Milestone B5 (mobile).
 *
 * Continuous conversation. Same visual language as GeorgeOnboarding.
 * No form. No field-by-field interrogation. George opens with an
 * open-ended invitation ("Tell me about the kind of get-together
 * you're hoping to create.") and the event emerges from the chat.
 *
 * Principle #18 (locked): George earns trust before collecting
 * information. Every conversation begins with curiosity, earns trust
 * through listening, and only asks when it genuinely helps.
 *
 * When George has enough to draft a full event, we render an
 * Action Preview inline with three warm buttons:
 *   - That looks right   → approve + route (published or review)
 *   - Let's change something → continues the conversation
 *   - Save for later     → warm cancel that preserves the draft
 */

interface Props {
  onDone: (result: EventApprovalResult) => void;
  onLeave: () => void;
}

type Turn = EventSession['turns'][number];

export function GeorgeEventCreation({ onDone, onLeave }: Props) {
  const insets = useSafeAreaInsets();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<EventSession['status']>('in_progress');
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // ---- Boot: open with George's warm invitation --------------------------
  useEffect(() => {
    (async () => {
      try {
        const s = await georgeApi.eventStart(''); // bare opener — Principle #18
        setSessionId(s.session_id);
        setTurns(s.turns || []);
        setStatus(s.status || 'in_progress');
        setDraft(s.draft || null);
      } catch {
        // Fallback message — should almost never happen; the backend
        // has its own defensive default too.
        setTurns([{
          role: 'george',
          content: "I'd love to help with that. Tell me about the kind of get-together you're hoping to create.",
        }]);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns.length, busy, status]);

  // ---- Send a turn ------------------------------------------------------
  const send = useCallback(async () => {
    const t = input.trim();
    if (!t || !sessionId || busy) return;
    setInput('');
    setTurns(x => [...x, { role: 'user', content: t }]);
    setBusy(true);
    try {
      const s = await georgeApi.eventTurn(sessionId, t);
      setTurns(s.turns || []);
      setStatus(s.status || 'in_progress');
      setDraft(s.draft || null);
    } catch {
      setTurns(x => [...x, {
        role: 'george',
        content: "That didn't quite reach me — could you say that once more?",
      }]);
    } finally {
      setBusy(false);
    }
  }, [input, sessionId, busy]);

  // ---- Approve → route based on server permissions ----------------------
  const approve = useCallback(async () => {
    if (!sessionId || approving) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await georgeApi.eventApprove(sessionId);
      onDone(result);
    } catch {
      setApprovalError(
        "I couldn't quite get that through — mind trying again in a moment?",
      );
      setApproving(false);
    }
  }, [sessionId, approving, onDone]);

  // "Let's change something" → gentle nudge back into the conversation.
  const askForChanges = useCallback(() => {
    if (!sessionId || busy) return;
    setStatus('in_progress');
    setTurns(x => [...x, {
      role: 'george',
      content: "Of course — what would you like to change?",
    }]);
  }, [sessionId, busy]);

  // "Save for later" → warm cancel; draft preserved server-side.
  const saveForLater = useCallback(async () => {
    if (!sessionId) { onLeave(); return; }
    try { await georgeApi.eventCancel(sessionId); } catch { /* silent */ }
    onLeave();
  }, [sessionId, onLeave]);

  const showPreview = status === 'drafted' && !!draft;

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
          <View key={i} style={[styles.bubbleRow, t.role === 'user' && styles.bubbleRowRight]}>
            {t.role === 'george' ? (
              <View style={styles.avatarSlot}>
                {i === 0 && <GeorgeButterflyMark size={28} />}
              </View>
            ) : null}
            <View style={t.role === 'george' ? styles.bubble : styles.userBubble}>
              {t.role === 'george' && t.excitement_line ? (
                <Text style={styles.excitementLine}>{t.excitement_line}</Text>
              ) : null}
              {t.role === 'george' && t.working_line ? (
                <Text style={styles.workingLine}>{t.working_line}</Text>
              ) : null}
              <Text style={t.role === 'george' ? styles.bubbleText : styles.userBubbleText}>
                {t.content}
              </Text>
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

        {showPreview && draft && <EventPreviewCard draft={draft} />}

        {approvalError ? (
          <Text style={styles.errText}>{approvalError}</Text>
        ) : null}

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
// Event preview card — the Action Preview, phrased warmly.
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
      {draft.emoji ? (
        <Text style={styles.previewEmoji}>{draft.emoji}</Text>
      ) : null}
      <Text style={styles.previewTitle}>
        Here&rsquo;s what I&rsquo;ve put together
      </Text>
      <Text style={styles.previewSubtitle}>
        Have I captured it properly?
      </Text>
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

// -----------------------------------------------------------------------

function prettyDate(iso: string): string {
  // iso: YYYY-MM-DD — render as e.g. "Sat 12 Dec 2026"
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function prettyTime(t: string): string {
  // t: HH:MM — render 12h friendly
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
    maxWidth: 300, backgroundColor: '#FFFFFF',
    borderColor: '#CCFBF1', borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  bubbleText: { fontSize: 15, color: '#0F172A', lineHeight: 22 },
  excitementLine: {
    fontSize: 15, color: '#0F766E', fontWeight: '700', marginBottom: 4, lineHeight: 22,
  },
  workingLine: {
    fontSize: 13, color: '#64748B', fontStyle: 'italic', marginBottom: 4, lineHeight: 18,
  },
  userBubble: {
    maxWidth: 300, backgroundColor: '#14B8A6',
    borderRadius: 18, borderBottomRightRadius: 4,
    paddingVertical: 10, paddingHorizontal: 14, marginRight: 4,
  },
  userBubbleText: { fontSize: 15, color: '#FFFFFF', lineHeight: 22, fontWeight: '600' },
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
