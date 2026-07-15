/**
 * Emergent-managed Google Sign-In helper.
 *
 * Two-step flow:
 *   1. `startGoogleSignIn()` — kicks the user off to Emergent's hosted Google
 *      OAuth page. On web we navigate the tab directly; on native we use
 *      `expo-web-browser` so the system browser handles the redirect.
 *   2. `consumePendingSession(handler)` — runs on app mount and looks for a
 *      `session_id` in the URL (web) or initial deep link (native). If found,
 *      it forwards it to the auth context, which swaps it server-side for a
 *      FriendPlace JWT.
 *
 * The redirect URL is platform-specific per the playbook:
 *   - web:    `${window.location.origin}/` (existing root route)
 *   - native: `Linking.createURL('auth')` (resolves to exp://… in Expo Go and
 *             the app's scheme in standalone builds)
 */
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";

const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/";

function buildRedirectUrl(): string {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = (globalThis as any).window;
    const origin = (w && w.location && w.location.origin) || "";
    return origin ? `${origin}/` : "/";
  }
  return Linking.createURL("auth");
}

function buildAuthUrl(redirect: string): string {
  return `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  // Hash fragment is preferred per the playbook (#session_id=…) but we also
  // accept the query string variant some browsers normalise into.
  const m = url.match(/[#&?]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Kick off the Google sign-in flow. Returns a resolved session_id on native
 * if the in-app browser succeeds; on web the page navigates away and the
 * caller never gets a return value. */
export async function startGoogleSignIn(): Promise<string | null> {
  const redirect = buildRedirectUrl();
  const authUrl = buildAuthUrl(redirect);
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = (globalThis as any).window;
    if (w && w.location) w.location.assign(authUrl);
    return null;
  }
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
  if (result?.type === "success") {
    return extractSessionId((result as any).url);
  }
  return null;
}

/** Consume a `session_id` that may already be present in the launching URL.
 * Returns true if a session was handed off to the loginWithGoogle handler. */
export async function consumePendingSession(
  loginWithGoogle: (sid: string, referrerId?: string | null) => Promise<{ isNew: boolean }>,
): Promise<{ handled: boolean; isNew: boolean }> {
  let sid: string | null = null;
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = (globalThis as any).window;
    if (w?.location) {
      sid = extractSessionId(`${w.location.hash || ""}${w.location.search || ""}`);
      if (sid) {
        // Clean the URL so a refresh doesn't try to swap the same session
        // twice (Emergent session ids are one-shot).
        try {
          w.history?.replaceState(null, "", w.location.pathname);
        } catch {}
      }
    }
  } else {
    try {
      const initial = await Linking.getInitialURL();
      sid = extractSessionId(initial);
    } catch {}
  }
  if (!sid) return { handled: false, isNew: false };
  let ref: string | null = null;
  try { ref = await AsyncStorage.getItem("friendplace.invite.ref"); } catch {}
  const r = await loginWithGoogle(sid, ref);
  // Clear the invite ref now that it's been attributed
  try { await AsyncStorage.removeItem("friendplace.invite.ref"); } catch {}
  return { handled: true, isNew: r.isNew };
}
