import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Animated, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import BrandLockup from "./BrandLockup";

/**
 * SplashGate — an in-JS brand splash overlay that briefly shows the official
 * "FriendPlace COMMUNITY" lockup over a clean teal-tinted backdrop on app start.
 *
 * Why this exists:
 *   The native expo-splash-screen uses a static PNG. To keep the brand
 *   reveal consistent with the rest of the app (and easy to maintain), we
 *   show this lightweight, vector-style splash for ~900ms after the native
 *   splash hides, then fade it out. It uses the same `BrandLockup` component
 *   that the Welcome screen renders, so the user sees a single, continuous
 *   brand moment from launch → welcome.
 *
 * Behaviour:
 *   - Shows for ~900ms minimum, then fades out over 280ms.
 *   - Sits at the very top of the layout tree so it covers everything.
 *   - Renders only once per app session.
 *   - On web, also throttled to once per 24h via AsyncStorage so frequent
 *     reloads/tab-opens during the day don't feel laggy to returning users.
 */
const HOLD_MS = 900;
const FADE_MS = 280;
const WEB_THROTTLE_KEY = "friendplace.splash.lastShown";
const WEB_THROTTLE_MS = 1000 * 60 * 60 * 6; // 6 hours

export default function SplashGate({ children }: { children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // On web, recently-shown users skip the splash so navigations between
      // pages don't feel slow. Mobile always shows it for the brand moment.
      if (Platform.OS === "web") {
        try {
          const last = await AsyncStorage.getItem(WEB_THROTTLE_KEY);
          if (last && Date.now() - Number(last) < WEB_THROTTLE_MS) {
            if (!cancelled) {
              setShow(false);
              setDone(true);
            }
            return;
          }
          AsyncStorage.setItem(WEB_THROTTLE_KEY, String(Date.now())).catch(() => {});
        } catch {
          /* fall through and show the splash anyway */
        }
      }

      // Hold the splash for HOLD_MS so the brand reveal lands, then fade out.
      const t = setTimeout(() => {
        if (cancelled) return;
        Animated.timing(fade, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }).start(() => {
          if (!cancelled) {
            setShow(false);
            setDone(true);
          }
        });
      }, HOLD_MS);

      return () => clearTimeout(t);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {show ? (
        <Animated.View
          pointerEvents={done ? "none" : "auto"}
          style={[StyleSheet.absoluteFillObject, styles.splash, { opacity: fade }]}
        >
          <BrandLockup width={340} variant="dark" testID="splash-lockup" />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    // Brand navy backdrop so the wordmark (designed with a baked-in
    // white glow / navy halo) reads cleanly during the brand reveal.
    backgroundColor: "#0D2A57",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
});
