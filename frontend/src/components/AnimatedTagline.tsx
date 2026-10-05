/**
 * AnimatedTagline — the "Because you belong too" line sitting right
 * under the FriendPlace wordmark.
 *
 * iter233 (Neo, Oct 2026 — final brand polish #3):
 *   • Teal (#14B8A6) to pair with the "Place" half of the wordmark.
 *   • Tasteful script styling: iOS uses the built-in Snell Roundhand
 *     cursive; Android/web fall back to italic serif so Android
 *     members still get a handwritten feel without a custom font
 *     ship.
 *   • Positioned tight under the wordmark (``marginTop: -2``) so logo
 *     + tagline read as one brand lockup rather than two stacked
 *     lines with slack between them.
 *   • Handwriting reveal animation plays ONCE per cold launch of the
 *     app (module-level guard — not AsyncStorage, so a logout/login
 *     still counts as the same launch session until the process is
 *     killed). After the write-on, it sits perfectly static.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";

// Module-level flag: once the tagline has been handwritten this
// session, every subsequent mount (navigation back to Home,
// Moments → Home, etc.) just renders the static tagline. A full
// process restart (cold launch) resets the flag.
let TAGLINE_HAS_ANIMATED = false;

export default function AnimatedTagline({
  text = "Because you belong too",
  fontSize = 14,
}: {
  text?: string;
  fontSize?: number;
}) {
  const [measured, setMeasured] = useState<number | null>(null);
  const reveal = useRef(new Animated.Value(TAGLINE_HAS_ANIMATED ? 1 : 0)).current;
  const played = useRef(TAGLINE_HAS_ANIMATED);

  useEffect(() => {
    if (played.current || measured == null) return;
    played.current = true;
    TAGLINE_HAS_ANIMATED = true;
    Animated.timing(reveal, {
      toValue: 1,
      duration: 1800,                          // 1.5–2s per spec
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,                   // animating width %, not transform
    }).start();
  }, [measured, reveal]);

  // Interpolate 0→1 into width 0→measured for the left-to-right reveal.
  const revealWidth = measured != null
    ? reveal.interpolate({ inputRange: [0, 1], outputRange: [0, measured] })
    : 0 as any;

  return (
    <View
      // Measure the full tagline once so we can animate a precise
      // left-to-right unmask. The hidden sizing <Text> has
      // ``opacity: 0`` so it never flashes, but still occupies the
      // final layout space the parent reserves for the tagline.
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && measured !== w) setMeasured(w);
      }}
      style={styles.wrap}
      accessibilityLabel={text}
      accessibilityRole="text"
    >
      {/* Layout spacer: full tagline rendered invisibly to reserve
          the natural horizontal space. Prevents layout shift when
          the animated reveal grows. */}
      <Text style={[styles.base, { fontSize, opacity: 0 }]} numberOfLines={1}>
        {text}
      </Text>
      {/* Animated clip: a width-constrained wrapper that overflows
          hidden. The real tagline sits inside with its own fixed
          width equal to the measured natural width — so the clip
          crops left-to-right without the inner <Text> ever being
          asked to re-wrap or ellipsise mid-stroke. */}
      <Animated.View
        style={[
          styles.clip,
          measured != null ? { width: revealWidth, height: "100%" as any } : { width: 0 },
        ]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.base,
            {
              fontSize,
              width: measured ?? undefined,
              // No numberOfLines here — the clip handles the mask so
              // we must NOT re-wrap or ellipsise during the reveal.
            },
          ]}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Negative top margin pulls the tagline tight under the wordmark
    // so the pair reads as a single brand lockup. The parent
    // ``AppHeader.textCol`` already handles vertical rhythm — this
    // just closes the gap.
    marginTop: -2,
    position: "relative",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  clip: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
  },
  base: {
    color: "#14B8A6",                           // teal — matches "Place"
    fontWeight: "500",
    letterSpacing: 0.3,
    includeFontPadding: false,
    ...Platform.select({
      // iOS has a lovely built-in cursive. Android/web fall back to
      // italic serif so members still get a handwritten feel.
      ios: { fontFamily: "Snell Roundhand", fontWeight: "700" as any },
      default: { fontStyle: "italic", fontFamily: Platform.OS === "android" ? "serif" : undefined },
    }),
  },
});
