import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Platform, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { INTERESTS } from "@/src/lib/interests";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import SuburbField from "@/src/components/SuburbField";
import PeopleAvatarPicker from "@/src/components/PeopleAvatarPicker";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * /auth/complete-profile — the SINGLE shared "Set up your profile" screen
 * for EVERY signup method (email, Google, Apple).
 *
 * Account creation only captures credentials; every new/incomplete member
 * lands here to set their display name, avatar, suburb (required) and
 * interests BEFORE George/Georgia induction. Google/Apple may prefill a
 * suggested display name, but it stays editable.
 *
 * Rule: authentication → complete profile → induction. The gate lives in
 * src/lib/profile.ts (needsProfileSetup); once a suburb is saved the member
 * proceeds to /onboarding. A suburb is ALWAYS required — "Hide my suburb"
 * only controls public visibility, it never replaces entering one.
 */
export default function CompleteProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();

  const [displayName, setDisplayName] = useState<string>(
    (user as any)?.first_name || "",
  );
  const [avatar, setAvatar] = useState<string>((user as any)?.avatar || "🌸");
  const [interests, setInterests] = useState<string[]>((user as any)?.interests || []);
  const [bdayMonth, setBdayMonth] = useState<number | null>(null);
  const [bdayDay, setBdayDay] = useState("");
  const [bdayYear, setBdayYear] = useState("");
  // The chosen suburb (from the recognised list). Required. "Hide my suburb"
  // is a SEPARATE visibility toggle and never a substitute for this.
  const [suburb, setSuburb] = useState<{ name: string; postcode?: string; state?: string; lat?: number; lng?: number } | null>(
    (user as any)?.suburb ? { name: (user as any).suburb, postcode: (user as any).suburb_postcode, state: (user as any).suburb_state } : null,
  );
  const [hideSuburb, setHideSuburb] = useState<boolean>(!!(user as any)?.suburb_hidden);
  const [busy, setBusy] = useState(false);

  const toggleInterest = (i: string) =>
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  const birthdayString = () => {
    if (!bdayMonth || !bdayDay) return "";
    const mm = String(bdayMonth).padStart(2, "0");
    const dd = String(parseInt(bdayDay, 10) || 0).padStart(2, "0");
    if (dd === "00") return "";
    return bdayYear && /^\d{4}$/.test(bdayYear) ? `${bdayYear}-${mm}-${dd}` : `${mm}-${dd}`;
  };

  const onFinish = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      show("Please enter a display name.");
      return;
    }
    if (!suburb?.name) {
      show("Please select your suburb.");
      return;
    }
    setBusy(true);
    try {
      // Suburb is required and always stored/used for local features; the
      // hide toggle only suppresses public display.
      try {
        await api.setLocation(user.id, {
          suburb: suburb.name,
          postcode: suburb.postcode,
          state: suburb.state,
          lat: suburb.lat,
          lng: suburb.lng,
          hidden: hideSuburb,
        });
      } catch { /* best-effort — gate still satisfied once saved */ }
      const payload: any = { first_name: displayName.trim(), avatar, interests };
      const b = birthdayString();
      if (b) payload.birthday = b;
      try { await api.updateProfile(user.id, payload); } catch { /* best-effort */ }
      try { await refresh?.(); } catch { /* non-fatal */ }
      show("You're all set! 🦋");
      router.replace("/onboarding" as any);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Set up your profile" showGeorge />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.muted, fontSize: 14 * scale }]}>
            Just a few quick details so friends can find you &mdash; then you&rsquo;ll meet your companion.
          </Text>

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>
            Display name <Text style={{ color: c.error }}>*</Text>
          </Text>
          <TextInput
            testID="complete-display-name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="The name friends will see"
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 16 * scale }]}
          />

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your photo or avatar</Text>
          <PeopleAvatarPicker value={avatar} onChange={setAvatar} />

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>
            Your suburb <Text style={{ color: c.error }}>*</Text>
          </Text>
          <Text style={{ color: c.muted, fontSize: 13 * scale, marginBottom: 8 }}>
            Required — we use it to show local notices, events, groups and nearby members.
          </Text>
          <SuburbField
            testID="complete-suburb"
            hidePreferNotToSay
            initialValue={suburb?.name || ""}
            onChange={(m) => {
              if (m) setSuburb({ name: m.name, postcode: m.postcode, state: m.state, lat: m.lat, lng: m.lng });
              else setSuburb(null);
            }}
          />
          <Pressable
            testID="complete-hide-suburb"
            onPress={() => setHideSuburb((v) => !v)}
            style={styles.hideRow}
          >
            <Ionicons
              name={hideSuburb ? "checkbox" : "square-outline"}
              size={24}
              color={hideSuburb ? c.brand : c.muted}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>Hide my suburb from other members</Text>
              <Text style={{ color: c.muted, fontSize: 12.5 * scale, marginTop: 2 }}>
                Your suburb stays saved for local features — it just won&rsquo;t show on your public profile.
              </Text>
            </View>
          </Pressable>

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Birthday (optional)</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {MONTHS.map((mo, idx) => (
              <Pressable key={mo} onPress={() => setBdayMonth(idx + 1)} style={[styles.chip, { borderColor: bdayMonth === idx + 1 ? c.brand : c.border, backgroundColor: bdayMonth === idx + 1 ? c.brand : c.surfaceSecondary }]}>
                <Text style={{ color: bdayMonth === idx + 1 ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>{mo}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <TextInput value={bdayDay} onChangeText={(t) => setBdayDay(t.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="Day" keyboardType="number-pad" placeholderTextColor={c.muted} style={[styles.input, { flex: 1, color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 15 * scale }]} />
            <TextInput value={bdayYear} onChangeText={(t) => setBdayYear(t.replace(/[^0-9]/g, "").slice(0, 4))} placeholder="Year (optional)" keyboardType="number-pad" placeholderTextColor={c.muted} style={[styles.input, { flex: 1.4, color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 15 * scale }]} />
          </View>

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Interests</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {INTERESTS.map((i) => (
              <Pressable key={i} onPress={() => toggleInterest(i)} style={[styles.chip, { borderColor: interests.includes(i) ? c.brand : c.border, backgroundColor: interests.includes(i) ? c.brand : c.surfaceSecondary }]}>
                <Text style={{ color: interests.includes(i) ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>{i}</Text>
              </Pressable>
            ))}
          </View>

          <Button label={busy ? "Saving…" : "Continue"} testID="complete-profile-continue" onPress={onFinish} disabled={busy} style={{ marginTop: 22 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: 16, lineHeight: 20 },
  section: { fontWeight: "800", marginTop: 20, marginBottom: 10 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5 },
  hideRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12, paddingVertical: 4 },
});
