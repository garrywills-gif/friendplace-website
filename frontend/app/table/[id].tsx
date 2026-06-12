import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function TableChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [table, setTable] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [seated, setSeated] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const t = await api.getTable(id);
      setTable(t); setSeated(t.seated_users || []);
      const msgs = await api.tableMessages(id);
      setMessages(msgs);
    })();
    const ws = new WebSocket(wsUrl(`/ws/table/${id}?user_id=${user.id}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "message") {
        setMessages((m) => [...m, data.message]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      } else if (data.type === "presence") {
        setSeated((s) => {
          if (!data.user) return s;
          if (data.event === "join") return s.find((u) => u.id === data.user.id) ? s : [...s, data.user];
          return s.filter((u) => u.id !== data.user.id);
        });
      }
    };
    return () => { ws.close(); if (user && id) api.leaveTable(id, user.id).catch(() => {}); };
  }, [id, user?.id]);

  const send = () => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: text.trim() }));
    setText("");
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={table ? `${table.emoji} ${table.name}` : "Table"} />
      <View style={[styles.seatedBar, { backgroundColor: c.brandTertiary }]}>
        <Ionicons name="people" size={18} color={c.brand} />
        <Text style={{ color: c.brand, fontWeight: "700", marginLeft: 6, fontSize: 14 * scale }}>{seated.length} seated</Text>
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end" }}>
          {seated.slice(0, 5).map((u, i) => (
            <View key={u.id} style={[styles.seatChip, { backgroundColor: c.surfaceSecondary, marginLeft: i === 0 ? 0 : -8, borderColor: c.brandTertiary }]}>
              <Text style={{ fontSize: 16 }}>{u.avatar || "🙂"}</Text>
            </View>
          ))}
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 14 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.user_id === user?.id;
            return (
              <View style={[styles.msgRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                {!mine && <Text style={styles.av}>{item.avatar || "🙂"}</Text>}
                <View style={[styles.bubble, { backgroundColor: mine ? c.brand : c.surfaceSecondary, borderColor: c.border, borderBottomLeftRadius: mine ? 18 : 4, borderBottomRightRadius: mine ? 4 : 18 }]}>
                  {!mine && <Text style={[styles.author, { color: c.muted, fontSize: 13 * scale }]}>{item.user_name}</Text>}
                  <Text style={[styles.body, { color: mine ? "#FFF" : c.onSurface, fontSize: 16 * scale }]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <TextInput
            testID="table-input"
            value={text}
            onChangeText={setText}
            placeholder="Say something kind…"
            placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.onSurface, fontSize: 17 * scale, paddingVertical: 10, paddingHorizontal: 12 }}
            multiline
            onSubmitEditing={send}
          />
          <Pressable testID="table-send" onPress={send} style={[styles.sendBtn, { backgroundColor: c.brand }]}>
            <Ionicons name="send" size={20} color="#FFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  seatedBar: { flexDirection: "row", alignItems: "center", padding: 10, paddingHorizontal: 16 },
  seatChip: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  av: { fontSize: 24 },
  bubble: { maxWidth: "76%", borderRadius: 18, padding: 12, borderWidth: 1 },
  author: { fontWeight: "700", marginBottom: 2 },
  body: { fontWeight: "500" },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 8, borderTopWidth: 1, gap: 8 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
