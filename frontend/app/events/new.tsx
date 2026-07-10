import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Modal } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";
import { DateField, TimeField } from "@/src/components/DateTimePicker";

const EMOJIS = ["☕", "🍰", "🚌", "🏞️", "🎲", "🎵", "📚", "🌳", "🎨", "🍵", "🥖", "🦋", "🌷"];
const CAPACITY_PRESETS = [
  { label: "Coffee Morning · 10", value: 10 },
  { label: "Lunch Club · 20", value: 20 },
  { label: "Bus Trip · 40", value: 40 },
  { label: "No limit", value: null as number | null },
];

// Recurrence cadences offered to hosts. "none" is the default — most events
// are one-offs. We deliberately do NOT expose daily / yearly to keep the
// surface friendly for everyone running regular meetups.
type Recurrence = "none" | "weekly" | "fortnightly" | "monthly";
const RECURRENCE_OPTIONS: { key: Recurrence; label: string; emoji: string }[] = [
  { key: "none",         label: "Doesn't repeat", emoji: "—" },
  { key: "weekly",       label: "Weekly",         emoji: "📅" },
  { key: "fortnightly",  label: "Fortnightly",    emoji: "📆" },
  { key: "monthly",      label: "Monthly",        emoji: "🗓️" },
];
// "How many times?" — count of *additional* occurrences after the first one.
// Friendly labels phrased from the host's POV (e.g. "Repeat 4 times" creates
// the master + 3 children).
const REPEAT_COUNT_PRESETS = [
  { label: "4 times",   value: 3 },
  { label: "8 times",   value: 7 },
  { label: "12 times",  value: 11 },
];

