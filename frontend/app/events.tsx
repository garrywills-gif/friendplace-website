import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, Modal, Image, ActivityIndicator, Linking, TextInput, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Calendar from "expo-calendar";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import { shareIcs } from "@/src/lib/ics";
import TappableImage from "@/src/components/TappableImage";
import { resolveImageSource } from "@/src/components/GalleryPicker";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_API_URL || "";

// Batch B iter157 (Garry, Aug 2026 — P0 #6): open the OS's native
// "add event" sheet so iOS/Android members save it straight to Apple
// Calendar / Google Calendar / Outlook without going through .ics
// Share Sheet friction. On web we still fall back to the .ics share.
async function addToNativeCalendar(opts: {
  title: string;
  description?: string;
  location?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm (24h) */
  time: string;
  durationMinutes?: number;
}): Promise<"created" | "cancelled" | "web" | "error"> {
  if (Platform.OS === "web") return "web";
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (!perm.granted) return "error";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.date || "");
    const t = /^(\d{2}):(\d{2})$/.exec(opts.time || "");
    if (!m || !t) return "error";
    const startDate = new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      parseInt(t[1], 10),
      parseInt(t[2], 10),
      0,
    );
    const endDate = new Date(
      startDate.getTime() + (opts.durationMinutes || 90) * 60_000,
    );
    // SDK 51+: `createEventInCalendarAsync` opens the native "New Event"
    // UI so the member can pick which calendar to save into. We prefer
    // this over silently writing to the default calendar — some members
    // have multiple accounts and would be surprised.
    const anyCal: any = Calendar as any;
    if (typeof anyCal.createEventInCalendarAsync === "function") {
      const res = await anyCal.createEventInCalendarAsync({
        title: opts.title,
        notes: opts.description || "",
        location: opts.location || "",
        startDate,
        endDate,
      });
      // Response shape varies by platform; treat anything with an id or
      // action === "saved" as success.
      if (res && (res.action === "saved" || res.id)) return "created";
      if (res && res.action === "canceled") return "cancelled";
      return "created";
    }
    // Older SDKs — fall back to writing to the default calendar (still
    // native, just no picker UI).
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const writable = calendars.find(
      (c: any) => c.allowsModifications && (c.source?.name || c.source?.type),
    );
    if (!writable) return "error";
    await Calendar.createEventAsync(writable.id, {
      title: opts.title,
      notes: opts.description || "",
      location: opts.location || "",
      startDate,
      endDate,
    });
    return "created";
  } catch (e) {
    return "error";
  }
}

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
  // Discovery-focused filter set. Answers the primary question a member
  // opening the app has — "what can I do NOW?" — with time-relative
  // shortcuts. Deep-future browsing is deliberately absent from this
  // row: organisers who need to plan months ahead post via the "Host
  // a new event" flow above, and members who want to look ahead just
  // pick "All upcoming" and scroll. Adding a full calendar picker is
  // a future enhancement — this row is the fast lane.
  //
  // "Near me" uses the caller's own suburb (from their profile) as a
  // substring match against the event's location string. It's not
  // geo-accurate, but it's honest: FriendPlace stores suburb, not
  // lat/lng, and matching by suburb reflects what a member would
  // eyeball ("is this in my area?"). If the user has no suburb set
  // we surface a friendly nudge to add it — see the empty-state
  // handling in the list below.
  type FilterKey = "all" | "today" | "this_week" | "this_weekend" | "this_month" | "near_me";
  const filterOptions: { value: FilterKey; label: string }[] = useMemo(() => ([
    { value: "all",           label: "All upcoming" },
    { value: "today",         label: "Today" },
    { value: "this_week",     label: "This week" },
    { value: "this_weekend",  label: "This weekend" },
    { value: "this_month",    label: "This month" },
    { value: "near_me",       label: "Near me" },
  ]), []);
  const [filter, setFilter] = useState<FilterKey>("all");

  const visibleEvents = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => matchesEventFilter(e, filter, user));
  }, [events, filter, user]);

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

      {/* Filter pills — Garry, 2 Aug 2026: PINNED above the list so
          "Today / This week / This month / All upcoming" always stay
          visible even after the user scrolls into future events.
          Previously these sat inside `ListHeaderComponent` and scrolled
          off, forcing members to scroll all the way back up to change
          filters. */}
      <View style={{ height: 56, marginTop: 8 }}>
        <ScrollView
          testID="event-filter-pills"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, alignItems: "center", gap: 8 }}
        >
          {filterOptions.map((m) => {
            const on = filter === m.value;
            return (
              <Pressable
                key={m.value}
                testID={`filter-pill-${m.value}`}
                onPress={() => setFilter(m.value)}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: on ? c.brand : c.surfaceSecondary, borderWidth: 1.5, borderColor: on ? c.brand : c.border, flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                {m.value === "near_me" && (
                  <Ionicons name="location" size={12} color={on ? "#FFF" : c.brand} />
                )}
                <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Only the events list itself scrolls below — Host button + filter
          pills remain sticky at the top. */}
      <FlatList
        data={visibleEvents}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          <EventsEmptyState filter={filter} user={user} onClearFilter={() => setFilter("all")} c={c} scale={scale} />
        }
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            {/* FriendPlace curated events section (Mission Control-driven). */}
            <View style={{ marginHorizontal: -16 }}>
              <FriendPlaceEventsSection
                events={fpEvents}
                loading={fpLoading}
                myRsvps={myFpRsvps}
                onOpen={(slug) => setFpDetailSlug(slug)}
              />
            </View>
          </View>
        }
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
              {/* Community-event cover photo (added launch batch). Wired
                  through the shared TappableImage so members can tap to
                  enlarge. `resolveImageSource` accepts the three storage
                  formats: gallery:<theme>/NN, data:image/... URI, http(s) URL. */}
              {item.image ? (() => {
                const src = resolveImageSource(item.image);
                return src ? (
                  <TappableImage
                    source={src}
                    style={{ width: "100%", height: 160, borderRadius: 12, marginBottom: 12 }}
                    resizeMode="cover"
                    caption={item.title}
                    accessibilityLabel="View event cover larger"
                    testID={`event-cover-${item.id}`}
                  />
                ) : null;
              })() : null}
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
                      {/* Add-to-calendar for community events. Batch B
                          iter156 (Garry, Aug 2026 — P1 #6). Builds an
                          .ics client-side and shares to the OS so the
                          member can save it to Apple / Google /
                          Outlook without a backend round trip. */}
                      <Pressable
                        testID={`event-add-cal-${item.id}`}
                        onPress={async () => {
                          // Batch B iter157 (Garry, Aug 2026 — P0 #6):
                          // prefer the native "New Event" sheet on
                          // iOS/Android; fall back to .ics share
                          // (email/AirDrop/etc.) if the native path
                          // isn't available or the user hasn't granted
                          // Calendar access.
                          const nativeRes = await addToNativeCalendar({
                            title: item.title || "FriendPlace event",
                            description: item.description || "",
                            location: item.location || "",
                            date: item.date,
                            time: item.time,
                          });
                          if (nativeRes === "created") {
                            show("Added to your calendar 📅");
                            return;
                          }
                          if (nativeRes === "cancelled") return;
                          // Non-native path (web) or Calendar permission
                          // refused — fall back to the .ics share so
                          // members can still get the event into their
                          // calendar of choice.
                          const ok = await shareIcs({
                            uid: item.id,
                            title: item.title || "FriendPlace event",
                            description: item.description || "",
                            location: item.location || "",
                            date: item.date,
                            time: item.time,
                          });
                          if (!ok) show("Could not open calendar");
                        }}
                        style={{ marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.brandTertiary, borderWidth: 1, borderColor: c.brand }}
                      >
                        <Ionicons name="calendar-outline" size={14} color={c.brand} />
                        <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale }}>Add to calendar</Text>
                      </Pressable>
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

  // Never hide the featured section outright — a warm empty-state
  // is more inviting than nothing, and doubles as a subtle "we do
  // put on events" reassurance to first-time visitors.
  const hasEvents = events.length > 0;

  return (
    <View style={{ marginTop: 14 }}>
      {/* Section heading — deliberately warm & specific. Says
          "HOSTED BY FRIENDPLACE" (not "Featured") because "Featured"
          could imply promoted/sponsored spots — reserved for later
          when local orgs (RSL, libraries, Men's Shed, Rotary, etc.)
          start hosting alongside us. This section is strictly
          FriendPlace-run. */}
      <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: c.brand }} />
          <Text style={{ fontSize: 10 * scale, fontWeight: "900", letterSpacing: 1.5, color: c.brand, textTransform: "uppercase" }}>
            Hosted by FriendPlace
          </Text>
        </View>
        <Text style={{ fontSize: 17 * scale, fontWeight: "900", color: c.onSurface, letterSpacing: -0.2 }}>
          Come and join us ✨
        </Text>
        <Text style={{ fontSize: 12 * scale, color: c.muted, marginTop: 2, lineHeight: 17 }}>
          Warm meetups our team has planned. Everyone&rsquo;s welcome — pull up a chair.
        </Text>
      </View>

      {loading ? (
        <View style={{ height: 140, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.brand} />
        </View>
      ) : !hasEvents ? (
        // Empty-state — encouraging tone, not apologetic.
        <View style={{ marginHorizontal: 16, padding: 16, borderRadius: 14, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ fontSize: 28 }}>☕</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13 * scale, fontWeight: "800", color: c.onSurface }}>
              Nothing on our calendar just yet
            </Text>
            <Text style={{ fontSize: 12 * scale, color: c.muted, marginTop: 2, lineHeight: 16 }}>
              We&rsquo;re planning the next one. Why not host your own above?
            </Text>
          </View>
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
            const dateBits = splitDateForBadge(ev.starts_at, ev.timezone);
            const timeStr = formatFpTime(ev.starts_at, ev.timezone);
            const location = ev.is_online ? "Online" : (ev.venue_name || "Venue TBD");
            const hook = pickHook(ev);
            return (
              <Pressable
                key={ev.id}
                testID={`fp-event-${ev.slug}`}
                onPress={() => onOpen(ev.slug)}
                style={({ pressed }) => ({
                  width: 260,
                  borderRadius: 18,
                  backgroundColor: c.surface,
                  borderWidth: 1,
                  borderColor: c.border,
                  overflow: "hidden",
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                  // Slight lift so cards feel physical / tappable rather
                  // than flat catalog rows.
                  shadowColor: "#0A2540",
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                })}
              >
                {/* Cover with calendar-style date tile overlay + status pill.
                    Height trimmed to 100px so the whole card fits within
                    the top third of a phone screen — leaves room for the
                    community events to peek beneath. */}
                <View style={{ height: 100, backgroundColor: cover ? "#F1F5F9" : c.brand, position: "relative" }}>
                  {cover ? (
                    <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="calendar" size={32} color="rgba(255,255,255,0.85)" />
                    </View>
                  )}
                  {/* Subtle darker gradient at bottom so the venue chip
                      remains legible over bright covers. */}
                  <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 34, backgroundColor: "rgba(15,23,42,0.35)" }} />

                  {/* Compact date tile — high-contrast, calendar-style. */}
                  <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 44, alignItems: "center", shadowColor: "#0A2540", shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}>
                    <Text style={{ color: c.brand, fontSize: 8 * scale, fontWeight: "900", letterSpacing: 0.8 }}>{dateBits.month}</Text>
                    <Text style={{ color: c.onSurface, fontSize: 16 * scale, fontWeight: "900", lineHeight: 18 }}>{dateBits.day}</Text>
                  </View>

                  {/* "You're going" / "On waitlist" pill (only when
                      the current user has RSVP'd). */}
                  {myStatus && (
                    <View style={{ position: "absolute", top: 8, right: 8, backgroundColor: myStatus === "going" ? "#DCFCE7" : "#FEF3C7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: myStatus === "going" ? "#166534" : "#92400E", fontSize: 9 * scale, fontWeight: "900", textTransform: "uppercase" }}>
                        {myStatus === "going" ? "✓ Going" : "Waitlist"}
                      </Text>
                    </View>
                  )}

                  {/* Venue chip pinned to bottom-left of cover */}
                  <View style={{ position: "absolute", left: 8, bottom: 6, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Ionicons name={ev.is_online ? "videocam" : "location"} size={11} color="#FFF" />
                    <Text numberOfLines={1} style={{ color: "#FFF", fontSize: 10 * scale, fontWeight: "700", maxWidth: 160 }}>{location}</Text>
                  </View>
                </View>

                {/* Body — compact. Title + optional single-line hook +
                    one meta row. Everything else lives in the modal. */}
                <View style={{ padding: 12, gap: 4 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15 * scale, fontWeight: "900", color: c.onSurface, lineHeight: 19 }}>
                    {ev.title}
                  </Text>
                  {hook ? (
                    <Text numberOfLines={1} style={{ fontSize: 12 * scale, color: c.muted, lineHeight: 16 }}>
                      {hook}
                    </Text>
                  ) : null}

                  {/* Meta row: time + social proof + capacity chip.
                      Single-line so the card stays short. */}
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2, gap: 6 }}>
                    <Ionicons name="time-outline" size={12} color={c.muted} />
                    <Text style={{ fontSize: 11 * scale, color: c.muted, fontWeight: "700" }}>{timeStr}</Text>
                    <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: c.muted, opacity: 0.4 }} />
                    <Text style={{ fontSize: 11 * scale, color: c.muted, fontWeight: "700" }}>
                      {going === 0 ? "Be the first" : `${going} going`}
                    </Text>
                    {ev.capacity != null && (
                      <View style={{ marginLeft: "auto", paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: isFull ? "#FEF3C7" : "#DCFCE7" }}>
                        <Text style={{ fontSize: 9 * scale, fontWeight: "900", color: isFull ? "#92400E" : "#166534" }}>
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

      {/* Community-events section divider — makes it obvious where
          FriendPlace-hosted ends and member-hosted begins. This
          separation will matter more as local orgs (RSL, Rotary,
          libraries, etc.) start posting alongside members. */}
      <View style={{ marginTop: 18, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: "#94A3B8" }} />
          <Text style={{ fontSize: 10 * scale, fontWeight: "900", letterSpacing: 1.5, color: "#64748B", textTransform: "uppercase" }}>
            From your community
          </Text>
        </View>
        <Text style={{ fontSize: 16 * scale, fontWeight: "900", color: c.onSurface, letterSpacing: -0.2 }}>
          What&rsquo;s on locally
        </Text>
      </View>
    </View>
  );
}

