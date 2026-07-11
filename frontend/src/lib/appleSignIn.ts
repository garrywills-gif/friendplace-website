/**
 * Sign in with Apple — iOS-native helper.
 *
 * Only iOS devices have a native Apple Sign-In sheet. On Android and the web
 * preview we hide the button entirely (callers should gate on
 * `isAppleSignInAvailable()`), so this helper is intentionally thin: it just
 * wraps `expo-apple-authentication.signInAsync` and returns the bits the
 * backend needs (identity_token + first/last name on the very first sign-in).
 *
 * Apple Sign-In ONLY works in a development/production build, NOT in Expo Go.
 * The native module is a no-op on web (Platform.OS !== 'ios').
 *
 * Backend wires the identity_token into POST /api/auth/apple, which verifies
 * the signature against Apple's published JWK set, then either logs in the
 * existing user (matched by apple_id, then email) or creates a new account
 * using the same flow as Google sign-in. Returns `{access_token, user, is_new}`.
 */
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

export type AppleCredential = {
  identityToken: string;
  // Apple ships an authorization_code we can swap for a refresh_token on
  // the backend (server-to-server, using our Sign in with Apple .p8 key).
  // Required for token revocation on account deletion (App Store Guideline
  // 5.1.1(v)). Null if Apple didn't return one (rare).
  authorizationCode: string | null;
  firstName: string | null;
  lastName: string | null;
};

/** True only on iOS *and* when the native Apple Sign-In bridge is available
 *  (i.e. iOS 13+ in a real build, never Expo Go web). Callers use this to
 *  decide whether to render the button at all. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Whether the Apple button should be RENDERED (even if it won't be fully
 *  functional in the current runtime). We show it in the Emergent web
 *  preview so product owners reviewing the app on iPad Safari can see
 *  the button lives on this screen — it just displays a "preview only"
 *  toast when tapped instead of trying to launch a non-existent native
 *  sheet. On Android we hide it entirely (Apple Sign-In doesn't apply). */
export async function shouldShowAppleButton(): Promise<boolean> {
  if (Platform.OS === "ios") return isAppleSignInAvailable();
  // Emergent web preview → render the button so the design/review looks
  // identical to the TestFlight build. Tapping it will show a helpful
  // toast rather than crash.
  if (Platform.OS === "web") return true;
  // Android → Apple ID sign-in doesn't apply, so nothing to show.
  return false;
}

/** Kicks off the native Apple Sign-In sheet. Returns `null` if the user
 *  cancels the dialog, throws on any other error so the caller can show a
 *  toast. The identityToken is always set when status is success. */
export async function startAppleSignIn(): Promise<AppleCredential | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) return null;
    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode ?? null,
      firstName: credential.fullName?.givenName ?? null,
      lastName: credential.fullName?.familyName ?? null,
    };
  } catch (e: any) {
    // ERR_REQUEST_CANCELED → user dismissed the sheet, treat as "no action"
    if (e?.code === "ERR_REQUEST_CANCELED" || e?.code === "ERR_CANCELED") {
      return null;
    }
    throw e;
  }
}
