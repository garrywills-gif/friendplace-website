import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function DM() {
  const { id, other_id } = useLocalSearchParams<{ id: string; other_id?: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [other, setOther] = useState<any>(null);
  const [text, setText] = useState("");
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
      }
    };
    return () => ws.close();
  }, [id, user?.id]);

  const send = () => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: text.trim() }));
    setText("");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={other ? `${other.avatar} ${other.first_name}` : "Message"} />
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
              <View style={[{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%" }]}>
                <View style={[{ padding: 12, borderRadius: 18, backgroundColor: mine ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4 }]}>
                  <Text style={{ color: mine ? "#FFF" : c.onSurface, fontSize: 16 * scale }}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <TextInput
            testID="dm-input" value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.onSurface, fontSize: 17 * scale, paddingVertical: 10, paddingHorizontal: 12 }} multiline />
          <Pressable testID="dm-send" onPress={send} style={[styles.sendBtn, { backgroundColor: c.brand }]}><Ionicons name="send" size={20} color="#FFF" /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 8, borderTopWidth: 1, gap: 8 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
