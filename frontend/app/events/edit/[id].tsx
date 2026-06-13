import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const EMOJIS = ["☕", "🍰", "🚌", "🏞️", "🎲", "🎵", "📚", "🌳", "🎨", "🍵", "🥖", "🦋", "🌷"];

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [ev, setEv] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("☕");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [capacity, setCapacity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list: any[] = await api.listEvents();
        const e = list.find((x) => x.id === id);
        if (!e) { show("Event not found"); router.back(); return; }
        setEv(e);
        setTitle(e.title || "");
        setEmoji(e.emoji || "☕");
        setDescription(e.description || "");
        setLocation(e.location || "");
        setDate(e.date || "");
        setTime(e.time || "");
        setCapacity(e.capacity ?? null);
      } catch { show("Could not load event"); }
      finally { setLoading(false); }
    })();
  }, [id, router, show]);

  if (!user || loading) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Edit event" /><ActivityIndicator style={{ marginTop: 40 }} color={c.brand} /></View>;
  if (!ev) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Edit event" /></View>;

  const isHost = ev.host_id === user.id;
  const isAdmin = (user as any).is_admin;
  if (!isHost && !isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Edit event" />
        <Text style={{ padding: 24, color: c.onSurface }}>Only the host or an admin can edit this event.</Text>
      </View>
    );
  }

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validTime = /^\d{2}:\d{2}$/.test(time);
  const canSave = title.trim().length >= 3 && validDate && validTime && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const res: any = await api.updateEvent(String(id), {
        actor_id: user.id,
        title: title.trim(),
        emoji,
        description: description.trim(),
        location: location.trim(),
        date,
        time,
        capacity: capacity ?? 0,  // 0 = unlimited per backend
        notify_changes: true,
      });
      if (res?.changed?.length) show(`Updated · RSVPs notified`);
      else show("No changes to save");
      router.replace("/events");
    } catch (e: any) { show(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };

  const confirmCancel = () => {
    const proceed = async (reason: string | undefined) => {
      setBusy(true);
      try {
        await api.cancelEvent(String(id), { actor_id: user.id, reason });
        show("Event cancelled — RSVPs notified");
        router.replace("/events");
      } catch (e: any) { show(e?.message || "Could not cancel"); }
      finally { setBusy(false); }
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const r = window.prompt("Add an optional reason for cancelling (leave blank to skip):");
      if (r !== null) proceed(r || undefined);
      return;
    }
    Alert.prompt?.("Cancel event", "Add a short reason (optional)", [
      { text: "Keep event", style: "cancel" },
      { text: "Cancel event", style: "destructive", onPress: (r) => proceed(r) },
    ]);
  };

  const confirmRestore = async () => {
    setBusy(true);
    try { await api.restoreEvent(String(id), { actor_id: user.id }); show("Event restored"); router.replace("/events"); }
    catch (e: any) { show(e?.message || "Could not restore"); }
    finally { setBusy(false); }
  };

  const confirmDelete = () => {
    if (!isAdmin) return;
    const reason = (Platform.OS === "web" && typeof window !== "undefined") ? window.prompt("Permanently delete this event? Optional reason:") : "Admin hard-delete";
    if (reason === null) return;
    (async () => {
      setBusy(true);
      try { await api.adminHardDeleteEvent(String(id), user.id, reason || undefined); show("Event permanently deleted"); router.replace("/events"); }
      catch (e: any) { show(e?.message || "Could not delete"); }
      finally { setBusy(false); }
    })();
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={ev.cancelled ? "Cancelled event" : "Edit event"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {ev.cancelled && (
            <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#FEE2E2", marginBottom: 8 }}>
              <Text style={{ color: "#7F1D1D", fontWeight: "900", fontSize: 14 * scale }}>This event is cancelled.</Text>
              {!!ev.cancelled_reason && <Text style={{ color: "#7F1D1D", fontSize: 12 * scale, marginTop: 4 }}>Reason: {ev.cancelled_reason}</Text>}
            </View>
          )}

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Title</Text>
          <TextInput testID="edit-title" value={title} onChangeText={setTitle} maxLength={80} style={[styles.input, inputStyle]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Emoji</Text>
          <View style={styles.row}>
            {EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiBtn, { backgroundColor: emoji === e ? c.brandTertiary : c.surfaceSecondary, borderColor: emoji === e ? c.brand : c.border }]}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Description</Text>
          <TextInput value={description} onChangeText={setDescription} multiline maxLength={400} style={[styles.input, inputStyle, { minHeight: 90, textAlignVertical: "top" }]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Location</Text>
          <TextInput value={location} onChangeText={setLocation} maxLength={120} style={[styles.input, inputStyle]} />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Date</Text>
              <TextInput value={date} onChangeText={(t) => setDate(t.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="YYYY-MM-DD" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Time</Text>
              <TextInput value={time} onChangeText={(t) => setTime(t.replace(/[^0-9:]/g, "").slice(0, 5))} placeholder="HH:MM" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
            </View>
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Capacity</Text>
          <TextInput value={capacity != null ? String(capacity) : ""} onChangeText={(t) => { const n = parseInt(t.replace(/[^0-9]/g, "") || "0", 10); setCapacity(n > 0 ? n : null); }} keyboardType="number-pad" placeholder="Leave blank for no limit" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

          <View style={{ height: 16 }} />
          {!ev.cancelled && (
            <Pressable testID="edit-save" disabled={!canSave} onPress={save} style={{ backgroundColor: canSave ? c.brand : c.surfaceTertiary, paddingVertical: 14, borderRadius: 14, alignItems: "center" }}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: canSave ? "#FFF" : c.muted, fontWeight: "900", fontSize: 16 * scale }}>Save changes</Text>}
            </Pressable>
          )}
          <View style={{ height: 10 }} />
          {ev.cancelled ? (
            <Pressable testID="edit-restore" onPress={confirmRestore} style={{ paddingVertical: 14, borderRadius: 14, alignItems: "center", borderWidth: 2, borderColor: c.brand }}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>Restore event</Text>
            </Pressable>
          ) : (
            <Pressable testID="edit-cancel" onPress={confirmCancel} style={{ paddingVertical: 14, borderRadius: 14, alignItems: "center", borderWidth: 2, borderColor: "#DC2626" }}>
              <Text style={{ color: "#DC2626", fontWeight: "900", fontSize: 15 * scale }}>Cancel event (notify RSVPs)</Text>
            </Pressable>
          )}
          {isAdmin && (
            <>
              <View style={{ height: 10 }} />
              <Pressable testID="admin-hard-delete" onPress={confirmDelete} style={{ paddingVertical: 14, borderRadius: 14, alignItems: "center", backgroundColor: "#7F1D1D" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="trash" size={16} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Admin: permanently delete</Text>
                </View>
              </Pressable>
            </>
          )}
          <View style={{ height: 6 }} />
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
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
  emojiBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
});
