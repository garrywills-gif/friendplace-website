import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, Modal, Image, ActivityIndicator, Linking, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";

const API_BASE = process.env.EXPO_BACKEND_URL || process.env.EXPO_PUBLIC_API_URL || "";

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
  // FriendPlace curated events (CMS-driven). Loaded once on focus,
  // then re-fetched after every RSVP so counts update immediately.
  const [fpEvents, setFpEvents] = useState<any[]>([]);
  const [fpLoading, setFpLoading] = useState(true);
  const [fpDetailSlug, setFpDetailSlug] = useState<string | null>(null);
  const [myFpRsvps, setMyFpRsvps] = useState<any[]>([]);

  const loadFp = useCallback(async () => {
    try {
      setFpLoading(true);
      const r: any = await api.fpEventsList();
      setFpEvents((r?.events || []).filter((e: any) => e.status !== 'cancelled'));
      if (user?.id) {
        try {
          const mine: any = await api.fpEventMyRsvps(user.id);
          setMyFpRsvps(mine?.items || []);
        } catch { /* non-fatal */ }
      }
    } catch {
      setFpEvents([]);
    } finally {
      setFpLoading(false);
    }
  }, [user?.id]);

  const load = async () => setEvents(await api.listEvents());
  useFocusEffect(useCallback(() => { load(); loadFp(); }, [loadFp]));

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
      <Header title="Local Events" backHref="/home" />
      <Pressable testID="event-new" onPress={() => router.push("/events/new" as any)} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: c.brand }}>
        <Ionicons name="add-circle" size={20} color="#FFF" />
        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Host a new event</Text>
      </Pressable>

      {/* FriendPlace curated events section — official events created via
          Mission Control on the website. Shows only when there's at
          least one active event so quiet weeks don't leave a hollow
          section on the screen. */}
      <FriendPlaceEventsSection
        events={fpEvents}
        loading={fpLoading}
        myRsvps={myFpRsvps}
        onOpen={(slug) => setFpDetailSlug(slug)}
      />
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

      {/* FriendPlace event detail + RSVP modal — mounts only when a slug
          is set, so the fetch happens on-demand and never blocks the
          main list from rendering. */}
      {fpDetailSlug && (
        <FpEventDetailModal
          slug={fpDetailSlug}
          onClose={() => setFpDetailSlug(null)}
          onRsvpDone={() => { setFpDetailSlug(null); loadFp(); }}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------
   FriendPlace Events — curated CMS-driven events (separate from the
   community events above). Rendered as a horizontal carousel so the
   community-events list underneath stays the primary interaction.
   ------------------------------------------------------------------ */

function FriendPlaceEventsSection({
  events, loading, myRsvps, onOpen,
}: {
  events: any[];
  loading: boolean;
  myRsvps: any[];
  onOpen: (slug: string) => void;
}) {
  const { c, scale } = useTheme();
  const rsvpBySlug = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of myRsvps || []) {
      const slug = it?.event?.slug;
      if (slug) m[slug] = it?.rsvp?.status || "going";
    }
    return m;
  }, [myRsvps]);

  if (!loading && events.length === 0) return null;

  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 }}>
        <View>
          <Text style={{ fontSize: 11 * scale, fontWeight: "800", letterSpacing: 1.2, color: c.brand, textTransform: "uppercase" }}>
            FriendPlace hosted
          </Text>
          <Text style={{ fontSize: 16 * scale, fontWeight: "900", color: c.onSurface, marginTop: 2 }}>
            Come along ✨
          </Text>
        </View>
      </View>
      {loading ? (
        <View style={{ height: 180, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.brand} />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 6 }}
        >
          {events.map((ev) => {
            const myStatus = rsvpBySlug[ev.slug];
            const cover = ev.cover_image_url
              ? (String(ev.cover_image_url).startsWith("http") ? ev.cover_image_url : `${API_BASE}${ev.cover_image_url}`)
              : null;
            const going = ev.rsvp_counts?.going ?? 0;
            const remaining = ev.capacity ? Math.max(0, ev.capacity - going) : null;
            const isFull = ev.capacity != null && remaining === 0;
            return (
              <Pressable
                key={ev.id}
                testID={`fp-event-${ev.slug}`}
                onPress={() => onOpen(ev.slug)}
                style={{ width: 260, borderRadius: 18, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}
              >
                <View style={{ height: 130, backgroundColor: cover ? "transparent" : c.brand, alignItems: "center", justifyContent: "center" }}>
                  {cover ? (
                    <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <Ionicons name="calendar" size={44} color="#FFF" />
                  )}
                  {myStatus && (
                    <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: myStatus === "going" ? "#DCFCE7" : "#FEF3C7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: myStatus === "going" ? "#166534" : "#92400E", fontSize: 10 * scale, fontWeight: "900", textTransform: "uppercase" }}>
                        {myStatus === "going" ? "You're going" : "On waitlist"}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={{ padding: 12, gap: 4 }}>
                  <Text numberOfLines={1} style={{ fontSize: 11 * scale, color: c.brand, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" }}>
                    {formatFpDate(ev.starts_at, ev.timezone)}
                  </Text>
                  <Text numberOfLines={2} style={{ fontSize: 15 * scale, fontWeight: "900", color: c.onSurface, lineHeight: 20 }}>
                    {ev.title}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                    <Text numberOfLines={1} style={{ fontSize: 12 * scale, color: c.muted, flex: 1 }}>
                      {ev.is_online ? "💻 Online" : (ev.venue_name || "📍 Venue TBD")}
                    </Text>
                    {ev.capacity != null && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: isFull ? "#FEF3C7" : "#DCFCE7" }}>
                        <Text style={{ fontSize: 10 * scale, fontWeight: "800", color: isFull ? "#92400E" : "#166534" }}>
                          {isFull ? "Waitlist" : `${remaining} left`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------
   FriendPlace event detail + one-tap RSVP modal.
   ------------------------------------------------------------------ */

function FpEventDetailModal({
  slug, onClose, onRsvpDone,
}: {
  slug: string;
  onClose: () => void;
  onRsvpDone: () => void;
}) {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [event, setEvent] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [guests, setGuests] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showNoteField, setShowNoteField] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const e: any = await api.fpEventBySlug(slug);
        setEvent(e);
      } finally { setLoading(false); }
    })();
  }, [slug]);

  const submit = async () => {
    if (!user) { show("Please log in first"); return; }
    setSubmitting(true);
    try {
      const res: any = await api.fpEventRsvp(slug, {
        name: (user.first_name || user.username || "").trim(),
        // Some accounts may not have an email — fall back to a
        // placeholder so the backend still accepts the RSVP and
        // links it via user_id (email won't get a confirmation
        // email, but the RSVP itself is recorded).
        email: (user.email || `${user.username || user.id}@app.friendplace.com.au`).trim().toLowerCase(),
        user_id: user.id,
        guests_count: guests,
        note: note.trim() || undefined,
      });
      const going = res?.rsvp?.status === "going";
      show(going ? "🎉 You're in! Check your email for the calendar invite." : "You're on the waitlist. We'll email you if a spot opens up.");
      onRsvpDone();
    } catch (e: any) {
      show(e?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openIcs = () => {
    if (!event?.slug) return;
    const url = `${API_BASE}/api/public/events/${encodeURIComponent(event.slug)}.ics`;
    Linking.openURL(url).catch(() => show("Could not open calendar"));
  };

  const cover = event?.cover_image_url
    ? (String(event.cover_image_url).startsWith("http") ? event.cover_image_url : `${API_BASE}${event.cover_image_url}`)
    : null;

  const going = event?.rsvp_counts?.going ?? 0;
  const remaining = event?.capacity ? Math.max(0, event.capacity - going) : null;
  const isFull = event?.capacity != null && remaining === 0;
  const isCancelled = event?.status === "cancelled";

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" }}>
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: c.border }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {loading ? (
              <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={c.brand} /></View>
            ) : !event ? (
              <Text style={{ color: c.muted, textAlign: "center", padding: 40 }}>Could not load event.</Text>
            ) : (
              <>
                {cover && (
                  <View style={{ aspectRatio: 16 / 9, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
                    <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  </View>
                )}
                {isCancelled && (
                  <View style={{ backgroundColor: "#FEE2E2", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <Text style={{ color: "#991B1B", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 1, textTransform: "uppercase" }}>Cancelled</Text>
                    {event.cancellation_reason ? (
                      <Text style={{ color: "#7F1D1D", marginTop: 4, fontSize: 13 * scale, lineHeight: 20 }}>{event.cancellation_reason}</Text>
                    ) : null}
                  </View>
                )}
                <Text style={{ fontSize: 12 * scale, fontWeight: "800", color: c.brand, textTransform: "uppercase", letterSpacing: 1 }}>
                  {event.is_online ? "Online event" : "In person"}
                </Text>
                <Text style={{ fontSize: 22 * scale, fontWeight: "900", color: c.onSurface, marginTop: 6 }}>
                  {event.title}
                </Text>
                {event.description ? (
                  <Text style={{ marginTop: 10, fontSize: 15 * scale, color: c.onSurface, lineHeight: 22, opacity: 0.85 }}>
                    {event.description}
                  </Text>
                ) : null}

                <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, gap: 10 }}>
                  <Row icon="calendar-outline" label="When" value={formatFpDateLong(event.starts_at, event.timezone)} c={c} scale={scale} />
                  <Row icon="location-outline" label="Where" value={event.is_online ? (event.meeting_url || "Online") : [event.venue_name, event.venue_address].filter(Boolean).join(" · ") || "TBD"} c={c} scale={scale} />
                  {event.cost_display ? <Row icon="cash-outline" label="Cost" value={event.cost_display} c={c} scale={scale} /> : null}
                  {event.capacity != null ? (
                    <Row icon="people-outline" label="Spots" value={isFull ? `Fully booked (${going}/${event.capacity}) — waitlist open` : `${remaining} of ${event.capacity} left`} c={c} scale={scale} />
                  ) : null}
                </View>

                <Pressable onPress={openIcs} style={{ marginTop: 16, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border }}>
                  <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale }}>📅 Add to calendar</Text>
                </Pressable>

                {!isCancelled && (
                  <>
                    {/* Optional guests + note fields — hidden by default so
                        one-tap RSVP is the primary interaction. */}
                    <Pressable onPress={() => setShowNoteField(v => !v)} style={{ marginTop: 16, alignSelf: "flex-start" }}>
                      <Text style={{ color: c.brand, fontWeight: "800", fontSize: 13 * scale }}>
                        {showNoteField ? "Hide extras" : "+ Bring a guest or add a message"}
                      </Text>
                    </Pressable>
                    {showNoteField && (
                      <View style={{ marginTop: 10, gap: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: c.onSurface, fontSize: 14 * scale, fontWeight: "700", flex: 1 }}>Bringing</Text>
                          {[0, 1, 2, 3].map((n) => (
                            <Pressable key={n} onPress={() => setGuests(n)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: guests === n ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: guests === n ? c.brand : c.border }}>
                              <Text style={{ color: guests === n ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 12 * scale }}>
                                {n === 0 ? "Just me" : `+${n}`}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <TextInput
                          value={note}
                          onChangeText={setNote}
                          placeholder="Anything the host should know?"
                          placeholderTextColor={c.muted}
                          multiline
                          style={{ minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, color: c.onSurface, fontSize: 14 * scale, backgroundColor: c.surfaceSecondary, textAlignVertical: "top" }}
                        />
                      </View>
                    )}

                    <Pressable
                      testID="fp-rsvp-submit"
                      onPress={submit}
                      disabled={submitting}
                      style={{ marginTop: 20, paddingVertical: 16, borderRadius: 14, alignItems: "center", backgroundColor: submitting ? c.muted : (isFull ? "#F59E0B" : c.brand) }}
                    >
                      {submitting ? <ActivityIndicator color="#FFF" /> : (
                        <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>
                          {isFull ? "Join the waitlist" : "I'm in — RSVP"}
                        </Text>
                      )}
                    </Pressable>
                    <Text style={{ marginTop: 10, fontSize: 11 * scale, color: c.muted, textAlign: "center" }}>
                      We&rsquo;ll email your confirmation + calendar invite.
                    </Text>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ icon, label, value, c, scale }: any) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <Ionicons name={icon} size={18} color={c.brand} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10 * scale, fontWeight: "800", color: c.muted, letterSpacing: 1, textTransform: "uppercase" }}>{label}</Text>
        <Text style={{ fontSize: 14 * scale, fontWeight: "700", color: c.onSurface, marginTop: 2, lineHeight: 20 }}>{value}</Text>
      </View>
    </View>
  );
}

/** Compact "Sat 25/07" style date pill — Australian formatting. */
function formatFpDate(iso?: string, tz: string = "Australia/Sydney"): string {
  if (!iso) return "Date TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBD";
  try {
    return d.toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", timeZone: tz });
  } catch { return d.toLocaleDateString("en-AU"); }
}

/** Long "Saturday 25/07/2026 · 10:00 am AEST" form used inside detail. */
function formatFpDateLong(iso?: string, tz: string = "Australia/Sydney"): string {
  if (!iso) return "Date TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBD";
  try {
    const date = d.toLocaleDateString("en-AU", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
    const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
    return `${date} · ${time}`;
  } catch { return d.toLocaleString("en-AU"); }
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 10 },
  // alignItems: "flex-start" so multi-line event details (title + date +
  // location on three lines) don't vertically-centre the SpeakButton /
  // Edit column against the middle of the writing — previously the
  // speaker icon appeared "in the middle of the writing" whenever the
  // location line pushed the row to 3+ lines.
  row: { flexDirection: "row", alignItems: "flex-start" },
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