/** Pull a warm one-line hook from the event's own description. Falls
 *  back to null if there's nothing useful to show. */
function pickHook(ev: any): string | null {
  const src = (ev.description || "").toString().trim();
  if (!src) return null;
  // Only surface the first sentence so the card stays scannable.
  const firstSentence = src.split(/(?<=[.!?])\s+/)[0] || src;
  return firstSentence.length > 120 ? firstSentence.slice(0, 117) + "…" : firstSentence;
}

/** Break a start-time into calendar-badge parts (month / day / weekday). */
function splitDateForBadge(iso?: string, tz: string = "Australia/Sydney") {
  if (!iso) return { month: "TBD", day: "•", weekday: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { month: "TBD", day: "•", weekday: "" };
  try {
    const month = d.toLocaleDateString("en-AU", { month: "short", timeZone: tz }).toUpperCase();
    const day = d.toLocaleDateString("en-AU", { day: "numeric", timeZone: tz });
    const weekday = d.toLocaleDateString("en-AU", { weekday: "short", timeZone: tz }).toUpperCase();
    return { month, day, weekday };
  } catch { return { month: "", day: "•", weekday: "" }; }
}

/** Compact "10:00 am" style time (Australian). */
function formatFpTime(iso?: string, tz: string = "Australia/Sydney"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: tz }).toLowerCase();
  } catch { return ""; }
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

  const openIcs = async () => {
    if (!event) return;
    // Batch B iter157 P0 #6: prefer native calendar sheet on
    // iOS/Android; fall back to the backend .ics URL on web (or if
    // native fails). FP events store `starts_at` as an ISO datetime.
    try {
      const starts = event?.starts_at ? new Date(event.starts_at) : null;
      if (starts && !Number.isNaN(starts.getTime()) && Platform.OS !== "web") {
        const y = starts.getFullYear();
        const mo = String(starts.getMonth() + 1).padStart(2, "0");
        const d = String(starts.getDate()).padStart(2, "0");
        const hh = String(starts.getHours()).padStart(2, "0");
        const mm = String(starts.getMinutes()).padStart(2, "0");
        const durationMs = event?.ends_at
          ? new Date(event.ends_at).getTime() - starts.getTime()
          : 90 * 60_000;
        const durationMinutes = durationMs > 0 ? Math.round(durationMs / 60_000) : 90;
        const nativeRes = await addToNativeCalendar({
          title: event.title || "FriendPlace event",
          description: event.description || "",
          location: event.is_online
            ? (event.meeting_url || "Online")
            : [event.venue_name, event.venue_address].filter(Boolean).join(" · "),
          date: `${y}-${mo}-${d}`,
          time: `${hh}:${mm}`,
          durationMinutes,
        });
        if (nativeRes === "created") { show("Added to your calendar 📅"); return; }
        if (nativeRes === "cancelled") return;
      }
    } catch { /* fall through to .ics */ }
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

/* ------------------------------------------------------------------
   Discovery-filter matcher — evaluates whether a community event
   passes the current chip selection. Kept as a pure function so the
   `visibleEvents` memo stays simple and unit-testable.
   ------------------------------------------------------------------ */

function matchesEventFilter(e: any, key: string, user: any): boolean {
  // Community events store the date as a `YYYY-MM-DD` string.
  const raw = (e?.date || "").toString();
  if (!raw) return key === "all";
  const eventDate = new Date(raw + "T00:00:00");
  if (Number.isNaN(eventDate.getTime())) return key === "all";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (key) {
    case "today": {
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
      return eventDate >= startOfToday && eventDate < startOfTomorrow;
    }
    case "this_week": {
      // Australia treats Monday as the start of the week — bring
      // Sunday (0) back to 7 so we always land on Monday-of-this-week.
      const dow = now.getDay() === 0 ? 7 : now.getDay();
      const monday = new Date(startOfToday);
      monday.setDate(monday.getDate() - (dow - 1));
      const nextMonday = new Date(monday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      return eventDate >= monday && eventDate < nextMonday;
    }
    case "this_weekend": {
      // Saturday 00:00 → Monday 00:00 (whichever weekend is upcoming
      // from *today*: if today is Mon-Fri, use this coming Sat/Sun;
      // if today is Sat/Sun, use today+tomorrow as the "weekend").
      const dow = now.getDay(); // 0=Sun … 6=Sat
      const saturday = new Date(startOfToday);
      if (dow === 0) {
        // Sunday — the "weekend" already began yesterday; treat
        // today as the tail end.
        saturday.setDate(saturday.getDate() - 1);
      } else if (dow === 6) {
        // Saturday — that's today.
      } else {
        saturday.setDate(saturday.getDate() + (6 - dow));
      }
      const monday = new Date(saturday);
      monday.setDate(monday.getDate() + 2);
      return eventDate >= saturday && eventDate < monday;
    }
    case "this_month": {
      return (
        eventDate.getFullYear() === now.getFullYear() &&
        eventDate.getMonth() === now.getMonth()
      );
    }
    case "near_me": {
      const suburb = (user?.suburb || "").toString().trim().toLowerCase();
      if (!suburb) return false; // Empty state handles this case gracefully.
      const hay = ((e?.location || "") + " " + (e?.venue_name || "") + " " + (e?.venue_address || "")).toLowerCase();
      return hay.includes(suburb);
    }
    case "all":
    default:
      return true;
  }
}

/* ------------------------------------------------------------------
   Empty-state shown inside the community events FlatList when the
   current filter yields zero events. Copy is tailored per filter so
   it never feels dead-endy — always suggests a next step.
   ------------------------------------------------------------------ */

function EventsEmptyState({
  filter, user, onClearFilter, c, scale,
}: {
  filter: string;
  user: any;
  onClearFilter: () => void;
  c: any;
  scale: number;
}) {
  const router = useRouter();
  const suburb = (user?.suburb || "").toString().trim();
  const needsSuburb = filter === "near_me" && !suburb;

  const copy: { emoji: string; title: string; body: string; cta?: { label: string; onPress: () => void } } =
    needsSuburb ? {
      emoji: "📍",
      title: "Add your suburb to see nearby events",
      body: "We use your suburb to match events happening in your local area. Just a suburb — no need for exact location.",
      cta: { label: "Update my profile", onPress: () => router.push("/edit-profile" as any) },
    } : filter === "near_me" ? {
      emoji: "🌏",
      title: `Nothing near ${suburb} just yet`,
      body: "Try widening your search — or host an event and be the one who kicks it off.",
      cta: { label: "See all upcoming", onPress: onClearFilter },
    } : filter === "today" ? {
      emoji: "☕",
      title: "Nothing on today",
      body: "Check what's on this week — or start something spontaneous by hosting your own.",
      cta: { label: "See this week", onPress: onClearFilter },
    } : filter === "this_weekend" ? {
      emoji: "🌤️",
      title: "No weekend plans yet",
      body: "The weekend's still open — how about hosting a walk, coffee, or catch-up?",
      cta: { label: "See all upcoming", onPress: onClearFilter },
    } : filter === "this_week" ? {
      emoji: "🗓️",
      title: "Nothing on this week",
      body: "Have a look further ahead or plant the seed by posting your own event.",
      cta: { label: "See all upcoming", onPress: onClearFilter },
    } : filter === "this_month" ? {
      emoji: "📅",
      title: "Nothing on this month",
      body: "Have a look further ahead or plant the seed by posting your own event.",
      cta: { label: "See all upcoming", onPress: onClearFilter },
    } : {
      emoji: "🌱",
      title: "No community events yet",
      body: "Be the first — tap Host a new event above to get things started.",
    };

  return (
    <View style={{ marginTop: 12, padding: 22, borderRadius: 18, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, alignItems: "center" }}>
      <Text style={{ fontSize: 36, marginBottom: 10 }}>{copy.emoji}</Text>
      <Text style={{ fontSize: 15 * scale, fontWeight: "800", color: c.onSurface, textAlign: "center" }}>{copy.title}</Text>
      <Text style={{ fontSize: 13 * scale, color: c.muted, textAlign: "center", marginTop: 6, lineHeight: 18, maxWidth: 300 }}>{copy.body}</Text>
      {copy.cta && (
        <Pressable
          onPress={copy.cta.onPress}
          style={{ marginTop: 16, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: c.brand }}
        >
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 13 * scale }}>{copy.cta.label}</Text>
        </Pressable>
      )}
    </View>
  );
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
