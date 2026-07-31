import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from "react-native";

/**
 * ButterflyFlutter — a tiny 🦋 that flutters up once and fades out.
 *
 * Locked with Garry 31 July 2026 as the visual reward for tapping ❤️
 * on a Moment. The mandate was:
 *
 *   "Don't make it pop. Make the butterfly flutter once. Tiny.
 *    Elegant. Almost unnoticed. It reinforces Butterfly Points and
 *    FriendPlace's identity without becoming gimmicky."
 *
 * So this is deliberately restrained: ~14pt butterfly, translates
 * up ~26px, fades to 0 over 900ms, with a gentle sway. Runs when
 * `trigger` changes (incrementing a counter or setting a fresh
 * timestamp). Absolutely positioned inside a parent so it doesn't
 * affect layout.
 */
type Props = {
  /** Increment (or set to any new value) to play the flutter. */
  trigger: number | string | null;
  /** Optional style override for the wrapper (positioning). */
  style?: ViewStyle;
  /** Optional emoji override — defaults to 🦋. */
  emoji?: string;
  /** Optional size (font-size in pt). Defaults to 16. */
  size?: number;
};

export default function ButterflyFlutter({ trigger, style, emoji = "🦋", size = 16 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trigger === null || trigger === undefined) return;
    // Reset baseline every time we play, so successive taps re-play.
    opacity.setValue(0);
    translateY.setValue(0);
    sway.setValue(0);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.delay(360),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(translateY, {
        toValue: -26,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Gentle left-right sway to sell the "flutter" (not a straight up-tick).
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 1,
          duration: 220,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: -1,
          duration: 260,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: 0,
          duration: 220,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [trigger, opacity, translateY, sway]);

  const translateX = sway.interpolate({
    inputRange: [-1, 1],
    outputRange: [-4, 4],
  });

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Animated.Text
        style={{
          fontSize: size,
          opacity,
          transform: [{ translateY }, { translateX }],
        }}
      >
        {emoji}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
