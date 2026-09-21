import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Platform, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
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
 * /auth/complete-profile — profile setup for social sign-in members.
 *
 * Google/Apple only replace the email/password step, so a brand-new social
 * member still lands here to choose avatar/photo, birthday, suburb and
 * interests — exactly like email signup Step 2 — BEFORE George/Georgia
 * induction. The gate lives in src/lib/profile.ts (needsProfileSetup); once
 * a suburb (or "hide my suburb") is saved the member proceeds to /onboarding.
 */
export default function CompleteProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();

  const [avatar, setAvatar] = useState<string>((user as any)?.avatar || "🌸");
  const [interests, setInterests] = useState<string[]>((user as any)?.interests || []);
  const [bdayMonth, setBdayMonth] = useState<number | null>(null);
  const [bdayDay, setBdayDay] = useState("");
  const [bdayYear, setBdayYear] = useState("");
  const [suburbDone, setSuburbDone] = useState<boolean>(!!((user as any)?.suburb || (user as any)?.suburb_hidden));
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
    if (!suburbDone) {
      show("Please pick your suburb, or tap \u201CHide my suburb\u201D.");
      return;
    }
    setBusy(true);
    try {
      // Suburb is already saved live via SuburbField.onChange, so the setup
      // gate is satisfied. Avatar/interests/birthday are best-effort — never
      // block the member from reaching induction if that call hiccups.
      const payload: any = { avatar, interests };
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

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your photo or avatar</Text>
          <PeopleAvatarPicker value={avatar} onChange={setAvatar} />

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Your suburb</Text>
          <SuburbField
            initialValue={(user as any)?.suburb || ""}
            preferNotToSay={!!(user as any)?.suburb_hidden}
            onChange={async (m, pns) => {
              if (!user) return;
              if (pns) {
                setSuburbDone(true);
                try { await api.setLocation(user.id, { prefer_not_to_say: true }); } catch {}
              } else if (m) {
                setSuburbDone(true);
                try { await api.setLocation(user.id, { suburb: m.name, postcode: m.postcode, state: m.state, lat: m.lat, lng: m.lng }); } catch {}
              } else {
                setSuburbDone(false);
              }
            }}
          />

          <Text style={[styles.section, { color: c.onSurface, fontSize: 16 * scale }]}>Birthday (optional)</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {MONTHS.map((mo, idx) => (
              <Pressable key={mo} onPress={() => setBdayMonth(idx + 1)} style={[styles.chip, { borderColor: bdayMonth === idx + 1 ? c.brand : c.border, backgroundColor: bdayMonth === idx + 1 ? c.brand : c.surfaceSecondary }]}>
                <Text style={{ color: bdayMonth === idx + 1 ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>{mo}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <TextInput value={bdayDay} onChangeText={setBdayDay} placeholder="Day" keyboardType="number-pad" placeholderTextColor={c.muted} style={[styles.input, { flex: 1, color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 15 * scale }]} />
            <TextInput value={bdayYear} onChangeText={setBdayYear} placeholder="Year (optional)" keyboardType="number-pad" placeholderTextColor={c.muted} style={[styles.input, { flex: 1.4, color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 15 * scale }]} />
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
});
