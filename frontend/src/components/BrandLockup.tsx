import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";

/**
 * BrandLockup — the official "YouBelong COMMUNITY" lockup.
 *
 * Uses the original baked PNG wordmark (with the butterfly forming the "O"
 * in YouBelong) and adds a small "COMMUNITY" descriptor strap underneath.
 *
 * Two visual variants:
 *   - "light"  → for light backgrounds (uses brand teal tagline `#1B7A8A`)
 *   - "dark"   → for dark backgrounds (mint tagline `#A7F3D0`)
 *
 * The `width` prop drives the size of the wordmark image; the tagline
 * scales proportionally so the lockup keeps its rhythm at any size from
 * compact in-app through hero on the welcome screen / splash.
 */
export type BrandLockupVariant = "light" | "dark";

// Official YouBelong brand mark — bold variant with baked-in white glow +
// navy halo so the wordmark stays crisp/readable on any backdrop.
const BRAND_LOGO = require("../../assets/brand/youbelong-logo-bold.png");
const LOGO_ASPECT = 1066 / 326; // intrinsic pixel ratio of the PNG

export default function BrandLockup({
  width = 320,
  variant = "light",
  showTagline = true,
  testID,
}: {
  width?: number;             // wordmark width in points
  variant?: BrandLockupVariant;
  showTagline?: boolean;
  testID?: string;
}) {
  const imgH = Math.round(width / LOGO_ASPECT);

  // Tagline reads as a wide descriptor — letter-spaced "C O M M U N I T Y"
  // sized so it visually mirrors the breadth of the wordmark above it.
  const taglineFs = Math.max(11, Math.round(width * 0.06));
  const taglineLetterSpacing = taglineFs * 0.55;
  const taglineColor = variant === "dark" ? "#A7F3D0" : "#1B7A8A";

  return (
    <View style={styles.wrap} testID={testID || "brand-lockup"}>
      <Image
        source={BRAND_LOGO}
        style={{ width, height: imgH }}
        contentFit="contain"
        transition={150}
      />
      {showTagline ? (
        <Text
          allowFontScaling={false}
          style={[
            styles.tagline,
            {
              fontSize: taglineFs,
              color: taglineColor,
              letterSpacing: taglineLetterSpacing,
              // Pad-left compensates for trailing letter-spacing so the
              // tagline optically centers under the wordmark.
              paddingLeft: taglineLetterSpacing,
              // Pull tagline up slightly so it nests under the wordmark
              // baseline instead of floating after the PNG's empty padding.
              marginTop: -Math.round(imgH * 0.08),
            },
          ]}
        >
          COMMUNITY
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  tagline: {
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
});
