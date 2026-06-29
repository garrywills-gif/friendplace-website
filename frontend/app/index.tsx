import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, useWindowDimensions, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { startGoogleSignIn, consumePendingSession } from "@/src/lib/googleSignIn";
import { isAppleSignInAvailable, startAppleSignIn } from "@/src/lib/appleSignIn";
import { api } from "@/src/lib/api";
import BrandLockup from "@/src/components/BrandLockup";

// Warm photo of 3 adults talking & smiling — sits behind the gradient as a soft watermark
const COMMUNITY_BG =
  "https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=1400&q=80";

export default function Welcome() {
  const router = useRouter();
  const { scale } = useTheme();
  const { user, loading, loginWithGoogle, loginWithApple } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  // True while we're swapping a Google session_id for a JWT — also true while
  // the Emergent OAuth tab/redirect is in flight on web so the buttons stay
  // disabled and the user gets a spinner.
  const [authBusy, setAuthBusy] = useState(false);
  // Whether the device supports native Apple Sign-In. False on Android, web,
  // and in Expo Go (the native module is unavailable until a dev/prod build).
  // We hide the button entirely when unavailable so non-iOS users don't see
  // a dead end. Apple requires Sign in with Apple alongside Google for the
  // App Store, but only on platforms where it actually works.
  const [appleReady, setAppleReady] = useState(false);
  // Founding Member counter — cheap stat that gives the welcome page a
  // "real, alive community" feel. Failing silently is fine (the banner
  // simply doesn't render) so it never blocks the auth flow.
  const [founderStatus, setFounderStatus] = useState<{ taken: number; cap: number; remaining: number; open: boolean } | null>(null);

  useEffect(() => {
    // Best-effort fetch of the public Founding Member counter. Silent on
    // failure — banner just doesn't render so the welcome page stays clean
    // when the API is unavailable (e.g. first paint before service is up).
    let cancelled = false;
    (async () => {
      try {
        const s: any = await api.founderStatus();
        if (!cancelled) setFounderStatus(s);
      } catch {
        /* no banner, no harm */
      }
    })();
    // Probe Apple Sign-In availability once on mount. iOS only.
    (async () => {
      try {
        const ok = await isAppleSignInAvailable();
        if (!cancelled) setAppleReady(ok);
      } catch { /* button stays hidden, no harm */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Brand lockup uses the original PNG wordmark (with the butterfly forming
  // the "O" in YouBelong) plus a "COMMUNITY" tagline strap underneath.
  // Sized in points — caps at 545 so it never overflows on tablet widths.
  const lockupWidth = Math.round(Math.min(winW - 28, 545));

  useEffect(() => {
    // Capture an invitation token (?ref=<user_id>) into AsyncStorage so the
    // signup screen can attribute the new user back to their inviter. Runs
    // on web only — the QR / link share flow doesn't apply to native deep
    // links here (those would go through a different scheme).
    if (Platform.OS === "web") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w: any = window;
        const params = new URLSearchParams(w?.location?.search || "");
        const ref = params.get("ref");
        if (ref && /^[A-Za-z0-9_-]{6,64}$/.test(ref)) {
          AsyncStorage.setItem("youbelong.invite.ref", ref).catch(() => {});
        }
      } catch {}
    }
  }, []);

  // Process an Emergent Google session_id that may already be in the URL
  // (web hash fragment after redirect, or initial deep-link on native).
  // Has to run before any auto-redirect to /home so we don't lose the token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAuthBusy(true);
        const r = await consumePendingSession(loginWithGoogle);
        if (cancelled) return;
        if (r.handled) {
          show(r.isNew ? "Welcome to YouBelong!" : "Welcome back!");
          // Brand-new users go straight into the onboarding wizard; returning
          // users land on /home. The home tab also has a guard that catches
          // any non-onboarded user as a safety net.
          const dest = r.isNew ? "/onboarding" : "/home";
          if (Platform.OS === "web") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).location.assign(dest);
          } else {
            router.replace(dest as any);
          }
        }
      } catch (e: any) {
        if (!cancelled) show(e?.message?.includes("401") ? "Google sign-in expired. Please try again." : "Sign-in failed. Please try again.");
      } finally {
        if (!cancelled) setAuthBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && user) {
      // Same workaround as /auth/login — router.replace silently no-ops on
      // iPad Safari for tab destinations.
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).location.assign("/home");
      } else {
        router.replace("/home" as any);
      }
    }
  }, [loading, user]);

  if (loading) {
    return (
      <View style={[styles.full, { backgroundColor: "#0D2A57", justifyContent: "center", alignItems: "center" }]}>
        <BrandLockup width={340} variant="dark" />
        <ActivityIndicator size="large" color="#FFFFFF" style={{ marginTop: 28 }} />
      </View>
    );
  }

  const handleSocial = async (provider: string) => {
    if (provider === "Google") {
      try {
        setAuthBusy(true);
        const sid = await startGoogleSignIn();
        // On web, the page navigates away — control never reaches here.
        // On native, sid is the freshly returned session_id (or null on cancel).
        if (sid) {
          const r = await loginWithGoogle(sid, null);
          show(r.isNew ? "Welcome to YouBelong!" : "Welcome back!");
          router.replace("/home" as any);
        } else if (Platform.OS !== "web") {
          // user cancelled the in-app browser
          setAuthBusy(false);
        }
      } catch (e: any) {
        setAuthBusy(false);
        show("Google sign-in failed. Please try again or use email.");
      }
      return;
    }
    if (provider === "Apple") {
      try {
        setAuthBusy(true);
        const credential = await startAppleSignIn();
        if (!credential) {
          // Cancelled — drop the spinner so the buttons re-enable.
          setAuthBusy(false);
          return;
        }
        // Best-effort pickup of an invite ref captured at app launch.
        let ref: string | null = null;
        try { ref = await AsyncStorage.getItem("youbelong.invite.ref"); } catch {}
        const r = await loginWithApple(credential.identityToken, credential.authorizationCode, credential.firstName, credential.lastName, ref);
        try { await AsyncStorage.removeItem("youbelong.invite.ref"); } catch {}
        show(r.isNew ? "Welcome to YouBelong!" : "Welcome back!");
        const dest = r.isNew ? "/onboarding" : "/home";
        router.replace(dest as any);
      } catch (e: any) {
        setAuthBusy(false);
        show("Apple sign-in failed. Please try again or use email.");
      }
      return;
    }
    show(`${provider} sign-in is coming soon. Please sign up with email or use Log In for now.`);
  };

  return (
    <View style={styles.full}>
      {/* Watermark photo behind everything */}
      <Image source={COMMUNITY_BG} style={StyleSheet.absoluteFillObject} contentFit="cover" />

      {/* Navy → bright-teal diagonal brand gradient — pushed a touch darker so the
          logo, headline and buttons become the main focus on the photo backdrop. */}
      <LinearGradient
        colors={[
          "rgba(4, 14, 34, 0.92)",   // near-black navy, top-left
          "rgba(10, 28, 64, 0.90)",  // deep navy
          "rgba(18, 70, 110, 0.86)", // dim blue-teal
          "rgba(14, 95, 90, 0.90)",  // muted teal
          "rgba(8, 60, 55, 0.94)",   // deep teal-green, bottom-right
        ]}
        locations={[0, 0.28, 0.55, 0.82, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {/* Hero — official YouBelong logo (with butterfly forming the "O")
            plus a "COMMUNITY" descriptor strap underneath. */}
        <View style={styles.hero}>
          <View style={styles.logoWrap} testID="welcome-brand">
            <BrandLockup width={lockupWidth} variant="dark" />
          </View>

          <Text style={[styles.tag1, { fontSize: 30.4 * scale }]} testID="welcome-tag-primary">Find Your People.</Text>
          <Text style={[styles.welcomeMsg, { fontSize: 14 * scale }]} testID="welcome-message">
            Meet new friends, discover local events and find your people.
          </Text>
        </View>

        <View style={styles.actions}>
          {/* Founding Member recruiting tile — copy adapts to the cohort
              state: pre-launch shows the aspirational "be among the first
              N" pitch, then once real signups arrive flips to a live
              "X places remaining" counter so the scarcity feels honest. */}
          {founderStatus && founderStatus.open && founderStatus.cap > 0 ? (
            <Pressable
              testID="welcome-founder-banner"
              onPress={() => {
                // Non-founders (and unauthenticated visitors) see the
                // info / opt-in page first; existing founders skip the
                // pitch and land straight on the Wall.
                const isFounder = !!(user as any)?.is_founder;
                router.push(isFounder ? "/founders" : "/founders/info");
              }}
              accessibilityLabel="View the Founders Wall"
              style={({ pressed }) => [styles.founderBanner, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.founderBannerTitle, { fontSize: 16 * scale }]}>
                🦋 Founding Members
              </Text>
              {founderStatus.taken > 0 ? (
                <Text style={[styles.founderBannerBody, { fontSize: 15 * scale, marginTop: 4 }]}>
                  <Text style={{ fontWeight: "900", color: "#FBBF24" }}>{founderStatus.remaining.toLocaleString()}</Text> Founding Member places remaining.
                </Text>
              ) : (
                <Text style={[styles.founderBannerBody, { fontSize: 15 * scale, marginTop: 4 }]}>
                  Be among the first <Text style={{ fontWeight: "900", color: "#FBBF24" }}>{founderStatus.cap.toLocaleString()}</Text> Founding Members helping shape YouBelong.
                </Text>
              )}
              <Text style={[styles.founderBannerNote, { fontSize: 12 * scale }]}>
                Join free as a Founding Member.
              </Text>
            </Pressable>
          ) : null}
          <Pressable testID="welcome-signup" onPress={() => router.push("/auth/welcome")} style={({ pressed }) => [styles.btnPrimary, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnPrimaryText, { fontSize: 22 * scale }]}>Sign Up</Text>
          </Pressable>
          <Pressable testID="welcome-login" onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.btnOutline, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnOutlineText, { fontSize: 22 * scale }]}>Log In</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={[styles.orText, { fontSize: 14 * scale }]}>or</Text>
            <View style={styles.line} />
          </View>

          {/* Apple Sign-In — iOS-only, native sheet. Required alongside
              Google by App Store guidelines (4.8). Hidden on Android/web
              and in Expo Go where the native module isn't available, so
              non-iOS users never see a dead-end button. */}
          {appleReady ? (
            <Pressable
              testID="welcome-apple"
              disabled={authBusy}
              onPress={() => handleSocial("Apple")}
              style={({ pressed }) => [styles.social, { backgroundColor: "#000000", opacity: authBusy ? 0.6 : (pressed ? 0.85 : 1) }]}
              accessibilityRole="button"
              accessibilityLabel="Sign in with Apple"
            >
              {authBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="logo-apple" size={26} color="#FFFFFF" />
              )}
              <Text style={[styles.socialText, { color: "#FFFFFF", fontSize: 18 * scale }]}>
                {authBusy ? "Signing in…" : "Continue with Apple"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable testID="welcome-google" disabled={authBusy} onPress={() => handleSocial("Google")} style={({ pressed }) => [styles.social, { backgroundColor: "#FFFFFF", opacity: authBusy ? 0.6 : (pressed ? 0.85 : 1) }]}>
            {authBusy ? (
              <ActivityIndicator size="small" color="#1E3A7F" />
            ) : (
              <Ionicons name="logo-google" size={24} color="#1E3A7F" />
            )}
            <Text style={[styles.socialText, { color: "#1E3A7F", fontSize: 18 * scale }]}>
              {authBusy ? "Signing in…" : "Continue with Google"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#0D2A57" },
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 14 },
  hero: { alignItems: "center", marginTop: 4 },
  miniTag: {
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
    marginTop: 12,
    fontWeight: "700",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    // No JS-level shadow/box — the bold PNG ships with a baked-in white outer
    // glow + soft navy halo so the wordmark blends straight onto the photo.
    backgroundColor: "transparent",
  },
  tag1: {
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: 22,
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  tag2: {
    color: "#CCFBF1",
    textAlign: "center",
    marginTop: 6,
    fontWeight: "700",
    fontStyle: "italic",
    letterSpacing: 0.3,
  },
  welcomeMsg: {
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    marginTop: 10,
    paddingHorizontal: 14,
    lineHeight: 19,
    fontWeight: "500",
  },
  actions: { gap: 12, marginTop: 28, marginBottom: 16 },
  btnPrimary: {
    minHeight: 62, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0D2A57", shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  btnPrimaryText: { color: "#1E3A7F", fontWeight: "900", letterSpacing: 0.3 },
  btnOutline: {
    minHeight: 62, borderRadius: 999, borderWidth: 2, borderColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)",
  },
  btnOutlineText: { color: "#FFFFFF", fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.5)" },
  orText: { color: "#FFFFFF", fontWeight: "700" },
  social: {
    minHeight: 58, borderRadius: 999, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  socialText: { fontWeight: "700" },
  founderBanner: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "#FBBF24",   // warm gold accent
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    marginBottom: 4,
    gap: 6,
  },
  founderBannerBody: {
    color: "#FFFFFF",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
  },
  founderBannerTitle: {
    color: "#FBBF24",
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.6,
  },
  founderBannerNote: {
    color: "#FBBF24",
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.4,
    marginTop: 2,
  },
});
