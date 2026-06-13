/**
 * YouBelong — push registration helper.
 *
 * Permission-first, then native device token, then relay to backend.
 * Honours the YouBelong permission contract:
 *   • Caller is expected to show a context modal BEFORE invoking this.
 *   • Denial is non-fatal; we just skip registration silently.
 *
 * Web and Expo Go (without dev-client) return early — push only fully
 * works after the user publishes + generates a native build.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

const API = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export async function registerForPush(userId: string): Promise<"granted" | "denied" | "skipped" | "error"> {
  if (Platform.OS === "web") return "skipped";
  // Expo Go (managed) cannot resolve native push tokens — bail gracefully
  if (Constants.appOwnership === "expo") return "skipped";
  if (!userId) return "skipped";
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      if (!current.canAskAgain) return "denied";
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
      if (!granted) return "denied";
    }
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    const device_token = tokenResp?.data;
    if (!device_token) return "error";
    await fetch(`${API}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        platform: Platform.OS,
        device_token: String(device_token),
      }),
    }).catch(() => {});
    return "granted";
  } catch {
    return "error";
  }
}
