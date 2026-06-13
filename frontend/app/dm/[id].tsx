import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import ReportSheet from "@/src/components/ReportSheet";

export default function DM() {
  const { id, other_id } = useLocalSearchParams<{ id: string; other_id?: string }>();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [other, setOther] = useState<any>(null);
  const [text, setText] = useState("");
  const [reportTarget, setReportTarget] = useState<null | { type: "user" } | { type: "message"; id: string }>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const msgs = await api.dmMessages(id);
      setMessages(msgs);
      if (other_id) try { setOther(await api.getUser(other_id)); } catch {}
    })();
    const ws = new WebSocket(wsUrl(`/ws/dm/${id}?user_id=${user.id}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "message") {
        setMessages((m) => [...m, data.message]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        // Auto-read incoming messages from the OTHER person if the user enabled it
        if (prefs.autoReadNewMessages && data.message?.user_id !== user.id && data.message?.text) {
          Speech.speak(String(data.message.text), { language: "en-US", rate: 0.95, pitch: 1.02 });
        }
      }
    };
    return () => { ws.close(); Speech.stop(); };
  }, [id, user?.id, prefs.autoReadNewMessages]);

  const send = () => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: text.trim() }));
    setText("");
  };

  const onMicPress = () => {
    show("Voice input will be wired in the next backend update");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={other ? `${other.avatar} ${other.first_name}` : "Message"} right={other_id ? (
        <Pressable testID="dm-report-user" onPress={() => setReportTarget({ type: "user" })} hitSlop={8} style={{ padding: 6 }}>
          <Ionicons name="flag-outline" size={22} color={c.warning} />
        </Pressable>
      ) : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 8 }}
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
        <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          {prefs.voiceInputEnabled && (
            <Pressable testID="dm-mic" onPress={onMicPress} accessibilityLabel="Voice input" style={[styles.micBtn, { backgroundColor: c.brandTertiary }]}>
              <Ionicons name="mic" size={20} color={c.brand} />
            </Pressable>
          )}
          <TextInput
            testID="dm-input" value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.onSurface, fontSize: 17 * scale, paddingVertical: 10, paddingHorizontal: 12 }} multiline />
          <Pressable testID="dm-send" onPress={send} style={[styles.sendBtn, { backgroundColor: c.brand }]}><Ionicons name="send" size={20} color="#FFF" /></Pressable>
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
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 8, borderTopWidth: 1, gap: 8 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  micBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
