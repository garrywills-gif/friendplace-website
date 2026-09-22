/**
 * /auth/signup — Account creation (credentials only).
 *
 * This screen now captures ONLY what an account needs to exist:
 *   • Email address
 *   • Password
 *   • Confirm password
 *
 * Username and First name have been removed — a username is generated
 * automatically from the email, and the member sets their Display name
 * (plus avatar, suburb, birthday, interests) on the SHARED "Set up your
 * profile" screen (/auth/complete-profile), which EVERY signup method
 * (email, Google, Apple) flows through before George/Georgia induction.
 *
 *   authentication → complete profile → induction
 */
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";

/** Build a valid backend username from an email local-part plus a short
 *  random suffix so two people with similar emails don't collide. */
function usernameFromEmail(email: string): string {
  const local = (email.split("@")[0] || "member").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const base = (local || "member").slice(0, 16);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const stem = base.length >= 3 ? base : `${base}mem`;
  return `${stem}${suffix}`;
}

export default function Signup() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { signup } = useAuth();
  const { show } = useToast();

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [referrerId, setReferrerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem("friendplace.invite.ref");
        if (stored) setReferrerId(stored);
      } catch { /* no-op */ }
    })();
  }, []);

  const submit = async () => {
    const em = email.trim().toLowerCase();
    if (!em) { show("Email address is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { show("Please enter a valid email address"); return; }
    if (!pw || pw.length < 6) { show("Password must be at least 6 characters"); return; }
    if (pw !== pw2) { show("Passwords do not match"); return; }

    setBusy(true);
    try {
      // Retry a couple of times in the unlikely event the generated
      // username collides with an existing one.
      let created = false;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          await signup({
            username: usernameFromEmail(em),
            password: pw,
            email: em,
            referrer_id: referrerId || undefined,
          });
          created = true;
        } catch (e: any) {
          lastErr = e;
          const raw = String(e?.message || "");
          if (!/Username already taken/i.test(raw)) throw e; // only retry on username collision
        }
      }
      if (!created) throw lastErr || new Error("Could not create account. Try again.");

      try { await AsyncStorage.removeItem("friendplace.invite.ref"); } catch { /* no-op */ }
      // Every new member now completes the shared profile setup next.
      router.replace("/auth/complete-profile");
    } catch (e: any) {
      const raw = String(e?.message || "");
      // eslint-disable-next-line no-console
      console.warn("[signup] failure raw:", raw);
      const m = raw.match(/^(\d{3})\s+(.*)$/s);
      const status = m ? parseInt(m[1], 10) : 0;
      let payload: any = null;
      try { payload = m ? JSON.parse(m[2]) : null; } catch { payload = null; }
      let detail = "";
      if (payload && typeof payload.detail === "string") detail = payload.detail;
      else if (payload && Array.isArray(payload.detail) && payload.detail[0]?.msg) {
        const first = payload.detail[0];
        const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
        const msg = String(first.msg || "");
        detail = field === "password" && /at least (\d+) characters/i.test(msg)
          ? "Password must be at least 6 characters"
          : field === "email" ? "Please enter a valid email address" : msg;
      }
      if (status === 429) show("Too many attempts from this network right now — please wait a few minutes and try again.");
      else if (detail.includes("Email already registered")) show("Email already registered");
      else if (detail) show(detail);
      else if (raw) show(raw);
      else show("Could not create account. Try again.");
    } finally { setBusy(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Create Account" showGeorge />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.muted, fontSize: 14 * scale, lineHeight: 20, marginBottom: 8 }}>
            First, your login details. Next you&rsquo;ll set up your profile.
          </Text>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Email address <Text style={{ color: c.error }}>*</Text></Text>
          <TextInput testID="signup-email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
          <Text style={[styles.helper, { color: c.muted, fontSize: 12 * scale }]}>
            Used for login, password recovery and important account updates.
          </Text>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Create password <Text style={{ color: c.error }}>*</Text></Text>
          <PasswordField testID="signup-pw" value={pw} onChangeText={setPw} placeholder="At least 6 characters" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Confirm password <Text style={{ color: c.error }}>*</Text></Text>
          <PasswordField testID="signup-pw2" value={pw2} onChangeText={setPw2} placeholder="Re-enter password" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <View style={{ height: 18 }} />
          <Button testID="signup-continue" label="Continue" onPress={submit} loading={busy} />

          <Text style={[styles.legal, { color: c.muted, fontSize: 12 * scale }]}>
            By creating an account you agree to our{" "}
            <Text testID="signup-link-terms" onPress={() => router.push("/legal/terms")} style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}>Terms of Use</Text>
            {" "}and{" "}
            <Text testID="signup-link-privacy" onPress={() => router.push("/legal/privacy")} style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}>Privacy Policy</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 6, paddingBottom: 40 },
  label: { fontWeight: "700", marginTop: 12 },
  helper: { marginTop: 4, lineHeight: 16 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },
  legal: { marginTop: 16, textAlign: "center", lineHeight: 18 },
});
