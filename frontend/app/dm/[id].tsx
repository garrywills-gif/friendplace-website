import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { speakGeorgeAuto, stopGeorgeAuto } from "@/src/lib/tts-shared";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import ReportSheet from "@/src/components/ReportSheet";
import { parseAvatar } from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";
import VoiceInputButton from "@/src/components/VoiceInputButton";
import { useComposerLock } from "@/src/lib/composer-lock";

// Notebook look-and-feel (Garry, 4 Aug 2026 TestFlight polish): both
// Notes to Myself and normal chats get a subtle ruled-paper background
// so messaging feels calmer and more readable. Zero functionality
// changes — pure visual treatment sitting behind the existing bubbles.
const NOTEBOOK_BG_SELF = "#F1F7F5";     // pale teal for Notes to Myself
const NOTEBOOK_BG_CHAT = "#FBFAF5";     // near-white cream for normal chats
// Ruled-line + margin-line opacity dialed back by ~40% on 5 Aug 2026
// (Garry launch polish): "fade the blue ruled lines by roughly 30–40%
// so they become more subtle. The notes themselves will stand out a
// little better while still keeping the notebook appearance."
const NOTEBOOK_LINE = "rgba(15,23,42,0.03)";
const NOTEBOOK_MARGIN_LINE = "rgba(220,38,38,0.09)"; // faint red left margin
const NOTEBOOK_LINE_HEIGHT = 32;
const NOTEBOOK_LINE_COUNT = 80;         // ~2560px of ruled paper — enough for any scroll

function NotebookBackground({ bg, showMargin }: { bg: string; showMargin: boolean }) {
  // Static ruled-paper backdrop. Rendered once behind the FlatList so
  // scrolling doesn't cause repaint churn. Doesn't scroll with content
  // — the lines are a visual texture, not a coordinate system. The
  // left margin line is exclusive to Notes to Myself so normal chats
  // stay clean of any journal cue.
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bg }]}>
      {showMargin && (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 44, width: 1, backgroundColor: NOTEBOOK_MARGIN_LINE }} />
      )}
      {Array.from({ length: NOTEBOOK_LINE_COUNT }).map((_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (i + 1) * NOTEBOOK_LINE_HEIGHT,
            height: 1,
            backgroundColor: NOTEBOOK_LINE,
          }}
        />
      ))}
    </View>
  );
}

// Format helpers for date separators + per-bubble timestamps.
function _fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function _fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

// Combined "date · time" caption sitting under every bubble. Garry
// asked for the date to be visible alongside the time, not just the
// time — so we always render both.
function _fmtStamp(iso: string): string {
  const day = _fmtDay(iso);
  const time = _fmtTime(iso);
  if (!day && !time) return "";
  if (!day) return time;
  if (!time) return day;
  return `${day} · ${time}`;
}

// Row types for the FlatList — either a real message or an injected
// date separator computed from consecutive-message day changes.
type SepRow = { key: string; type: "sep"; label: string };
type MsgRow = { key: string; type: "msg"; data: any };
type Row = SepRow | MsgRow;

function _build_rows(messages: any[]): Row[] {
  const out: Row[] = [];
  let lastDay = "";
  for (const m of messages) {
    const iso = m?.created_at || "";
    const day = _fmtDay(iso);
    if (day && day !== lastDay) {
      out.push({ key: `sep-${day}-${m.id || out.length}`, type: "sep", label: day });
      lastDay = day;
    }
    out.push({ key: String(m.id || `m-${out.length}`), type: "msg", data: m });
  }
  return out;
}

