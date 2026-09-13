/**
 * FriendPlace — Emergent-managed push registration helper.
 *
 * Wired for iter155. Backend already relays to SuprSend via
 * `POST /api/register-push`; this module handles the native side:
 *
 *   1. Ask permission contextually (defer to `requestForDmContext`
 *      after login so the ask lands right when it makes sense).
 *   2. Fetch a native APNs/FCM token via `getDevicePushTokenAsync`
 *      (NOT the Expo push token — the Emergent relay expects the
 *      raw native token).
 *   3. POST to `/api/register-push` with `{user_id, platform,
 *      device_token}`. The backend's SuprSend relay dedupes on
 *      `(user_id, device_token)`; a token re-registered under a
 *      different `user_id` is naturally reassigned.
 *   4. Gracefully skip in dev environments where push isn't set up
 *      (Expo Go, web, simulator without APNs, `EMERGENT_PUSH_KEY=
 *      placeholder` — the backend already treats the last case as
 *      a no-op).
 *
 * Guards:
 *   - Never blocks messaging: any failure returns and logs.
 *   - Never re-requests permission when the user has denied twice
 *     (`canAskAgain === false`); a weekly nudge dialog lives in
 *     `app/_layout.tsx`.
 *   - On logout we clear the local `pushRegisteredFor` marker so
 *     the next login re-registers the token under the new user_id.
 *     (SuprSend has no public de-register endpoint on the relay;
 *     re-registration under the new user_id transparently supersedes
 *     the previous binding.)
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "fp:pushRegisteredFor"; // "<user_id>:<token>" so we don't re-register redundantly
const NUDGE_KEY = "pushNudgeAt";           // used by _layout.tsx too

type PushResult = "granted" | "denied" | "unsupported" | "skipped" | "error";

// The base URL comes from Expo's `EXPO_PUBLIC_BACKEND_URL` (public env
// vars are the only ones inlined into the release JS bundle). The
// non-public `EXPO_BACKEND_URL` fallback that used to live here has
// been removed because it silently resolves at dev time but is
// `undefined` in a Store build — deployment health check flagged that
// as a release-only reachability risk (11 Aug 2026).
function backendUrl(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv;
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, string>;
  return extra.EXPO_PUBLIC_BACKEND_URL || null;
}

/**
 * Registers the current device for push under a given user_id.
 * Idempotent — safe to call on login AND on every app open.
 *
 * Never throws; returns a coarse status for the caller.
 */
export async function registerForPush(user_id: string): Promise<PushResult> {
  if (Platform.OS === "web") return "unsupported";
  if (!user_id) return "skipped";
  // Expo Go on iOS can't get real APNs tokens — skip cleanly so the dev
  // preview keeps working. On production/dev builds this is a real device.
  if (!Device.isDevice) return "unsupported";

  try {
    const Notifications = await import("expo-notifications");
    const perm = await Notifications.getPermissionsAsync();

    let status = perm.status;
    if (status !== "granted") {
      // Only ask once per install if the OS still allows it.
      if (perm.canAskAgain === false) return "denied";
      const req = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = req.status;
    }

    if (status !== "granted") return "denied";

    // Native token (FCM on Android, APNs on iOS).
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    const device_token = tokenResp.data;
    if (!device_token || typeof device_token !== "string") return "error";

    // Idempotency: don't hammer the backend on every foreground.
    const marker = `${user_id}:${device_token}`;
    const seen = await AsyncStorage.getItem(STORAGE_KEY);
    if (seen === marker) return "granted";

    const url = backendUrl();
    if (!url) {
      // No backend URL means we can't relay — skip cleanly, remain silent.
      return "skipped";
    }

    const resp = await fetch(`${url}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id,
        platform: Platform.OS,
        device_token,
      }),
    });

    if (!resp.ok) {
      // Backend logs the upstream error; frontend just remembers to
      // retry next open by NOT stamping the marker.
      return "error";
    }
    await AsyncStorage.setItem(STORAGE_KEY, marker);
    return "granted";
  } catch (e) {
    // Never blow up messaging on push failures.
    console.warn("[push] registerForPush failed", e);
    return "error";
  }
}

/**
 * Called on logout so the next login re-registers under the new user_id.
 * We don't (and can't) unregister on SuprSend from the client — but
 * re-registration transparently supersedes the previous binding, and
 * clearing our local marker guarantees that re-register will happen.
 */
export async function clearPushRegistration(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    // Also clear the weekly nudge stamp so a returning user isn't stuck
    // in a "we already asked" cooldown from a previous account.
    await AsyncStorage.removeItem(NUDGE_KEY);
  } catch {}
}
