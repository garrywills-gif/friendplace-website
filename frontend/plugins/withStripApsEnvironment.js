/**
 * YouBelong — withStripApsEnvironment
 *
 * A defensive Expo config plugin that guarantees the final generated iOS
 * `.entitlements` file does NOT contain the `aps-environment` (Apple Push
 * Notifications) key.
 *
 * Why this exists:
 *   The Emergent EAS build pipeline auto-generates a `credentials.json`
 *   on macrunner which historically declared push-notification entitlements
 *   even after we removed `expo-notifications` from the project. That
 *   caused EAS to inject `aps-environment` into the built entitlements
 *   file, which then failed code-signing against the current provisioning
 *   profile (which does NOT include the Push Notifications capability).
 *
 *   Since we ARE NOT shipping push notifications in this build, this
 *   plugin explicitly strips the entitlement at the last possible moment
 *   in the config resolution pipeline. Safe to remove ONLY once
 *   push notifications are officially enabled on the App ID and the
 *   provisioning profile is regenerated with Push Notifications capability.
 *
 * References:
 *   - https://docs.expo.dev/config-plugins/introduction/
 *   - https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment
 */

const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Removes push-notification-related entitlement keys from the generated
 * iOS `.entitlements` plist.
 *
 * @param {import('@expo/config-plugins').ExpoConfig} config
 */
const withStripApsEnvironment = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults) {
      // Strip Apple Push Notifications entitlements. We do NOT ship push
      // notifications in this build, and the provisioning profile issued
      // by our credentials pipeline does not include this capability.
      delete cfg.modResults['aps-environment'];
      delete cfg.modResults['com.apple.developer.aps-environment'];
      delete cfg.modResults['com.apple.developer.usernotifications.communication'];
      delete cfg.modResults['com.apple.developer.usernotifications.time-sensitive'];
    }
    return cfg;
  });
};

module.exports = withStripApsEnvironment;