export default function DM() {
  const { id, other_id } = useLocalSearchParams<{ id: string; other_id?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user, token } = useAuth();
  const { show } = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [other, setOther] = useState<any>(null);
  const [text, setText] = useState("");
  const [reportTarget, setReportTarget] = useState<null | { type: "user" } | { type: "message"; id: string }>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList>(null);
  // Self-DM (Notes to Myself) — when the other participant is the
  // caller. The Header renames itself and the "report user" button
  // is hidden (there's nobody else to report). (Garry, 2 Aug 2026.)
  const isSelfDm = !!user && !!other_id && other_id === user.id;
  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock whenever the member has typed something so the
  // GlobalDmPrompt defers instead of interrupting. Recording is
  // covered separately by VoiceInputButton's own lock. We also hold
  // the lock while viewing THIS DM screen, but the path filter in
  // dm-notify-context already prevents any prompt for this conv.
  useComposerLock(text.length > 0);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const msgs = await api.dmMessages(id);
      setMessages(msgs);
      if (other_id) try { setOther(await api.getUser(other_id)); } catch {}
      // Mark this conversation as read the moment we open it so the tab
      // badge + list unread count drop to zero. Best-effort — a network
      // hiccup here shouldn't block the chat itself from loading.
      try { await api.dmMarkRead(id); } catch {}
    })();
    const ws = new WebSocket(wsUrl(`/ws/dm/${id}?user_id=${user.id}&token=${encodeURIComponent(token || "")}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "message") {
        setMessages((m) => [...m, data.message]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        // Auto-read incoming messages from the OTHER person if the user
        // enabled it. TestFlight round-5 (Garry, Feb 2026 #15): plays via
        // George's cloud voice instead of Apple's OS default so incoming
        // DMs sound the same as every other read-aloud in the app.
        if (prefs.autoReadNewMessages && data.message?.user_id !== user.id && data.message?.text) {
          void speakGeorgeAuto(String(data.message.text));
        }
        // Since we're actively viewing this thread, keep it marked as read
        // so a fresh incoming message doesn't leave a "1" badge behind.
        if (data.message?.user_id !== user.id) {
          api.dmMarkRead(id).catch(() => {});
        }
      }
    };
    return () => { ws.close(); stopGeorgeAuto(); };
  }, [id, user?.id, prefs.autoReadNewMessages]);

  const send = () => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: text.trim() }));
    setText("");
  };

  // Clear notes — Notes to Myself only. Backend enforces the self-DM
  // guard; we only expose the button when isSelfDm is true so the
  // network 403 path is a safety net, not a UX one.
  //
  // Wording locked with Garry on 5 Aug 2026: notes auto-save the
  // moment they're sent, so any "Save / Disregard"-style dialog is
  // misleading. This is a pure destructive action — the copy reads
  // like clearing a physical notebook.
  //
  // Cross-platform confirm (fix for iOS "trash does nothing" report):
  // React Native's `Alert.alert` is a no-op on web AND has been
  // reported flaky on some iOS builds when the app isn't the topmost
  // presenter. We call it on native for the native look, and fall
  // back to `window.confirm` on web so the button never appears dead.
  const handleClearNotes = () => {
    if (!id) return;
    const doClear = async () => {
      try {
        await api.dmClearMessages(String(id));
        setMessages([]);
        try { show?.("Notebook cleared"); } catch {}
      } catch (e: any) {
        try { show?.(e?.message || "Couldn't clear the notebook. Please try again."); } catch {}
      }
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== "undefined" && window.confirm(
        "Clear notebook?\n\nThis will permanently remove every note from your notebook. This cannot be undone.",
      );
      if (ok) void doClear();
      return;
    }
    Alert.alert(
      "Clear notebook?",
      "This will permanently remove every note from your notebook. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear Notebook", style: "destructive", onPress: () => { void doClear(); } },
      ],
      { cancelable: true },
    );
  };

  // NOTE: onMicPress was a stub that told users to use the OS keyboard's
  // dictate key. Replaced with a real <VoiceInputButton> below which
  // records via expo-audio and transcribes via whisper-1.

  const rows: Row[] = useMemo(() => _build_rows(messages), [messages]);
  const notebookBg = isSelfDm ? NOTEBOOK_BG_SELF : NOTEBOOK_BG_CHAT;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title={
          isSelfDm
            ? "📝 Notes to Myself"
            : other
            ? `${parseAvatar(other.avatar).base ?? ""} ${other.first_name}`
            : "Message"
        }
        titleAccessory={!isSelfDm && other ? <FounderMark user={other} size={15} testID="dm-header-founder" /> : null}
        right={
          isSelfDm ? (
            <Pressable
              testID="dm-clear-notes"
              onPress={handleClearNotes}
              hitSlop={8}
              style={{ padding: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Clear all notes"
            >
              <Ionicons name="trash-outline" size={22} color={c.muted} />
            </Pressable>
          ) : other_id ? (
            <Pressable testID="dm-report-user" onPress={() => setReportTarget({ type: "user" })} hitSlop={8} style={{ padding: 6 }}>
              <Ionicons name="flag-outline" size={22} color={c.warning} />
            </Pressable>
          ) : undefined
        } />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <View style={{ flex: 1 }}>
          <NotebookBackground bg={notebookBg} showMargin={isSelfDm} />
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 20 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              if (item.type === "sep") {
                // Injected day separator (Today / Yesterday / d MMM yyyy).
                return (
                  <View style={styles.sepRow}>
                    <View style={[styles.sepLine, { backgroundColor: c.border }]} />
                    <View style={[styles.sepPill, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <Text style={[styles.sepLabel, { color: c.muted, fontSize: 12 * scale }]}>{item.label}</Text>
                    </View>
                    <View style={[styles.sepLine, { backgroundColor: c.border }]} />
                  </View>
                );
              }
              const m = item.data;
              const mine = m.user_id === user?.id;
              const stamp = _fmtStamp(m.created_at || "");
              return (
                <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
                    <View style={[{ padding: 12, borderRadius: 18, backgroundColor: mine ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, flexShrink: 1 }]}>
                      <Text style={{ color: mine ? "#FFF" : c.onSurface, fontSize: 16 * scale }}>{m.text}</Text>
                    </View>
                    {!mine && !isSelfDm && (
                      <Pressable testID={`dm-report-msg-${m.id}`} onLongPress={() => setReportTarget({ type: "message", id: m.id })} hitSlop={6} style={{ padding: 4 }}>
                        <Ionicons name="flag-outline" size={14} color={c.muted} />
                      </Pressable>
                    )}
                    {prefs.readMessagesAloud && (
                      <SpeakButton text={m.text} color={mine ? c.brand : c.muted} bg={c.surfaceTertiary} size={18} testID={`speak-msg-${m.id}`} />
                    )}
                  </View>
                  {!!stamp && (
                    <Text
                      style={{
                        color: c.muted,
                        fontSize: 11 * scale,
                        alignSelf: mine ? "flex-end" : "flex-start",
                        paddingHorizontal: 6,
                        paddingTop: 2,
                      }}
                    >
                      {stamp}
                    </Text>
                  )}
                </View>
              );
            }}
          />
        </View>
        <View style={[styles.composerRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          {/* Round-8 polish (#4d): DM composer restructured to match
              George Event Creation exactly — input + mic sit inside a
              rounded pill for one visual language across the app. */}
          <View style={[styles.composerPill, { backgroundColor: c.surfaceSecondary }]}>
            <TextInput
              testID="dm-input"
              value={text}
              onChangeText={setText}
              placeholder={isSelfDm ? "Write yourself a note…" : "Type a message…"}
              placeholderTextColor={c.muted}
              style={[styles.pillInput, { color: c.onSurface, fontSize: 15 * scale }]}
              multiline
            />
            <VoiceInputButton
              testID="dm-mic"
              sendTestID="dm-send"
              value={text}
              onChangeText={setText}
              userId={user?.id}
              onError={show}
              size={42}
              onSend={send}
              voiceEnabled={prefs.voiceInputEnabled}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
      {reportTarget && (
        <ReportSheet
          visible={!!reportTarget}
          onClose={() => setReportTarget(null)}
          target_type={reportTarget.type === "user" ? "user" : "message"}
          target_id={reportTarget.type === "message" ? reportTarget.id : undefined}
          target_user_id={other_id}
          target_user_name={other?.first_name}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Round-8 polish (#4d): DM composer 1:1 with George. Outer row has
  // paddings + top border; inner pill hosts input + mic.
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
  },
  composerPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  pillInput: {
    flex: 1,
    paddingVertical: 8,
    maxHeight: 120,
  },
  // Date separator (Today · Yesterday · long date) — a pill nested
  // between two hairlines so it sits calmly on the notebook paper.
  sepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 4,
  },
  sepLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  sepPill: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sepLabel: {
    fontWeight: "600",
  },
});
