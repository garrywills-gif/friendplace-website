import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

export default function Events() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [events, setEvents] = useState<any[]>([]);

  const load = async () => setEvents(await api.listEvents());
  useFocusEffect(useCallback(() => { load(); }, []));

  const toggle = async (e: any) => {
    if (!user) return;
    const going = (e.rsvps || []).includes(user.id);
    try {
      if (going) await api.unrsvpEvent(e.id, user.id);
      else await api.rsvpEvent(e.id, user.id);
      show(going ? "RSVP removed" : "🎉 You're going!");
      await load(); await refresh();
    } catch { show("Try again"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Local Events" />
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => {
          const going = user && (item.rsvps || []).includes(user.id);
          return (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={styles.row}>
                <View style={[styles.emojiBox, { backgroundColor: c.brandTertiary }]}><Text style={{ fontSize: 36 }}>{item.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]}>{item.title}</Text>
                  <Text style={[styles.meta, { color: c.muted, fontSize: 14 * scale }]}>📅 {item.date}  🕐 {item.time}</Text>
                  <Text style={[styles.meta, { color: c.muted, fontSize: 14 * scale }]}>📍 {item.location}</Text>
                </View>
              </View>
              {!!item.description && <Text style={[styles.desc, { color: c.onSurfaceSecondary, fontSize: 15 * scale }]}>{item.description}</Text>}
              <View style={styles.bottom}>
                <Text style={[styles.count, { color: c.muted, fontSize: 14 * scale }]}>👥 {(item.rsvps || []).length} going</Text>
                <Pressable
                  testID={`rsvp-${item.id}`}
                  onPress={() => toggle(item)}
                  style={[styles.rsvp, { backgroundColor: going ? c.surfaceTertiary : c.brand, borderColor: going ? c.border : c.brand }]}
                >
                  <Ionicons name={going ? "checkmark-circle" : "calendar"} size={20} color={going ? c.brand : "#FFF"} />
                  <Text style={[styles.rsvpTxt, { color: going ? c.brand : "#FFF", fontSize: 16 * scale }]}>{going ? "Going" : "RSVP"}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  emojiBox: { width: 62, height: 62, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800" },
  meta: { marginTop: 2, fontWeight: "500" },
  desc: { fontWeight: "500" },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  count: { fontWeight: "600" },
  rsvp: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, borderWidth: 2, gap: 6 },
  rsvpTxt: { fontWeight: "800" },
});
