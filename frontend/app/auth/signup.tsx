/**
 * /auth/signup — two-step Create Account flow.
 *
 *   Step 1 of 2: Account essentials (username, first name, email, password)
 *   Step 2 of 2: Personalisation (avatar, interests, birthday, suburb)
 *
 * Why two steps?
 *   The original screen showed ~8 input groups stacked together — too
 *   intimidating for the older-adult audience FriendPlace targets. Splitting
 *   creates two short pages, each fits on one phone screen without
 *   scrolling, with a clear "Step X of 2" progress indicator at the top.
 *   Submission happens at the end of Step 2 (single POST /api/auth/signup
 *   with the full payload — backend contract unchanged).
 *
 * Behaviour notes:
 *   - Step 1 fields are validated locally before "Continue" — clear inline
 *     errors so the user never advances to Step 2 with bad credentials.
 *   - Step 2 fields are all optional; users can submit with just the
 *     defaults and refine later from Profile.
 *   - "Back" on Step 2 returns to Step 1 without losing what they typed.
 *   - The pickup of any pending `friendplace.invite.ref` (set by the
 *     /invite/[id] landing) is preserved so attribution still flows through.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";
import SuburbField from "@/src/components/SuburbField";
import { INTERESTS } from "@/src/lib/interests";
import PeopleAvatarPicker from "@/src/components/PeopleAvatarPicker";

const AVATARS = ["🌸", "🔨", "📚", "🧓", "🧶", "🌳", "🎨", "🏏", "🌷", "🐾", "👋", "☕"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Signup() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { signup } = useAuth();
  const { show } = useToast();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — account essentials
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  // Step 2 — personalisation
  const [avatar, setAvatar] = useState("🌸");
  const [interests, setInterests] = useState<string[]>([]);
  const [bdayMonth, setBdayMonth] = useState<number | null>(null);
  const [bdayDay, setBdayDay] = useState<string>("");
  const [bdayYear, setBdayYear] = useState<string>("");
  const [suburb, setSuburb] = useState("");
  const [suburbPostcode, setSuburbPostcode] = useState<string | undefined>(undefined);
  const [suburbState, setSuburbState] = useState<string | undefined>(undefined);
  const [locationPrivate, setLocationPrivate] = useState(false);

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

  const birthdayString = useMemo(() => {
    if (!bdayMonth || !bdayDay) return "";
    const mm = String(bdayMonth).padStart(2, "0");
    const dd = String(parseInt(bdayDay, 10) || 0).padStart(2, "0");
    if (dd === "00") return "";
    return bdayYear && /^\d{4}$/.test(bdayYear) ? `${bdayYear}-${mm}-${dd}` : `${mm}-${dd}`;
  }, [bdayMonth, bdayDay, bdayYear]);

  const toggleInterest = (i: string) =>
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  // Step 1 validation — runs when the user presses Continue. Email is
  // required because it's the primary recovery channel (password reset,
  // login link, important account updates) and the simplest signal we
  // have to prevent the same person creating multiple accounts.
  const validateStep1 = () => {
    const u = username.trim().toLowerCase();
    if (!u || u.length < 3) { show("Username must be at least 3 characters"); return false; }
    const em = email.trim().toLowerCase();
    if (!em) { show("Email address is required"); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { show("Please enter a valid email address"); return false; }
    if (!pw || pw.length < 6) { show("Password must be at least 6 characters"); return false; }
    if (pw !== pw2) { show("Passwords do not match"); return false; }
    return true;
  };

  const continueFromStep1 = () => { if (validateStep1()) setStep(2); };

  const submit = async () => {
    setBusy(true);
    try {
      await signup({
        username: username.trim().toLowerCase(),
        password: pw,
        email: email.trim() ? email.trim().toLowerCase() : undefined,
        first_name: firstName.trim() || undefined,
        suburb: locationPrivate ? "" : suburb,
        suburb_postcode: locationPrivate ? undefined : suburbPostcode,
        suburb_state: locationPrivate ? undefined : suburbState,
        location_visibility: locationPrivate ? "private" : "suburb",
        interests,
        avatar,
        birthday: birthdayString || undefined,
        referrer_id: referrerId || undefined,
      });
      try { await AsyncStorage.removeItem("friendplace.invite.ref"); } catch { /* no-op */ }
      show(`Welcome${firstName ? `, ${firstName.trim()}` : ""}! 🦋`);
      router.replace("/onboarding");
    } catch (e: any) {
      // Bug fix (Garry, 24 Jun 2026): the old string-match branch here
      // recognised ONLY "Username already taken" and "Email already
      // registered" — every other backend failure (rate limit, invalid
      // chars, spaces in username, Pydantic 422 for a too-short
      // password, etc.) was silently squashed into the generic
      // "Could not create account. Try again." toast, which is what
      // led to Garry's TestFlight incident where a genuinely-new email
      // signup kept failing without any hint as to why.
      //
      // `api.ts` wraps failures as `new Error(\`${status} ${text}\`)`,
      // so the message begins with the HTTP status followed by the
      // JSON body (which is either `{"detail":"..."}` for HTTPException
      // or an array for Pydantic 422). We parse both shapes and
      // surface the real message, jumping to the correct wizard step
      // where relevant. Only truly unexpected shapes (network drop,
      // non-JSON body) fall through to the generic toast.
      const raw = String(e?.message || "");
      const m = raw.match(/^(\d{3})\s+(.*)$/s);
      const status = m ? parseInt(m[1], 10) : 0;
      let payload: any = null;
      try { payload = m ? JSON.parse(m[2]) : null; } catch { payload = null; }

      // Extract a plain-English detail message from either shape.
      // HTTPException → { detail: "..." }
      // Pydantic 422  → { detail: [ { loc, msg, ... } ] }
      let detail = "";
      if (payload && typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (payload && Array.isArray(payload.detail) && payload.detail[0]?.msg) {
        // Pydantic — turn "String should have at least 6 characters"
        // into something the member can act on. `loc` tells us which
        // field failed.
        const first = payload.detail[0];
        const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : "";
        const msg = String(first.msg || "");
        if (field === "password" && /at least (\d+) characters/i.test(msg)) {
          detail = "Password must be at least 6 characters";
        } else if (field === "email") {
          detail = "Please enter a valid email address";
        } else {
          detail = msg;
        }
      }

      // Route the toast + step-jump based on what the backend actually
      // said. Explicit branches are more readable than a long regex.
      if (status === 429) {
        show("Too many attempts from this network right now — please wait a few minutes and try again.");
      } else if (detail.includes("Username already taken")) {
        show("Username already taken"); setStep(1);
      } else if (detail.includes("Email already registered")) {
        show("Email already registered"); setStep(1);
      } else if (detail.toLowerCase().includes("username")) {
        // "at least 3 characters", "can't contain spaces", "can only
        // contain letters, numbers, and . _ -" — send them back to
        // step 1 with the actual reason.
        show(detail); setStep(1);
      } else if (detail.toLowerCase().includes("password")) {
        show(detail); setStep(1);
      } else if (detail.toLowerCase().includes("email")) {
        show(detail); setStep(1);
      } else if (detail) {
        // Any other detail — show it verbatim so members aren't left
        // guessing (e.g. a future field validation, a moderation
        // block, etc.).
        show(detail);
      } else if (status >= 500 || status === 0) {
        // Network drop / non-JSON body / server crash — the only
        // scenario where the generic fallback is appropriate.
        show("Could not create account. Try again.");
      } else {
        show("Could not create account. Try again.");
      }
    } finally { setBusy(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale };
  const headerTitle = step === 1 ? "Create Account" : "About You";

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title={headerTitle}
        // Step 2's header "back" goes to the welcome interstitial; the
        // in-page "Back to Step 1" link below the form is the primary way
        // to return — visible without scrolling on Step 2.
        backHref={step === 2 ? "/auth/welcome" : undefined}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Step indicator — single source of progress, sits above the
              form so it's the first thing the user sees on entry to each step. */}
          <View testID="signup-step-indicator" style={styles.stepperRow}>
            <View style={[styles.stepDot, { backgroundColor: c.brand }]}>
              <Text style={styles.stepDotText}>1</Text>
            </View>
            <View style={[styles.stepBar, { backgroundColor: step === 2 ? c.brand : c.border }]} />
            <View style={[styles.stepDot, { backgroundColor: step === 2 ? c.brand : c.border }]}>
              <Text style={[styles.stepDotText, { color: step === 2 ? "#FFFFFF" : c.muted }]}>2</Text>
            </View>
            <Text style={[styles.stepLabel, { color: c.muted, fontSize: 13 * scale }]}>
              Step {step} of 2 — {step === 1 ? "Account" : "About you"}
            </Text>
          </View>

          {step === 1 ? (
            <>
              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username  <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
              <TextInput testID="signup-username" value={username} onChangeText={setUsername} placeholder="e.g. maggie (lowercase)" autoCapitalize="none" autoCorrect={false} placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>First name <Text style={{ color: c.muted, fontSize: 13 * scale }}>(optional)</Text></Text>
              <TextInput testID="signup-first-name" value={firstName} onChangeText={setFirstName} placeholder="Shown on your profile" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
              <Text style={[styles.helper, { color: c.muted, fontSize: 12 * scale }]}>
                Only your first name is shown to other members. Surnames are never displayed.
              </Text>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Email address  <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
              <TextInput testID="signup-email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholderTextColor={c.muted} style={[styles.input, inputStyle]} />
              <Text style={[styles.helper, { color: c.muted, fontSize: 12 * scale }]}>
                Used for login, password recovery and important account updates.
              </Text>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Create password <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
              <PasswordField testID="signup-pw" value={pw} onChangeText={setPw} placeholder="At least 6 characters" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Confirm password <Text style={{ color: c.error, fontSize: 14 * scale }}>*</Text></Text>
              <PasswordField testID="signup-pw2" value={pw2} onChangeText={setPw2} placeholder="Re-enter password" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

              <View style={{ height: 18 }} />
              <Button
                testID="signup-continue"
                label="Continue"
                onPress={continueFromStep1}
              />
            </>
          ) : (
            <>
              {/* Friendly reassurance — these are all optional so people
                  don't feel like they have to finish everything to join. */}
              <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 4, lineHeight: 20 }}>
                Everything below is optional — you can finish setup later from your Profile.
              </Text>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Choose an avatar</Text>
              <View style={{ marginTop: 6 }}>
                <PeopleAvatarPicker value={avatar} onChange={setAvatar} previewSize={84} compact />
              </View>
              <Text style={[styles.label, { color: c.muted, fontSize: 13 * scale, marginTop: 4 }]}>Or pick a fun emoji</Text>
              <View style={styles.row}>
                {AVATARS.map((a) => (
                  <Pressable key={a} testID={`signup-avatar-${a}`} onPress={() => setAvatar(a)} style={[styles.avatarBtn, { backgroundColor: avatar === a ? c.brandTertiary : c.surfaceSecondary, borderColor: avatar === a ? c.brand : c.border }]}>
                    <Text style={{ fontSize: 30 }}>{a}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Birthday <Text style={{ color: c.muted, fontSize: 13 * scale }}>(for birthday waves)</Text></Text>
              <View style={styles.row}>
                {MONTHS.map((m, idx) => {
                  const on = bdayMonth === idx + 1;
                  return (
                    <Pressable key={m} testID={`signup-bday-month-${idx + 1}`} onPress={() => setBdayMonth(on ? null : idx + 1)} style={[styles.chip, { paddingHorizontal: 12, backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}>
                      <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontSize: 14 * scale, fontWeight: "700" }}>{m}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                <TextInput
                  testID="signup-bday-day"
                  value={bdayDay}
                  onChangeText={(t) => setBdayDay(t.replace(/[^0-9]/g, "").slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="Day (1–31)"
                  placeholderTextColor={c.muted}
                  style={[styles.input, inputStyle, { flex: 1 }]}
                />
                <TextInput
                  testID="signup-bday-year"
                  value={bdayYear}
                  onChangeText={(t) => setBdayYear(t.replace(/[^0-9]/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  placeholder="Year (optional)"
                  placeholderTextColor={c.muted}
                  style={[styles.input, inputStyle, { flex: 1 }]}
                />
              </View>
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4 }}>
                We only use your birthday to wish you a happy day on the community.
              </Text>

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Suburb <Text style={{ color: c.muted, fontSize: 13 * scale }}>(helps you find neighbours)</Text></Text>
              <SuburbField
                testID="signup-suburb"
                initialValue={suburb}
                preferNotToSay={locationPrivate}
                onChange={(m, pns) => {
                  if (pns) {
                    setSuburb("");
                    setSuburbPostcode(undefined);
                    setSuburbState(undefined);
                    setLocationPrivate(true);
                  } else if (m) {
                    setSuburb(m.name);
                    setSuburbPostcode(m.postcode);
                    setSuburbState(m.state);
                    setLocationPrivate(false);
                  } else {
                    setSuburb("");
                    setSuburbPostcode(undefined);
                    setSuburbState(undefined);
                    setLocationPrivate(false);
                  }
                }}
              />

              <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Interests</Text>
              <View style={styles.row}>
                {INTERESTS.map((i) => (
                  <Pressable key={i} onPress={() => toggleInterest(i)} style={[styles.chip, { backgroundColor: interests.includes(i) ? c.brand : c.surfaceSecondary, borderColor: interests.includes(i) ? c.brand : c.border }]}>
                    <Text style={{ color: interests.includes(i) ? c.onBrandPrimary : c.onSurface, fontSize: 15 * scale, fontWeight: "600" }}>{i}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ height: 18 }} />
              <Button testID="signup-submit" label="Create my account" onPress={submit} loading={busy} />
              {/* Plain-language consent line — also the URLs we hand to the
                  Apple/Google store listings. Tappable, opens in-app. */}
              <Text style={[styles.legal, { color: c.muted, fontSize: 12 * scale }]}>
                By creating an account you agree to our{" "}
                <Text
                  testID="signup-link-terms"
                  onPress={() => router.push("/legal/terms")}
                  style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}
                >
                  Terms of Use
                </Text>
                {" "}and{" "}
                <Text
                  testID="signup-link-privacy"
                  onPress={() => router.push("/legal/privacy")}
                  style={{ color: c.brand, fontWeight: "800", textDecorationLine: "underline" }}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
              <Pressable
                testID="signup-back"
                onPress={() => setStep(1)}
                style={({ pressed }) => [styles.backLink, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="arrow-back" size={16} color={c.muted} />
                <Text style={{ color: c.muted, fontWeight: "700", fontSize: 14 * scale }}>Back to Step 1</Text>
              </Pressable>
            </>
          )}
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40 },
  avatarBtn: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 2 },

  stepperRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: 8,
  },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  stepDotText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  stepBar: { width: 40, height: 3, borderRadius: 2 },
  stepLabel: { fontWeight: "800", letterSpacing: 0.2, marginLeft: 6 },
  legal: { marginTop: 12, textAlign: "center", lineHeight: 18 },

  backLink: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "center", paddingVertical: 14,
  },
});
