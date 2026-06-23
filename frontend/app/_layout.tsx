import "react-native-gesture-handler";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ThemeProvider } from "@/src/lib/theme";
import { AuthProvider } from "@/src/lib/auth";
import { ToastProvider } from "@/src/lib/toast";
import SplashGate from "@/src/components/SplashGate";

SplashScreen.preventAutoHideAsync();

// --- Push notifications: module-scope setup (must NOT live inside a component) ---
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
if (Platform.OS === "android") {
  // Fire-and-forget; Android requires this before any push arrives.
  Notifications.setNotificationChannelAsync("default", {
    name: "YouBelong",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  }).catch(() => {});
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const router = useRouter();
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Push tap handlers — warm & cold start. Web is skipped.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data: any = response.notification.request.content.data || {};
        const url = data.deeplink || data.action_url;
        if (!url) return;
        if (String(url).startsWith("http")) Linking.openURL(url);
        else router.push(url);
      } catch {}
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      try {
        const data: any = response.notification.request.content.data || {};
        const url = data.deeplink || data.action_url;
        if (!url) return;
        if (String(url).startsWith("http")) Linking.openURL(url);
        else router.push(url);
      } catch {}
    }).catch(() => {});
    return () => { tapSub.remove(); };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <StatusBar style="dark" />
              <SplashGate>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F8FAFC" } }} />
              </SplashGate>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
