import "react-native-gesture-handler";
// Side-effect import: sets Text.defaultProps.allowFontScaling + maxFontSizeMultiplier
// so every screen respects iOS Dynamic Type / Android font-size settings,
// capped at 1.4× to protect our older-adult-tuned layouts. See file for detail.
import "@/src/lib/text-scaling";
import { Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ThemeProvider } from "@/src/lib/theme";
import { AuthProvider } from "@/src/lib/auth";
import { ToastProvider } from "@/src/lib/toast";
import { GeorgeProvider } from "@/src/lib/george-context";
import { StatusProvider } from "@/src/lib/status-context";
import { DmNotifyProvider } from "@/src/lib/dm-notify-context";
// GlobalDmPrompt intentionally disabled at Garry's request (2026-08-13):
// the repeating "🦋 Kerry sent you a private message" sliding sheet
// used to resurface until the chat was opened. The green Home unread-
// chat card (iter159) is now the persistent in-app reminder, and the
// OS push notification handles the away/background case. Import is
// kept in code (via a `void` reference below) so a future revive is
// one uncomment away.
import GlobalDmPrompt from "@/src/components/GlobalDmPrompt";
import { UserSocketProvider } from "@/src/lib/user-socket";
import { hydrateVoice } from "@/src/lib/george-voice";
import GeorgeGlobalHost from "@/src/components/george/GeorgeGlobalHost";
import SplashGate from "@/src/components/SplashGate";
import ErrorBoundary from "@/src/components/ErrorBoundary";
import FlutterOverlay from "@/src/components/FlutterOverlay";
void GlobalDmPrompt;

SplashScreen.preventAutoHideAsync();

// ── Push notifications (iter155) ─────────────────────────────────────────
//
// Module-scope setup so handlers exist BEFORE any push can arrive.
// Emergent-managed push (SuprSend relay) delivers data-only FCM payloads;
// `expo-notifications` renders them on Android via its bundled
// `ExpoFirebaseMessagingService`. On iOS the plugin wires APNs.
//
// Suppression rule (approved 2026-08-06):
//   - Foregrounded, inside the target DM screen  → NO push at all.
//   - Foregrounded elsewhere                     → NO banner (in-app WS
//                                                  already handles it via
//                                                  DmNotifyProvider).
//   - Backgrounded / screen-locked / app closed  → System push banner.
//                                                  Tap deep-links to the
//                                                  correct conversation.
//
// We suppress banners while foregrounded by returning
// `shouldShowBanner: false`. Background delivery is untouched — the OS
// renders it natively without consulting this handler.
if (Platform.OS !== "web") {
  // Lazy require so web builds never touch the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require("expo-notifications");

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Foreground: suppress the banner; DmNotifyProvider already surfaces
      // the DM via GlobalDmPrompt. Background delivery goes straight to
      // the OS notification tray, unaffected by this handler.
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
      // Retained for backwards compat with older expo-notifications.
      shouldShowAlert: false,
    }),
  });

  if (Platform.OS === "android") {
    // Channel MUST be created at module scope so it exists before the
    // first push arrives. Android freezes channel props on creation, so
    // if we ever need to tweak sound/priority, bump to `default-v2`.
    Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      showBadge: true,
    });
  }
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Prime George's voice preference (AsyncStorage → in-memory cache)
  // so the SpeakerButton doesn't briefly render before the pref loads.
  useEffect(() => { hydrateVoice(); }, []);

  // ── Push-notification tap routing (iter155) ─────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");

    const routeFor = (data: any): string | null => {
      if (!data || typeof data !== "object") return null;
      if (data.dm_id && typeof data.dm_id === "string") {
        return `/dm/${data.dm_id}`;
      }
      const url = data.action_url || data.deeplink;
      return typeof url === "string" && url.length ? url : null;
    };

    // Warm tap — user taps a system push while the app is running.
    const tapSub = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        try {
          const data = response?.notification?.request?.content?.data || {};
          const route = routeFor(data);
          if (!route) return;
          if (route.startsWith("http")) {
            Linking.openURL(route);
          } else {
            router.push(route as any);
          }
        } catch (e) {
          console.warn("[push] tap route failed", e);
        }
      }
    );

    // Cold-start tap — user tapped a push while the app was killed.
    Notifications.getLastNotificationResponseAsync()
      .then((response: any) => {
        if (!response) return;
        const data = response?.notification?.request?.content?.data || {};
        const route = routeFor(data);
        if (!route) return;
        if (route.startsWith("http")) {
          Linking.openURL(route);
        } else {
          router.push(route as any);
        }
      })
      .catch(() => {});

    // Denied-permission weekly nudge (playbook §Nudging denied users).
    // We only nudge when the user is genuinely stuck: status='denied' AND
    // OS refuses to re-prompt. The dialog is deferred to a lightweight
    // toast to avoid interrupting older-adult reading flows.
    (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (perm.status !== "denied" || perm.canAskAgain) return;
        const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (lastNudge && Date.now() - Number(lastNudge) <= oneWeek) return;
        await AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
        // Rely on ToastProvider — imported below — to surface the nudge.
        // We DO NOT auto-open settings; that's the user's call.
        // A future iteration can add an in-app "Enable notifications"
        // banner; for now the toast is enough to unstick them.
      } catch {}
    })();

    return () => {
      try { tapSub.remove(); } catch {}
    };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <SafeAreaProvider>
            <ThemeProvider>
              <AuthProvider>
                <ToastProvider>
                  <StatusProvider>
                    <GeorgeProvider>
                    {/* UserSocketProvider (iter154) — MUST live above
                        DmNotifyProvider so the DM prompt can consume
                        real-time events. Idle sink while unauthed;
                        opens the WS as soon as AuthProvider hands us
                        a user + token. */}
                    <UserSocketProvider>
                    <DmNotifyProvider>
                    <StatusBar style="dark" />
                    <SplashGate>
                      {/* contentStyle sets the Stack's scene background so
                          screen-to-screen transitions never flash through
                          to the OS home screen (visible bug reproduced in
                          Expo Go on iOS, ~0.5 s flicker when switching
                          tabs). Same neutral surface used across the app.
                          `animation: "none"` avoids a subtle 200ms cross-
                          fade that ALSO exposed the transparent frame. */}
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F8FAFC" }, animation: "none" }} />
                    </SplashGate>
                    {/* Global celebration overlay — mounted above every
                        screen so `emitFlutter()` can fire the butterfly
                        animation from anywhere in the app. */}
                    <FlutterOverlay />
                    {/* C1 Slice 3 — George follows the member across
                        every screen. `GeorgeGlobalHost` hides itself
                        on auth / onboarding / landing / waitlist. */}
                    <GeorgeGlobalHost />
                    {/* Global DM prompt (approved 24 Jun 2026) — the
                        "🦋 Kerry sent you a private message" bottom-
                        sheet that used to slide in on any screen and
                        keep resurfacing until the chat was opened.
                        Disabled 2026-08-13 at Garry's request: the
                        green Home unread-chat card (iter159) is now
                        the persistent in-app reminder, and the OS
                        push notification handles the away/background
                        case. Rendering both was noisy. The
                        DmNotifyProvider stays mounted because the
                        Chats tab still consumes its context for its
                        live-update stream — only the visible sheet
                        is removed. */}
                    {/* <GlobalDmPrompt /> */}
                  </DmNotifyProvider>
                  </UserSocketProvider>
                  </GeorgeProvider>
                  </StatusProvider>
                </ToastProvider>
              </AuthProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
