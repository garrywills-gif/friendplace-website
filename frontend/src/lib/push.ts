/**
 * YouBelong — push registration helper (STUBBED).
 *
 * Push notifications are deferred until we enable the Apple Push
 * Notifications capability on our provisioning profile. This module
 * is intentionally a no-op so the app builds cleanly without the
 * `aps-environment` entitlement (which the EAS provisioning profile
 * does not currently support). Re-enable by reintroducing the
 * `expo-notifications` package + config plugin, and enabling
 * "Push Notifications" on the App ID in the Apple Developer portal.
 */

export async function registerForPush(
  _userId: string,
): Promise<"granted" | "denied" | "skipped" | "error"> {
  return "skipped";
}
