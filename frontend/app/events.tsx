import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

export default function Events() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [events, setEvents] = useState<any[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = async () => setEvents(await api.listEvents());
  useFocusEffect(useCallback(() => { load(); }, []));

  const setRsvp = async (e: any, resp: "going" | "maybe" | "cant") => {
    if (!user) return;
    try {
      const res: any = await api.rsvpEvent(e.id, user.id, resp);
      if (res?.waitlisted) show(`Event is full — you're on the waitlist (#${res.waitlist_count})`);
      else if (resp === "going") show("🎉 You're going!");
      else if (resp === "maybe") show("Marked as Maybe");
      else show("RSVP updated");
      await load(); await refresh();
    } catch { show("Try again"); }
  };
  const cancelRsvp = async (e: any) => {
    if (!user) return;
    try { await api.unrsvpEvent(e.id, user.id); show("RSVP cancelled"); await load(); await refresh(); }
    catch { show("Try again"); }
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
          const sp = item.sponsor;
          const showCode = !!sp && going && (revealed[item.id] || false);
          return (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={styles.row}>
                <View style={[styles.emojiBox, { backgroundColor: c.brandTertiary }]}><Text style={{ fontSize: 36 }}>{item.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]}>{item.title}</Text>
                  <Text style={[styles.meta, { color: c.muted, fontSize: 14 * scale }]}>📅 {item.date}  🕐 {item.time}</Text>
                  <Text style={[styles.meta, { color: c.muted, fontSize: 14 * scale }]}>📍 {item.location}</Text>
                </View>
                <SpeakButton
                  text={`${item.title}. ${item.date} at ${item.time}. ${item.location}. ${item.description || ""}`}
                  color={c.brand}
                  size={22}
                  testID={`speak-event-${item.id}`}
                />
              </View>
              {!!item.description && <Text style={[styles.desc, { color: c.onSurfaceSecondary, fontSize: 15 * scale }]}>{item.description}</Text>}

              {sp && (
                <View style={[styles.sponsorWrap, { backgroundColor: "#FEF3C7", borderColor: "#FBBF24" }]} testID={`sponsor-${item.id}`}>
                  <View style={styles.sponsorRow}>
                    <View style={[styles.sponsorIcon, { backgroundColor: "#F59E0B" }]}><Ionicons name="ribbon" size={16} color="#FFFFFF" /></View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.sponsorBy, { color: "#92400E", fontSize: 12 * scale }]}>SPONSORED BY</Text>
                      <Text style={[styles.sponsorName, { color: "#78350F", fontSize: 15 * scale }]}>{sp.name}</Text>
                    </View>
                  </View>
                  <Text style={[styles.sponsorMsg, { color: "#78350F", fontSize: 14 * scale }]}>🎁 {sp.message}</Text>
                  {going ? (
                    showCode ? (
                      <View style={[styles.codeBox, { backgroundColor: "#FFFFFF", borderColor: "#F59E0B" }]} testID={`code-${item.id}`}>
                        <Text style={{ color: "#92400E", fontWeight: "700", fontSize: 12 * scale }}>Your discount code</Text>
                        <Text style={{ color: "#78350F", fontWeight: "900", fontSize: 22 * scale, letterSpacing: 2, marginTop: 2 }}>{sp.discount_code}</Text>
                      </View>
                    ) : (
                      <Pressable
                        testID={`reveal-${item.id}`}
                        onPress={() => setRevealed({ ...revealed, [item.id]: true })}
                        style={[styles.revealBtn, { backgroundColor: "#F59E0B" }]}
                      >
                        <Ionicons name="gift" size={18} color="#FFFFFF" />
                        <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 * scale }}>Reveal my discount code</Text>
                      </Pressable>
                    )
                  ) : (
                    <Text style={[styles.sponsorHint, { color: "#92400E", fontSize: 12 * scale }]}>RSVP to unlock the discount code 🔒</Text>
                  )}
                </View>
              )}

              <View style={styles.bottom}>
                {(() => {
                  const goingCount = (item.rsvps || []).length;
                  const cap = item.capacity;
                  const onGoing = user && (item.rsvps || []).includes(user.id);
                  const onMaybe = user && (item.rsvps_maybe || []).includes(user.id);
                  const onCant = user && (item.rsvps_cant || []).includes(user.id);
                  const onWaitlist = user && (item.waitlist || []).includes(user.id);
                  const spotsLeft = cap != null ? Math.max(0, Number(cap) - goingCount) : null;
                  return (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.count, { color: c.muted, fontSize: 13 * scale, marginBottom: 8 }]}>
                        👥 {goingCount}{cap != null ? ` / ${cap}` : ""} going
                        {cap != null && spotsLeft! > 0 && spotsLeft! <= 3 ? ` · only ${spotsLeft} left!` : ""}
                        {cap != null && spotsLeft === 0 ? " · full — waitlist open" : ""}
                        {(item.waitlist || []).length > 0 ? ` · ${(item.waitlist || []).length} on waitlist` : ""}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        <Pressable
                          testID={`rsvp-going-${item.id}`}
                          onPress={() => setRsvp(item, "going")}
                          style={[styles.rsvpSmall, { backgroundColor: (onGoing || onWaitlist) ? c.brand : c.surfaceTertiary, borderColor: (onGoing || onWaitlist) ? c.brand : c.border }]}
                        >
                          <Text style={{ color: (onGoing || onWaitlist) ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{onWaitlist ? "🕒 Waitlist" : onGoing ? "✅ Going" : "Going"}</Text>
                        </Pressable>
                        <Pressable
                          testID={`rsvp-maybe-${item.id}`}
                          onPress={() => setRsvp(item, "maybe")}
                          style={[styles.rsvpSmall, { backgroundColor: onMaybe ? "#F59E0B" : c.surfaceTertiary, borderColor: onMaybe ? "#F59E0B" : c.border }]}
                        >
                          <Text style={{ color: onMaybe ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{onMaybe ? "🤔 Maybe" : "Maybe"}</Text>
                        </Pressable>
                        <Pressable
                          testID={`rsvp-cant-${item.id}`}
                          onPress={() => setRsvp(item, "cant")}
                          style={[styles.rsvpSmall, { backgroundColor: onCant ? c.muted : c.surfaceTertiary, borderColor: onCant ? c.muted : c.border }]}
                        >
                          <Text style={{ color: onCant ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{onCant ? "❌ Can't make it" : "Can't make it"}</Text>
                        </Pressable>
                        {(onGoing || onMaybe || onCant || onWaitlist) && (
                          <Pressable testID={`rsvp-clear-${item.id}`} onPress={() => cancelRsvp(item)} style={[styles.rsvpSmall, { backgroundColor: "transparent", borderColor: c.border }]}>
                            <Text style={{ color: c.muted, fontWeight: "700", fontSize: 12 * scale }}>Clear</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })()}
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
  sponsorWrap: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  sponsorRow: { flexDirection: "row", alignItems: "center" },
  sponsorIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sponsorBy: { fontWeight: "800", letterSpacing: 1 },
  sponsorName: { fontWeight: "800" },
  sponsorMsg: { fontWeight: "600" },
  sponsorHint: { fontStyle: "italic" },
  revealBtn: { paddingVertical: 12, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  codeBox: { padding: 12, borderRadius: 12, borderWidth: 2, alignItems: "center" },
  bottom: { marginTop: 4 },
  count: { fontWeight: "600" },
  rsvp: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, borderWidth: 2, gap: 6 },
  rsvpSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5 },
  rsvpTxt: { fontWeight: "800" },
});
