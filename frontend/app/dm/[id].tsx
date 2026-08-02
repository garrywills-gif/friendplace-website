import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable } from "react-native";
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

  // NOTE: onMicPress was a stub that told users to use the OS keyboard's
  // dictate key. Replaced with a real <VoiceInputButton> below which
  // records via expo-audio and transcribes via whisper-1.

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
        right={other_id && !isSelfDm ? (
        <Pressable testID="dm-report-user" onPress={() => setReportTarget({ type: "user" })} hitSlop={8} style={{ padding: 6 }}>
          <Ionicons name="flag-outline" size={22} color={c.warning} />
        </Pressable>
      ) : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 20 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.user_id === user?.id;
            return (
              <View style={[{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", flexDirection: "row", alignItems: "flex-end", gap: 4 }]}>
                <View style={[{ padding: 12, borderRadius: 18, backgroundColor: mine ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, flexShrink: 1 }]}>
                  <Text style={{ color: mine ? "#FFF" : c.onSurface, fontSize: 16 * scale }}>{item.text}</Text>
                </View>
                {!mine && (
                  <Pressable testID={`dm-report-msg-${item.id}`} onLongPress={() => setReportTarget({ type: "message", id: item.id })} hitSlop={6} style={{ padding: 4 }}>
                    <Ionicons name="flag-outline" size={14} color={c.muted} />
                  </Pressable>
                )}
                {prefs.readMessagesAloud && (
                  <SpeakButton text={item.text} color={mine ? c.brand : c.muted} bg={c.surfaceTertiary} size={18} testID={`speak-msg-${item.id}`} />
                )}
              </View>
            );
          }}
        />
        <View style={[styles.composerRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          {/* Round-8 polish (#4d): DM composer restructured to match
              George Event Creation exactly — input + mic sit inside a
              rounded pill for one visual language across the app. */}
          <View style={[styles.composerPill, { backgroundColor: c.surfaceSecondary }]}>
            <TextInput
              testID="dm-input" value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={c.muted}
              style={[styles.pillInput, { color: c.onSurface, fontSize: 15 * scale }]} multiline />
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
});
