import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, ViewStyle } from "react-native";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

/**
 * ButterflyFlutter — a tiny FriendPlace butterfly that flutters up once
 * and fades out.
 *
 * Locked with Garry 31 July 2026 as the visual reward for tapping ❤️
 * on a Moment. The mandate was:
 *
 *   "Don't make it pop. Make the butterfly flutter once. Tiny.
 *    Elegant. Almost unnoticed. It reinforces Butterfly Points and
 *    FriendPlace's identity without becoming gimmicky."
 *
 * Renders the master FriendPlace butterfly via `GeorgeButterflyMark`
 * — the single source of truth for the FriendPlace butterfly.
 */
type Props = {
  /** Increment (or set to any new value) to play the flutter. */
  trigger: number | string | null;
  /** Optional style override for the wrapper (positioning). */
  style?: ViewStyle;
  /** Optional size in pt. Defaults to 16. */
  size?: number;
};

export default function ButterflyFlutter({ trigger, style, size = 16 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trigger === null || trigger === undefined) return;
    opacity.setValue(0);
    translateY.setValue(0);
    sway.setValue(0);

    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(360),
        Animated.timing(opacity, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.timing(translateY, {
        toValue: -26,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(sway, { toValue:  1, duration: 220, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue:  0, duration: 220, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ]).start();
  }, [trigger, opacity, translateY, sway]);

  const translateX = sway.interpolate({
    inputRange: [-1, 1],
    outputRange: [-4, 4],
  });

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Animated.View style={{ opacity, transform: [{ translateY }, { translateX }] }}>
        <GeorgeButterflyMark size={size} />
      </Animated.View>
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
