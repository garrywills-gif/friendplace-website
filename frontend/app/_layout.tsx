import "react-native-gesture-handler";
// Side-effect import: sets Text.defaultProps.allowFontScaling + maxFontSizeMultiplier
// so every screen respects iOS Dynamic Type / Android font-size settings,
// capped at 1.4× to protect our older-adult-tuned layouts. See file for detail.
import "@/src/lib/text-scaling";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ThemeProvider } from "@/src/lib/theme";
import { AuthProvider } from "@/src/lib/auth";
import { ToastProvider } from "@/src/lib/toast";
import { GeorgeProvider } from "@/src/lib/george-context";
import { hydrateVoice } from "@/src/lib/george-voice";
import GeorgeGlobalHost from "@/src/components/george/GeorgeGlobalHost";
import SplashGate from "@/src/components/SplashGate";
import ErrorBoundary from "@/src/components/ErrorBoundary";
import FlutterOverlay from "@/src/components/FlutterOverlay";

SplashScreen.preventAutoHideAsync();

// Push notifications are deferred — see /app/frontend/src/lib/push.ts

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Prime George's voice preference (AsyncStorage → in-memory cache)
  // so the SpeakerButton doesn't briefly render before the pref loads.
  useEffect(() => { hydrateVoice(); }, []);

  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <SafeAreaProvider>
            <ThemeProvider>
              <AuthProvider>
                <ToastProvider>
                  <GeorgeProvider>
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
                  </GeorgeProvider>
                </ToastProvider>
              </AuthProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
