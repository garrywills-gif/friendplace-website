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
import { shouldShowAppleButton, startAppleSignIn } from "@/src/lib/appleSignIn";
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
  const { width: winW, height: winH } = useWindowDimensions();
  // True while we're swapping a Google session_id for a JWT — also true while
  // the Emergent OAuth tab/redirect is in flight on web so the buttons stay
  // disabled and the user gets a spinner.
  // Per-provider busy state — previously both Apple and Google shared one
  // `authBusy` flag, which caused BOTH spinners to appear the moment either
  // button was pressed (confusing for older users who wondered which one
  // was actually running). Tracking the active provider fixes it.
  const [authBusyProvider, setAuthBusyProvider] = useState<null | "apple" | "google">(null);
  const authBusy = authBusyProvider !== null;
  const setAuthBusy = (v: boolean) => setAuthBusyProvider(v ? authBusyProvider ?? "apple" : null);
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
    // Probe Apple Sign-In visibility once on mount. Renders on iOS
    // (fully functional) and web (preview / design-review use). Hidden
    // on Android where the option doesn't apply.
    (async () => {
      try {
        const ok = await shouldShowAppleButton();
        if (!cancelled) setAppleReady(ok);
      } catch { /* button stays hidden, no harm */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Welcome-page hero — deliberately BIG so the FriendPlace butterfly +
  // wordmark are the first thing a new user sees. Sits above the
  // signature "Because you belong too." tagline, then the welcome copy
  // and CTAs. The old iconic width (~320px cap) was tastefully small;
  // this one leans confidently premium.
  //
  // Sizing goals:
  //   winW < 380 (iPhone mini) → cap ~ 320
  //   winW ~ 393-430 (standard iPhone) → cap ~ 380
  //   winW > 600 (iPad)  → cap 520
  const lockupWidth = Math.round(Math.min(winW - 72, 520));
  // Butterfly height — grown to ~30% of the lockup so it reads as the
  // hero. Still capped by screen height so the CTAs stay above the fold
  // on short devices (iPhone SE, split-view iPad).
  const butterflyPx = Math.max(120, Math.min(240, Math.round(Math.min(lockupWidth * 0.5, winH * 0.28))));
  // Compact-height mode — trims vertical padding, headline size and
  // margin when we're on a short phone or landscape orientation so the
  // Sign Up / Log In buttons stay above the fold.
  const compact = winH < 720;

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
          AsyncStorage.setItem("friendplace.invite.ref", ref).catch(() => {});
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
          show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
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
    // CRITICAL: depend on `user?.id` (stable primitive) — NOT on the
    // `user` object reference. AuthProvider.refresh() creates a new
    // user object on every background refresh (silent or not), even
    // when the data is identical. If this effect depended on the whole
    // object, every tab's useFocusEffect that called refresh() would
    // trigger this hook, which calls router.replace("/home") and
    // yanks the user back to the Home tab. Reported bug: Profile tab
    // rendered fully with data, then bounced to Home ~500ms later.
  }, [loading, user?.id]);

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
        setAuthBusyProvider("google");
        const sid = await startGoogleSignIn();
        // On web, the page navigates away — control never reaches here.
        // On native, sid is the freshly returned session_id (or null on cancel).
        if (sid) {
          const r = await loginWithGoogle(sid, null);
          show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
          router.replace("/home" as any);
        } else if (Platform.OS !== "web") {
          // user cancelled the in-app browser
          setAuthBusyProvider(null);
        }
      } catch (e: any) {
        setAuthBusyProvider(null);
        show("Google sign-in failed. Please try again or use email.");
      }
      return;
    }
    if (provider === "Apple") {
      // Web preview mode — Apple's native sheet doesn't exist here.
      // Show a helpful toast so reviewers know the button IS wired up
      // and works on real iOS builds. Prevents a confusing dead-tap.
      if (Platform.OS !== "ios") {
        show("Sign in with Apple works on iPhone / iPad. In the web preview, please use Google or email.");
        return;
      }
      try {
        setAuthBusyProvider("apple");
        const credential = await startAppleSignIn();
        if (!credential) {
          // Cancelled — drop the spinner so the buttons re-enable.
          setAuthBusyProvider(null);
          return;
        }
        // Best-effort pickup of an invite ref captured at app launch.
        let ref: string | null = null;
        try { ref = await AsyncStorage.getItem("friendplace.invite.ref"); } catch {}
        const r = await loginWithApple(credential.identityToken, credential.authorizationCode, credential.firstName, credential.lastName, ref);
        try { await AsyncStorage.removeItem("friendplace.invite.ref"); } catch {}
        show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
        const dest = r.isNew ? "/onboarding" : "/home";
        router.replace(dest as any);
      } catch (e: any) {
        setAuthBusyProvider(null);
        // Surface the *actual* backend/native error so TestFlight bugs are
        // diagnosable at a glance. `api.appleAuth` propagates the FastAPI
        // `HTTPException.detail` verbatim via `req()`; the Apple native
        // module uses `e.code` for the SIWA error type. Anything unmapped
        // falls through to the generic message.
        const nativeCode = (e?.code || "").toString();
        const backendMsg = (e?.message || "").toString().trim();
        // eslint-disable-next-line no-console
        console.warn("[apple-signin] failed", { nativeCode, backendMsg, err: e });
        if (nativeCode === "ERR_REQUEST_UNKNOWN" || nativeCode === "ERR_INVALID_RESPONSE") {
          show("Apple sign-in couldn't complete. Please check your internet and try again.");
        } else if (nativeCode === "ERR_REQUEST_NOT_HANDLED") {
          show("Apple sign-in needs to be enabled on this device. Check Settings → Apple ID.");
        } else if (nativeCode === "ERR_REQUEST_NOT_INTERACTIVE") {
          show("Apple sign-in needs a full sign-in — try again.");
        } else if (backendMsg) {
          // Show the real backend message so we can diagnose from TestFlight
          // screenshots. Trimmed to 140 chars so the toast still fits.
          const trimmed = backendMsg.length > 140 ? `${backendMsg.slice(0, 137)}…` : backendMsg;
          show(`Apple sign-in: ${trimmed}`);
        } else {
          show("Apple sign-in failed. Please try again or use email.");
        }
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

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            // Respect the Dynamic Island / notch by keeping the brand
            // below the safe-area edge. Removed the previous negative
            // offset that pushed content up under the island on iPhone.
            paddingTop: insets.top + (compact ? 6 : 14),
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        {/* Hero — the FriendPlace brand IS the page. Big butterfly +
            wordmark, then the signature italic "Because you belong
            too." tagline directly beneath, then a warm welcome line.
            Everything reads as ONE brand moment before the reader's
            eye reaches the CTAs. */}
        <View style={styles.hero}>
          <View style={styles.logoWrap} testID="welcome-brand">
            {/* `showTagline={false}` because we render the signature
                brand tagline ourselves below — bigger, italic, and in
                the accent teal so it commands the space it deserves. */}
            <BrandLockup width={lockupWidth} variant="dark" butterflySize={butterflyPx} showTagline={false} />
          </View>

          {/* Signature brand promise — the primary FriendPlace tagline.
              Bigger, italic, mint-teal on navy. Sized generously so it
              anchors the hero the way "Think Different." anchored old
              Apple ads. */}
          <Text
            style={[styles.heroTagline, { fontSize: (compact ? 22 : 26) * scale, marginTop: compact ? 14 : 20 }]}
            testID="welcome-brand-tagline"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            Because you belong too.
          </Text>

          {/* Softer welcome line — invites the reader IN without
              competing with the brand promise above it.
              Copy locked with Garry, 1 Aug 2026:
                - "communicate belonging, not features"
                - primary line: long, emotional, three-beat cadence
                - compact devices get a two-beat variant so the
                  three-beat one never wraps awkwardly to 3 lines
              Deliberately NOT using "Because you belong too." here —
              that phrase already anchors the tagline directly above. */}
          <Text
            style={[styles.welcomeMsg, { fontSize: (compact ? 15 : 16) * scale, marginTop: compact ? 10 : 14 }]}
            testID="welcome-message"
          >
            {compact
              ? "Find your people. Share little moments that matter."
              : "Find your people. Share life\u2019s little moments. Feel part of your community again."}
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
                🦋 Become one of our first 250 Founding Members
              </Text>
              <Text style={[styles.founderBannerNote, { fontSize: 12 * scale }]}>
                Join free as a Founding Member.
              </Text>
            </Pressable>
          ) : null}
          <Pressable testID="welcome-signup" onPress={() => router.push("/auth/welcome")} style={({ pressed }) => [styles.btnPrimary, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnPrimaryText, { fontSize: 24 * scale }]}>Sign Up</Text>
          </Pressable>
          <Pressable testID="welcome-login" onPress={() => router.push("/auth/login")} style={({ pressed }) => [styles.btnOutline, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.btnOutlineText, { fontSize: 20 * scale }]}>Log In</Text>
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
              {authBusyProvider === "apple" ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="logo-apple" size={26} color="#FFFFFF" />
              )}
              <Text style={[styles.socialText, { color: "#FFFFFF", fontSize: 18 * scale }]}>
                {authBusyProvider === "apple" ? "Signing in…" : "Continue with Apple"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable testID="welcome-google" disabled={authBusy} onPress={() => handleSocial("Google")} style={({ pressed }) => [styles.social, { backgroundColor: "#FFFFFF", opacity: authBusy ? 0.6 : (pressed ? 0.85 : 1) }]}>
            {authBusyProvider === "google" ? (
              <ActivityIndicator size="small" color="#1E3A7F" />
            ) : (
              <Ionicons name="logo-google" size={24} color="#1E3A7F" />
            )}
            <Text style={[styles.socialText, { color: "#1E3A7F", fontSize: 18 * scale }]}>
              {authBusyProvider === "google" ? "Signing in…" : "Continue with Google"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#0D2A57" },
  content: { paddingHorizontal: 22, flexGrow: 1, justifyContent: "flex-start", gap: 10 },
  hero: { alignItems: "center", marginTop: 0 },
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
    marginTop: 14,
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  // Signature FriendPlace tagline styling — italic mint-teal on the
  // navy hero, big enough to anchor the Welcome screen without shouting.
  // Soft glow so it reads clearly against the community photo watermark.
  heroTagline: {
    color: "#CCFBF1",           // mint-100 — reads warmly on the navy/teal gradient
    fontStyle: "italic",
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  brandLine: {
    color: "#CCFBF1",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 10,
    fontWeight: "700",
    fontStyle: "italic",
    letterSpacing: 0.2,
    lineHeight: 22,
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
    marginTop: 8,
    paddingHorizontal: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  actions: { gap: 12, marginTop: 16, marginBottom: 16 },
  btnPrimary: {
    minHeight: 72, borderRadius: 999, backgroundColor: "#FFFFFF",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32,
    shadowColor: "#0D2A57", shadowOpacity: 0.38, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  btnPrimaryText: { color: "#1E3A7F", fontWeight: "900", letterSpacing: 0.4 },
  btnOutline: {
    minHeight: 56, borderRadius: 999, borderWidth: 2, borderColor: "#FFFFFF",
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
  founderBannerRemaining: {
    color: "#FFFFFF",
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.3,
    opacity: 0.85,
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