export default function NewEvent() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, token } = useAuth();
  const { show } = useToast();
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("☕");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [time, setTime] = useState(""); // HH:MM (24h)
  const [capacity, setCapacity] = useState<number | null>(20);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [repeatCount, setRepeatCount] = useState<number>(3); // +3 extras = 4 total
  const [busy, setBusy] = useState(false);

  // ─── Business-event preflight state. When the user taps "Create event"
  // we call /events/preflight first. If the heuristic flags it AND the
  // host isn't already a business, we open a friendly modal explaining
  // what we noticed and offering the free 1-month trial path. The user
  // can confirm they're a business (start the trial) or insist it's a
  // community event (we proceed as normal but flag for moderation).
  const [businessModal, setBusinessModal] = useState<null | {
    trialOffer: string;
    nextPaidMsg: string;
  }>(null);
  const [businessName, setBusinessName] = useState("");
  const [claiming, setClaiming] = useState(false);
  // Hard-stop overlay when an existing business hits the period limit.
  // Distinct from the "claim a plan" modal — these users have already
  // started a plan and just need a friendly "you're out for this period".
  const [limitModal, setLimitModal] = useState<null | {
    message: string;
    used: number;
    limit: number;
  }>(null);

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="New event" /></View>;

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const canSubmit = title.trim().length >= 3 && validDate && validTime && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // ── Step 1 — preflight the heuristic. Only blocks if the host
    // hasn't already self-identified as a business; once flagged, future
    // events just attach the sponsor block silently in the backend.
    try {
      const hint: any = await api.eventPreflight({
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        host_id: user.id,
      });
      if (hint?.looks_business && !hint.already_business) {
        setBusy(false);
        setBusinessModal({
          trialOffer: hint?.messages?.trial_offer || "Start with a free 1-month trial — up to 5 event listings.",
          nextPaidMsg: hint?.messages?.next_paid || "",
        });
        return; // wait for the user's decision
      }
    } catch {
      // Preflight is best-effort — don't block legitimate event creation
      // if the endpoint hiccups. We just fall through to the create.
    }
    await actuallyCreate();
  };

  // Centralised so both the "post as community event anyway" CTA and the
  // post-business-claim flow share the same body builder + success path.
  const actuallyCreate = async () => {
    setBusy(true);
    try {
      const created: any = await api.createEvent({
        title: title.trim(),
        emoji,
        description: description.trim(),
        location: location.trim(),
        date,
        time,
        capacity: capacity ?? null,
        host_id: user.id,
        recurrence: recurrence === "none" ? null : recurrence,
        recurrence_count: recurrence === "none" ? null : repeatCount,
      });
      const totalCount = (created?.series_event_ids?.length as number | undefined) ?? 1;
      if (totalCount > 1) {
        show(`Series created — ${totalCount} events 🎉`);
      } else {
        show("Event created 🎉");
      }
      router.replace("/events");
      return created;
    } catch (e: any) {
      // 402 Payment Required → business has used its monthly allowance.
      // Show the friendly limit modal instead of a generic error toast.
      const msg = e?.message || "";
      const m = msg.match(/used\s+(\d+)\s+of\s+(\d+)/i);
      if (msg.toLowerCase().includes("listings") || msg.toLowerCase().includes("business_limit")) {
        setLimitModal({
          message: msg,
          used: m ? parseInt(m[1], 10) : 0,
          limit: m ? parseInt(m[2], 10) : 5,
        });
      } else {
        show(msg || "Could not create event");
      }
    } finally { setBusy(false); }
  };

  const claimAndPost = async () => {
    if (businessName.trim().length < 2) {
      show("Please enter your business or venue name");
      return;
    }
    if (!token) {
      show("Please sign in again — your session has expired");
      return;
    }
    setClaiming(true);
    try {
      await api.claimBusiness(token, businessName.trim());
      setBusinessModal(null);
      await actuallyCreate();
    } catch (e: any) {
      show(e?.message || "Could not save business name");
    } finally { setClaiming(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Create event" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Title <Text style={{ color: c.error }}>*</Text></Text>
          <TextInput testID="event-title" value={title} onChangeText={setTitle} maxLength={80} placeholder="e.g. Friday Coffee Morning" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Pick an emoji</Text>
          <View style={styles.row}>
            {EMOJIS.map((e) => (
              <Pressable key={e} testID={`emoji-${e}`} onPress={() => setEmoji(e)} style={[styles.emojiBtn, { backgroundColor: emoji === e ? c.brandTertiary : c.surfaceSecondary, borderColor: emoji === e ? c.brand : c.border }]}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Description</Text>
          <TextInput testID="event-description" value={description} onChangeText={setDescription} multiline maxLength={400} placeholder="What to expect, any costs, what to bring…" placeholderTextColor={c.muted} style={[styles.input, inputStyle, { minHeight: 90, textAlignVertical: "top" }]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Location</Text>
          <TextInput testID="event-location" value={location} onChangeText={setLocation} maxLength={120} placeholder="e.g. Cafe Belong, Manly" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Date <Text style={{ color: c.error }}>*</Text></Text>
              <DateField value={date} onChange={setDate} testID="event-date" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Time <Text style={{ color: c.error }}>*</Text></Text>
              <TimeField value={time} onChange={setTime} testID="event-time" />
            </View>
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Capacity</Text>
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginBottom: 6 }}>When full, new RSVPs automatically join the waitlist.</Text>
          <View style={styles.row}>
            {CAPACITY_PRESETS.map((p) => {
              const on = capacity === p.value;
              return (
                <Pressable key={p.label} testID={`cap-${p.value ?? "none"}`} onPress={() => setCapacity(p.value)} style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}>
                  <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            testID="event-custom-capacity"
            value={capacity != null ? String(capacity) : ""}
            onChangeText={(t) => {
              const n = parseInt(t.replace(/[^0-9]/g, "").slice(0, 4) || "0", 10);
              setCapacity(n > 0 ? n : null);
            }}
            keyboardType="number-pad"
            placeholder="Or enter a custom number"
            placeholderTextColor={c.muted}
            style={[styles.input, inputStyle, { marginTop: 8 }]}
          />

          {/* Repeats — for regular meetups (weekly coffee, monthly book
              club, etc.). The picker stays compact and only reveals the
              "How many times?" row once a cadence is selected so one-off
              hosts aren't distracted by options they don't need. */}
          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Repeats</Text>
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginBottom: 6 }}>
            For regular meetups — we&apos;ll create one event for each date so people can RSVP per session.
          </Text>
          <View style={styles.row}>
            {RECURRENCE_OPTIONS.map((r) => {
              const on = recurrence === r.key;
              return (
                <Pressable
                  key={r.key}
                  testID={`recur-${r.key}`}
                  onPress={() => setRecurrence(r.key)}
                  style={[styles.chip, { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}
                >
                  {r.emoji !== "—" ? <Text style={{ fontSize: 16 }}>{r.emoji}</Text> : null}
                  <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {recurrence !== "none" && (
            <>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>How many times?</Text>
              <View style={styles.row}>
                {REPEAT_COUNT_PRESETS.map((p) => {
                  const on = repeatCount === p.value;
                  return (
                    <Pressable
                      key={p.label}
                      testID={`recur-count-${p.value}`}
                      onPress={() => setRepeatCount(p.value)}
                      style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}
                    >
                      <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4 }}>
                {(() => {
                  const totalEvents = repeatCount + 1;
                  if (recurrence === "weekly") return `📅 ${totalEvents} weekly events — last one ${totalEvents} week${totalEvents === 1 ? "" : "s"} after the first.`;
                  if (recurrence === "fortnightly") return `📆 ${totalEvents} fortnightly events — last one ${(totalEvents - 1) * 2} weeks after the first.`;
                  return `🗓️ ${totalEvents} monthly events — last one ${totalEvents - 1} months after the first.`;
                })()}
              </Text>
            </>
          )}

          <View style={{ height: 16 }} />
          <Pressable
            testID="event-submit"
            disabled={!canSubmit}
            onPress={submit}
            style={{ backgroundColor: canSubmit ? c.brand : c.surfaceTertiary, paddingVertical: 14, borderRadius: 14, alignItems: "center" }}
          >
            {busy ? <ActivityIndicator color="#FFF" /> : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="calendar" size={18} color={canSubmit ? "#FFF" : c.muted} />
                <Text style={{ color: canSubmit ? "#FFF" : c.muted, fontWeight: "900", fontSize: 16 * scale }}>Create event</Text>
              </View>
            )}
          </Pressable>
          <View style={{ height: 8 }} />
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── "This looks like a business event" friendly gate ──────────────
          Shown only when the preflight heuristic trips AND the host
          isn't already a flagged business. Two paths:
            • Yes, I'm a business → enter venue name → claim free listing
              and post with "Sponsored by …" footer
            • No, it's a community event → post as normal (flag logged
              server-side via the heuristic score for future moderation)
       */}
      <Modal
        visible={!!businessModal}
        animationType="fade"
        transparent
        onRequestClose={() => !claiming && setBusinessModal(null)}
      >
        <Pressable style={modalStyles.backdrop} onPress={() => !claiming && setBusinessModal(null)}>
          <Pressable
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[modalStyles.sheet, { backgroundColor: c.surface }]}
          >
            <Text style={{ fontSize: 44 }}>🏪</Text>
            <Text style={[modalStyles.title, { color: c.onSurface, fontSize: 22 * scale }]}>
              This looks like a business event
            </Text>
            <Text style={[modalStyles.body, { color: c.onSurface, fontSize: 15 * scale }]}>
              FriendPlace is built for our community — so when we spot business listings, we gently let you know.
              {"\n\n"}
              <Text style={{ fontWeight: "800" }}>🎁 {businessModal?.trialOffer}</Text>
              {"\n\n"}
              {businessModal?.nextPaidMsg}
            </Text>
            <Text style={[modalStyles.label, { color: c.onSurface, fontSize: 14 * scale }]}>
              Business or venue name
            </Text>
            <TextInput
              testID="business-name-input"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Bondi RSL Club"
              placeholderTextColor={c.muted}
              editable={!claiming}
              maxLength={80}
              style={[
                modalStyles.input,
                {
                  color: c.onSurface,
                  borderColor: c.border,
                  backgroundColor: c.surfaceSecondary,
                  fontSize: 16 * scale,
                },
              ]}
            />
            <Pressable
              testID="business-confirm-btn"
              disabled={claiming || businessName.trim().length < 2}
              onPress={claimAndPost}
              style={[
                modalStyles.primaryBtn,
                {
                  backgroundColor: businessName.trim().length >= 2 && !claiming ? c.brand : c.surfaceTertiary,
                },
              ]}
            >
              <Text style={{ color: businessName.trim().length >= 2 && !claiming ? c.onBrandPrimary : c.muted, fontWeight: "900", fontSize: 16 * scale }}>
                {claiming ? "Starting your trial…" : "Start free trial & post event 🎁"}
              </Text>
            </Pressable>
            <Pressable
              testID="business-not-business-btn"
              disabled={claiming}
              onPress={async () => { setBusinessModal(null); await actuallyCreate(); }}
              style={[modalStyles.secondaryBtn, { backgroundColor: c.surfaceSecondary }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>
                No, it&apos;s a community event
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Limit-reached modal — shown when an existing business user tries
          to post beyond their period allowance (server returns 402).
          Friendly, not punitive — explains the reset window and signals
          that paid plans are coming. */}
      <Modal visible={!!limitModal} animationType="fade" transparent onRequestClose={() => setLimitModal(null)}>
        <Pressable style={modalStyles.backdrop} onPress={() => setLimitModal(null)}>
          <Pressable
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[modalStyles.sheet, { backgroundColor: c.surface, alignItems: "center" }]}
          >
            <Text style={{ fontSize: 44 }}>🦋</Text>
            <Text style={[modalStyles.title, { color: c.onSurface, fontSize: 22 * scale }]}>
              You&apos;ve used your listings for this period
            </Text>
            <Text style={[modalStyles.body, { color: c.onSurface, fontSize: 15 * scale, textAlign: "center" }]}>
              <Text style={{ fontWeight: "800" }}>{limitModal?.used ?? 0} of {limitModal?.limit ?? 5}</Text> listings used.
              {"\n\n"}
              Your allowance resets at the end of the period.
              {"\n\n"}
              Weekly and monthly plans are coming soon — we&apos;ll be in touch about pricing.
            </Text>
            <Pressable
              testID="limit-modal-close"
              onPress={() => setLimitModal(null)}
              style={[modalStyles.primaryBtn, { backgroundColor: c.brand }]}
            >
              <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 16 * scale }}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 500, borderRadius: 24, padding: 24, gap: 10, alignItems: "stretch" },
  title: { fontWeight: "900", textAlign: "center", marginTop: 4 },
  body: { lineHeight: 22, textAlign: "left" },
  reasons: { padding: 10, borderRadius: 12, borderWidth: 1, marginTop: 6 },
  label: { fontWeight: "800", marginTop: 6 },
  input: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "700" },
  primaryBtn: { alignItems: "center", paddingVertical: 14, borderRadius: 999, minHeight: 50, marginTop: 6 },
  secondaryBtn: { alignItems: "center", paddingVertical: 12, borderRadius: 999, minHeight: 44, marginTop: 4 },
});

const styles = StyleSheet.create({
  content: { padding: 16, gap: 6, paddingBottom: 60 },
  label: { fontWeight: "800", marginTop: 12 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600", marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
  emojiBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
});
