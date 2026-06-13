import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const EMOJIS = ["☕", "🍰", "🚌", "🏞️", "🎲", "🎵", "📚", "🌳", "🎨", "🍵", "🥖", "🦋", "🌷"];
const CAPACITY_PRESETS = [
  { label: "Coffee Morning · 10", value: 10 },
  { label: "Lunch Club · 20", value: 20 },
  { label: "Bus Trip · 40", value: 40 },
  { label: "No limit", value: null as number | null },
];

export default function NewEvent() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("☕");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(""); // YYYY-MM-DD
  const [time, setTime] = useState(""); // HH:MM (24h)
  const [capacity, setCapacity] = useState<number | null>(20);
  const [busy, setBusy] = useState(false);

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="New event" /></View>;

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const canSubmit = title.trim().length >= 3 && validDate && validTime && !busy;

  const submit = async () => {
    if (!canSubmit) return;
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
      });
      show("Event created 🎉");
      router.replace("/events");
      return created;
    } catch (e: any) {
      show(e?.message || "Could not create event");
    } finally { setBusy(false); }
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
              <TextInput testID="event-date" value={date} onChangeText={(t) => setDate(t.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="YYYY-MM-DD" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Time <Text style={{ color: c.error }}>*</Text></Text>
              <TextInput testID="event-time" value={time} onChangeText={(t) => setTime(t.replace(/[^0-9:]/g, "").slice(0, 5))} placeholder="HH:MM (24h)" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 6, paddingBottom: 60 },
  label: { fontWeight: "800", marginTop: 12 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600", marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
  emojiBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
});
