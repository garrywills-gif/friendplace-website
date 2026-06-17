/**
 * /waitlist — pre-launch friends-and-family signup.
 *
 * Why this exists:
 *   YouBelong rolls out invite-only at first so we can stabilise the
 *   community before opening the gates. This screen lets people who heard
 *   about the app (flyer, word of mouth, social) leave their email so we
 *   can drip-feed invites as the Founding Member slots fill.
 *
 * What it does:
 *   • Captures email + (optional) name, suburb, "how did you hear about us?"
 *     and a free-form note.
 *   • Calls POST /api/waitlist which is idempotent on email — re-submitting
 *     just refreshes the queue position rather than duplicating.
 *   • Surfaces a friendly "You're #42 in line" confirmation + a CTA to
 *     keep them engaged (share with a friend, follow socials).
 *
 * Accessibility:
 *   Inputs are large with 44pt+ touch targets and visible labels (vs.
 *   placeholder-only). The primary CTA is a solid block on white for
 *   maximum legibility in bright daylight on a flyer-redirected device.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

const SOURCES: { key: string; label: string }[] = [
  { key: "word_of_mouth", label: "A friend told me" },
  { key: "facebook",      label: "Facebook" },
  { key: "flyer",         label: "Saw a flyer" },
  { key: "library",       label: "At my library" },
  { key: "cafe",          label: "At a café / club" },
  { key: "other",         label: "Somewhere else" },
];

export default function WaitlistScreen() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [suburb, setSuburb] = useState("");
  const [source, setSource] = useState<string>("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ position: number; alreadyOnList: boolean } | null>(null);
  // Live counter — small but persuasive social proof on the page.
  const [stats, setStats] = useState<{ total: number; waiting: number } | null>(null);
  // Founder counter — also surfaced here so people see the "real spots are
  // filling" signal even from the soft waitlist path.
  const [founder, setFounder] = useState<{ taken: number; cap: number; remaining: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, f] = await Promise.all([api.waitlistStats(), api.founderStatus()]);
        if (cancelled) return;
        setStats(s as any);
        setFounder(f as any);
      } catch { /* show without stats — page still works */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      show("Please enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      // Carry the ?ref=<id> attribution from the welcome screen — so the
      // inviter still gets credit even when someone takes the waitlist
      // detour rather than signing up straight away.
      let referrer: string | null = null;
      try {
        referrer = await AsyncStorage.getItem("youbelong.invite.ref");
      } catch { /* no-op */ }
      const r: any = await api.joinWaitlist({
        email: trimmedEmail,
        name: name.trim(),
        suburb: suburb.trim(),
        source: source || "",
        note: note.trim(),
        referrer_id: referrer || null,
      });
      setResult({ position: r.position, alreadyOnList: !!r.already_on_list });
      // Refresh the live counter so people see their +1 reflected.
      try {
        const s = await api.waitlistStats();
        setStats(s as any);
      } catch { /* keep old stats */ }
    } catch (e: any) {
      show(e?.message || "Couldn't join the waitlist — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const cardStyle = {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
  };

  const inputStyle = {
    backgroundColor: c.surfaceSecondary,
    borderColor: c.border,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 12,
    color: c.onSurface,
    fontSize: 17 * scale,
    minHeight: 50,
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surfaceBase }}>
      <Header title="Friends & Family Waitlist" />
      <ScrollView
        contentContainerStyle={{
          padding: 18,
          paddingTop: 14,
          paddingBottom: insets.bottom + 32,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="waitlist-screen"
      >
        {result ? (
          <View style={cardStyle}>
            <Text style={{ fontSize: 22 * scale, fontWeight: "900", color: c.onSurface, textAlign: "center" }}>
              🦋 You&apos;re on the list!
            </Text>
            <Text style={{ fontSize: 16 * scale, color: c.onSurface, marginTop: 12, textAlign: "center" }}>
              {result.alreadyOnList ? "You're already #" : "You're #"}
              <Text style={{ fontWeight: "900", color: c.brand }}>{result.position}</Text>
              {" "}in line.
            </Text>
            <Text style={{ fontSize: 14 * scale, color: c.muted, marginTop: 10, textAlign: "center" }}>
              We&apos;ll email you the moment your spot opens — usually within a few days. In the meantime, telling one friend really does help.
            </Text>
            <View style={{ height: 16 }} />
            <Pressable
              testID="waitlist-back-home"
              onPress={() => router.replace("/")}
              style={({ pressed }) => [styles.primary, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.primaryText, { fontSize: 18 * scale }]}>Back to Welcome</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Recruiting blurb + live counters */}
            <View style={cardStyle}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 28 }}>🦋</Text>
                <Text style={{ fontSize: 20 * scale, fontWeight: "900", color: c.onSurface, flex: 1 }}>
                  Reserve your spot
                </Text>
              </View>
              <Text style={{ fontSize: 15 * scale, color: c.onSurface, marginTop: 10, lineHeight: 22 * scale }}>
                YouBelong is rolling out invite-only at first so we can keep the community warm and welcoming. Leave your email and we&apos;ll let you in soon — no app store, no payment, no pressure.
              </Text>
              {(stats || founder) ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {stats ? (
                    <View style={[styles.statChip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                      <Text style={{ color: c.brand, fontWeight: "900", fontSize: 13 * scale }}>
                        {stats.waiting.toLocaleString()} waiting
                      </Text>
                    </View>
                  ) : null}
                  {founder && founder.cap > 0 ? (
                    <View style={[styles.statChip, { backgroundColor: c.brandTertiary, borderColor: "#D4A017" }]}>
                      <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 13 * scale }}>
                        {founder.remaining.toLocaleString()} of {founder.cap.toLocaleString()} Founder spots left
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Form */}
            <View style={cardStyle}>
              <Label scale={scale} color={c.onSurface}>Email <Text style={{ color: "#DC2626" }}>*</Text></Label>
              <TextInput
                testID="waitlist-email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={inputStyle as any}
              />

              <Label scale={scale} color={c.onSurface}>First name</Label>
              <TextInput
                testID="waitlist-name"
                value={name}
                onChangeText={setName}
                placeholder="Optional"
                placeholderTextColor={c.muted}
                style={inputStyle as any}
              />

              <Label scale={scale} color={c.onSurface}>Suburb / town</Label>
              <TextInput
                testID="waitlist-suburb"
                value={suburb}
                onChangeText={setSuburb}
                placeholder="So we can match you with local groups"
                placeholderTextColor={c.muted}
                style={inputStyle as any}
              />

              <Label scale={scale} color={c.onSurface}>How did you hear about YouBelong?</Label>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {SOURCES.map((s) => {
                  const on = source === s.key;
                  return (
                    <Pressable
                      key={s.key}
                      testID={`waitlist-source-${s.key}`}
                      onPress={() => setSource(on ? "" : s.key)}
                      style={[
                        styles.sourceChip,
                        {
                          backgroundColor: on ? c.brand : c.surfaceSecondary,
                          borderColor: on ? c.brand : c.border,
                        },
                      ]}
                    >
                      <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Label scale={scale} color={c.onSurface}>Anything else? (optional)</Label>
              <TextInput
                testID="waitlist-note"
                value={note}
                onChangeText={setNote}
                placeholder='e.g. "I heard about you from Maggie at the library"'
                placeholderTextColor={c.muted}
                multiline
                style={[inputStyle as any, { minHeight: 90, paddingTop: 12, textAlignVertical: "top" }]}
              />

              <View style={{ height: 16 }} />
              <Pressable
                testID="waitlist-submit"
                disabled={busy}
                onPress={submit}
                style={({ pressed }) => [styles.primary, { backgroundColor: c.brand, opacity: busy ? 0.6 : (pressed ? 0.85 : 1) }]}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle" color="#FFFFFF" size={22} />
                    <Text style={[styles.primaryText, { fontSize: 18 * scale }]}>Join the waitlist</Text>
                  </View>
                )}
              </Pressable>
              <Text style={{ color: c.muted, fontSize: 12 * scale, textAlign: "center", marginTop: 10 }}>
                We only use your email to send your invite. No spam, no sharing.
              </Text>
            </View>

            <Pressable
              testID="waitlist-back"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.secondary, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Label({ children, scale, color }: { children: React.ReactNode; scale: number; color: string }) {
  return (
    <Text style={{ color, fontWeight: "800", fontSize: 14 * scale, marginTop: 14, marginBottom: 4 }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.3 },
  secondary: {
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    paddingHorizontal: 28,
  },
  sourceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    minHeight: 36,
  },
  statChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
