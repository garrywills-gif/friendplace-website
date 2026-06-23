import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

/** Format "YYYY-MM-DD" → "Sat 14 Jun 2026" — friendly for older eyes. */
function formatPrettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
/** Format "HH:MM" (24h) → "9:30 AM" — 12h with capitalised AM/PM. */
function formatPrettyTime(t: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(t || "");
  if (!m) return t || "";
  const h = parseInt(m[1], 10);
  const mins = m[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mins} ${period}`;
}

export default function Events() {
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const [events, setEvents] = useState<any[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // Month filter — "all" | "YYYY-MM"
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const load = async () => setEvents(await api.listEvents());
  useFocusEffect(useCallback(() => { load(); }, []));

  // Build the list of months that actually have events, anchored on the
  // current calendar month + next month for predictability — members
  // shouldn't have to scroll a year of empty months.
  const monthOptions = useMemo(() => {
    const now = new Date();
    const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;
    const label = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const cur = { value: ym(now.getFullYear(), now.getMonth()), label: "This month" };
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nxt = { value: ym(next.getFullYear(), next.getMonth()), label: "Next month" };
    // Any other months present in events.
    const seen = new Set<string>([cur.value, nxt.value]);
    const extras: { value: string; label: string }[] = [];
    for (const e of events) {
      const m = /^(\d{4})-(\d{2})/.exec(e?.date || "");
      if (!m) continue;
      const v = `${m[1]}-${m[2]}`;
      if (seen.has(v)) continue;
      seen.add(v);
      const y = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10) - 1;
      extras.push({ value: v, label: label(y, mm) });
    }
    // Sort extras by chronological order.
    extras.sort((a, b) => (a.value < b.value ? -1 : 1));
    return [{ value: "all", label: "All upcoming" }, cur, nxt, ...extras];
  }, [events]);

  const visibleEvents = useMemo(() => {
    if (monthFilter === "all") return events;
    return events.filter((e) => (e.date || "").startsWith(monthFilter));
  }, [events, monthFilter]);

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
      <Pressable testID="event-new" onPress={() => router.push("/events/new" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: c.brand }}>
        <Ionicons name="add-circle" size={20} color="#FFF" />
        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Host a new event</Text>
      </Pressable>
      {/* Month filter pills — older eyes can quickly jump to "This month" / "Next month".
          The ScrollView gets an explicit height so its pill row can never get
          clipped or overlapped by the Host button above. */}
      <View style={{ height: 56, marginTop: 8 }}>
        <ScrollView
          testID="event-month-pills"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, alignItems: "center", gap: 8 }}
        >
          {monthOptions.map((m) => {
            const on = monthFilter === m.value;
            return (
              <Pressable
                key={m.value}
                testID={`month-pill-${m.value}`}
                onPress={() => setMonthFilter(m.value)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? c.brand : c.surfaceSecondary, borderWidth: 1.5, borderColor: on ? c.brand : c.border }}
              >
                <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={visibleEvents}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) => {
          const going = user && (item.rsvps || []).includes(user.id);
          const sp = item.sponsor;
          const showCode = !!sp && going && (revealed[item.id] || false);
          return (
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: item.cancelled ? "#DC2626" : c.border, borderWidth: item.cancelled ? 2 : 1, opacity: item.cancelled ? 0.85 : 1 }]}>
              {item.cancelled && (
                <View style={{ backgroundColor: "#DC2626", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start", marginBottom: 8 }}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11 * scale }}>CANCELLED</Text>
                </View>
              )}
              <View style={styles.row}>
                <View style={[styles.emojiBox, { backgroundColor: c.brandTertiary }]}><Text style={{ fontSize: 36 }}>{item.emoji}</Text></View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale, textDecorationLine: item.cancelled ? "line-through" : "none" }]}>{item.title}</Text>
                  {/* Date & time prominent for older eyes — bold, brand colour, larger size. */}
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 6, marginBottom: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.brandTertiary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
                      <Ionicons name="calendar" size={16} color={c.brand} />
                      <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>{formatPrettyDate(item.date)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.brandTertiary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
                      <Ionicons name="time" size={16} color={c.brand} />
                      <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>{formatPrettyTime(item.time)}</Text>
                    </View>
                    {/* Recurrence badge — sits next to date/time so attendees
                        instantly see this is a regular session, not a one-off. */}
                    {item.recurrence ? (
                      <View
                        testID={`recur-badge-${item.id}`}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ECFDF5", borderColor: "#10B981", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}
                      >
                        <Ionicons name="repeat" size={14} color="#047857" />
                        <Text style={{ color: "#047857", fontWeight: "900", fontSize: 13 * scale }}>
                          {item.recurrence === "weekly" ? "Weekly" : item.recurrence === "fortnightly" ? "Fortnightly" : item.recurrence === "monthly" ? "Monthly" : "Repeats"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.meta, { color: c.muted, fontSize: 14 * scale }]}>📍 {item.location}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <SpeakButton
                    text={`${item.title}. ${item.date} at ${item.time}. ${item.location}. ${item.description || ""}`}
                    color={c.brand}
                    size={22}
                    testID={`speak-event-${item.id}`}
                  />
                  {user && (user.id === item.host_id || (user as any).is_admin) && (
                    <Pressable testID={`event-edit-${item.id}`} onPress={() => router.push(`/events/edit/${item.id}` as any)} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: c.surfaceTertiary, flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name="pencil" size={14} color={c.brand} />
                      <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale }}>Edit</Text>
                    </Pressable>
                  )}
                </View>
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
