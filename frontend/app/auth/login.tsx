import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";
import AvatarBubble from "@/src/components/AvatarBubble";
import AsyncStorage from "@react-native-async-storage/async-storage";
// Social auth helpers — identical to the ones the welcome screen uses, so
// returning users get the same reliable OAuth flow whether they land on
// the welcome page or tap "Log In" directly.
import { startGoogleSignIn, consumePendingSession } from "@/src/lib/googleSignIn";
import { shouldShowAppleButton, startAppleSignIn } from "@/src/lib/appleSignIn";

type DemoAccount = { username: string; first_name: string; avatar: string; suburb: string };

// expo-router's router.replace("/home") silently no-ops on iPad Safari when
// the destination is a tab screen. Use a hard URL change there, fall back to
// router.replace on native.
function goHome(router: ReturnType<typeof useRouter>) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).location.assign("/home");
  } else {
    router.replace("/home" as any);
  }
}

export default function Login() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { login, demoLogin, user, loading, loginWithGoogle, loginWithApple } = useAuth() as any;
  const { show } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [demos, setDemos] = useState<DemoAccount[]>([]);
  const [showDemos, setShowDemos] = useState(false);
  // Ref to the outer ScrollView so we can programmatically scroll to
  // the bottom when the user expands the demo-account picker. Without
  // this, on narrow phones the demo grid renders below the fold and
  // the user thinks nothing happened when they tapped "Try a demo
  // account" (test-user feedback).
  const scrollRef = useRef<ScrollView>(null);
  // Per-provider busy state — matches the welcome page so both sign-in
  // surfaces feel identical. Also lets us disable the other button while
  // one provider is mid-flow.
  const [authBusyProvider, setAuthBusyProvider] = useState<null | "apple" | "google">(null);
  // Whether the device supports native Apple Sign-In. False on Android,
  // web, and inside Expo Go — Apple Sign-In requires a real iOS build.
  const [appleReady, setAppleReady] = useState(false);

  // Safety guard: if a signed-in user lands here (e.g. via browser Back),
  // bounce to Home so it never feels like they've been logged out.
  useEffect(() => {
    if (!loading && user) goHome(router);
  }, [loading, user, router]);

  useEffect(() => {
    (async () => {
      try { setDemos(await api.demoAccounts() as DemoAccount[]); } catch {}
    })();
  }, []);

  // Probe Apple button visibility once on mount. Renders on iOS
  // (fully functional) and web (preview / design-review). Hidden on
  // Android where Apple Sign-In doesn't apply.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await shouldShowAppleButton();
        if (!cancelled) setAppleReady(ok);
      } catch {
        if (!cancelled) setAppleReady(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Process an Emergent Google session_id that may already be in the URL
  // when we arrive here after a web-based OAuth redirect. Same behaviour
  // as index.tsx — completes the login and bounces to Home.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await consumePendingSession(loginWithGoogle);
        // Only redirect when we actually consumed a session_id from the URL.
        // `consumePendingSession` ALWAYS returns an object (truthy), so
        // gating on `r` alone was silently bouncing every visitor to /home
        // and hiding the login form entirely.
        if (r?.handled && !cancelled) {
          show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
          goHome(router);
        }
      } catch (e: any) {
        if (!cancelled) show(e?.message?.includes("401") ? "Google sign-in expired. Please try again." : "Sign-in failed. Please try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [loginWithGoogle, router, show]);

  const submit = async () => {
    const id = identifier.trim();
    if (!id) { show("Enter your username or email"); return; }
    if (!pw) { show("Enter your password"); return; }
    setBusy(true);
    try {
      await login(id, pw);
      goHome(router);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("429")) show("Too many attempts. Please wait a few minutes.");
      else if (msg.includes("Demo accounts")) show("Use 'Try a demo account' below");
      else if (msg.includes("403") && (msg.toLowerCase().includes("banned") || msg.toLowerCase().includes("suspend"))) show("Your account is restricted. Please contact support.");
      else show("Invalid username or password");
    } finally { setBusy(false); }
  };

  const runDemo = async (u: string) => {
    setBusy(true);
    try {
      await demoLogin(u);
      goHome(router);
    } catch {
      show("Demo unavailable. Try again.");
    } finally { setBusy(false); }
  };

  // Social sign-in handler — mirrors the welcome page. Apple Sign-In
  // creates the account on first tap or logs into the existing account
  // matched by apple_id/email. New Apple accounts still go through
  // onboarding; existing users land straight on Home.
  const handleSocial = async (provider: "Apple" | "Google") => {
    if (provider === "Google") {
      try {
        setAuthBusyProvider("google");
        const sid = await startGoogleSignIn();
        if (sid) {
          const r = await loginWithGoogle(sid, null);
          show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
          const dest = r.isNew ? "/onboarding" : "/home";
          if (Platform.OS === "web") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).location.assign(dest);
          } else {
            router.replace(dest as any);
          }
        } else if (Platform.OS !== "web") {
          setAuthBusyProvider(null);
        }
      } catch {
        setAuthBusyProvider(null);
        show("Google sign-in failed. Please try again or use email.");
      }
      return;
    }
    if (provider === "Apple") {
      // Web preview mode — no native Apple sheet exists. Toast the
      // reviewer instead of silently swallowing the tap.
      if (Platform.OS !== "ios") {
        show("Sign in with Apple works on iPhone / iPad. In the web preview, please use Google or email.");
        return;
      }
      try {
        setAuthBusyProvider("apple");
        const credential = await startAppleSignIn();
        if (!credential) {
          setAuthBusyProvider(null);
          return;
        }
        let ref: string | null = null;
        try { ref = await AsyncStorage.getItem("friendplace.invite.ref"); } catch {}
        const r = await loginWithApple(credential.identityToken, credential.authorizationCode, credential.firstName, credential.lastName, ref);
        try { await AsyncStorage.removeItem("friendplace.invite.ref"); } catch {}
        show(r.isNew ? "Welcome to FriendPlace!" : "Welcome back!");
        const dest = r.isNew ? "/onboarding" : "/home";
        if (Platform.OS === "web") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).location.assign(dest);
        } else {
          router.replace(dest as any);
        }
      } catch (e: any) {
        setAuthBusyProvider(null);
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
          const trimmed = backendMsg.length > 140 ? `${backendMsg.slice(0, 137)}…` : backendMsg;
          show(`Apple sign-in: ${trimmed}`);
        } else {
          show("Apple sign-in failed. Please try again or use email.");
        }
      }
    }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale };
  const socialsBusy = authBusyProvider !== null || busy;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Log In" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.onSurfaceSecondary, fontSize: 17 * scale }]}>Welcome back!</Text>

          {/* Social sign-in — same buttons users see on the welcome
              screen so returning members can pick their preferred
              provider without swiping back. Apple button only renders
              on real iOS builds where the native sheet is available. */}
          {appleReady ? (
            <Pressable
              testID="login-apple"
              accessibilityLabel="Sign in with Apple"
              disabled={socialsBusy}
              onPress={() => handleSocial("Apple")}
              style={({ pressed }) => [styles.appleBtn, { opacity: pressed || socialsBusy ? 0.85 : 1 }]}
            >
              {authBusyProvider === "apple" ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.appleGlyph}></Text>
                  <Text style={styles.appleLabel}>Sign in with Apple</Text>
                </>
              )}
            </Pressable>
          ) : null}

          <Pressable
            testID="login-google"
            accessibilityLabel="Continue with Google"
            disabled={socialsBusy}
            onPress={() => handleSocial("Google")}
            style={({ pressed }) => [styles.googleBtn, { opacity: pressed || socialsBusy ? 0.85 : 1, borderColor: c.border }]}
          >
            {authBusyProvider === "google" ? (
              <ActivityIndicator size="small" color="#1F2937" />
            ) : (
              <>
                {/* Simple 4-square Google glyph via inline text so no extra
                    dependency is needed. Colours match Google's brand kit. */}
                <View style={styles.googleGlyphWrap}>
                  <Text style={[styles.googleG, { color: "#4285F4" }]}>G</Text>
                </View>
                <Text style={styles.googleLabel}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* Divider — clear separation between "quick tap" social auth
              and the deliberate email/password path. */}
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
            <Text style={[styles.dividerText, { color: c.muted, fontSize: 12 * scale }]}>OR SIGN IN WITH EMAIL</Text>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          </View>

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username or email</Text>
          <TextInput
            testID="login-identifier"
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="username or email"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={c.muted}
            style={[styles.input, inputStyle]}
          />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Password</Text>
          <PasswordField testID="login-pw" value={pw} onChangeText={setPw} placeholder="Your password" placeholderTextColor={c.muted} inputStyle={[styles.input, inputStyle]} iconColor={c.brand} />

          <Pressable testID="login-forgot" onPress={() => router.push("/auth/forgot")} hitSlop={8} style={{ alignSelf: "flex-end", paddingVertical: 6 }}>
            <Text style={{ color: c.brandSecondary, fontWeight: "700", fontSize: 15 * scale }}>Forgot password?</Text>
          </Pressable>

          <Button testID="login-submit" label="Log in" onPress={submit} loading={busy} />

          <Pressable testID="login-toggle-demos" onPress={() => {
            setShowDemos((v) => {
              const next = !v;
              // Scroll to end after the panel expands so the demo tiles
              // are visible. requestAnimationFrame + a small setTimeout
              // give React one frame to lay out the new content before
              // we ask the ScrollView to jump — otherwise scrollToEnd
              // fires before the demo grid has any height.
              if (next && scrollRef.current) {
                setTimeout(() => {
                  scrollRef.current?.scrollToEnd({ animated: true });
                }, 80);
              }
              return next;
            });
          }} hitSlop={8} style={{ marginTop: 18, alignSelf: "center" }}>
            <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale }}>{showDemos ? "Hide demo accounts" : "Try a demo account"}</Text>
          </Pressable>

          {showDemos && (
            <View
              // onLayout gives us a second chance to scroll: when the demo
              // panel finishes measuring (which can lag the state update on
              // low-end devices), fire another scroll-to-end so slower
              // phones don't miss the reveal.
              onLayout={() => {
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
            >
              <Text style={[styles.demoIntro, { color: c.muted, fontSize: 13 * scale }]}>
                Demo accounts are kept separate from real signups. Tap one to explore.
              </Text>
              <View style={styles.demoRow}>
                {demos.map((d) => (
                  <Pressable key={d.username} testID={`demo-${d.username}`} onPress={() => runDemo(d.username)} style={[styles.demoBtn, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                    <AvatarBubble value={d.avatar} size={28} fallback="🙂" />
                    <Text style={{ color: c.onBrandTertiary, fontSize: 15 * scale, fontWeight: "800", marginTop: 4 }}>{d.first_name || d.username}</Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>@{d.username}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 8 },
  intro: { fontWeight: "600", marginBottom: 8 },
  label: { fontWeight: "700", marginTop: 10 },
  input: { borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" },

  // Sign in with Apple — matches Apple's Human Interface Guidelines
  // (solid black, white glyph + label, rounded corners).
  appleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 999,
    backgroundColor: "#000000",
    marginTop: 4,
  },
  appleGlyph: { color: "#FFFFFF", fontSize: 22, marginTop: -3 },
  appleLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: 17, letterSpacing: 0.2 },

  // Continue with Google — clean white pill with Google glyph, matching
  // the Google Identity brand kit spec.
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    marginTop: 10,
  },
  googleGlyphWrap: { alignItems: "center", justifyContent: "center", width: 20, height: 20 },
  googleG: { fontWeight: "900", fontSize: 20 },
  googleLabel: { color: "#1F2937", fontWeight: "700", fontSize: 17, letterSpacing: 0.2 },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 22,
    marginBottom: 8,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontWeight: "800", letterSpacing: 1 },

  demoIntro: { fontWeight: "500", marginTop: 10, textAlign: "center" },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  demoBtn: { width: "47%", borderRadius: 20, padding: 14, borderWidth: 2, alignItems: "center", minHeight: 110, justifyContent: "center" },
});
