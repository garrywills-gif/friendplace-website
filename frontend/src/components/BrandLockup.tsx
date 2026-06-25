import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";

/**
 * BrandLockup — the official "YouBelong COMMUNITY" lockup.
 *
 * Uses the original baked PNG wordmark (with the butterfly forming the "O"
 * in YouBelong) and adds a small "COMMUNITY" descriptor strap underneath.
 *
 * Three visual variants — all use the SAME wordmark artwork (so the
 * butterfly + linked-people in the "O" are always present), just swapped
 * for ink colour:
 *   - "light"  → for light/photo backgrounds (white wordmark + teal tagline)
 *   - "dark"   → for dark backgrounds (white wordmark + mint tagline)
 *   - "navy"   → REVERSED colours: navy-ink wordmark on transparent bg, so
 *                the lockup reads cleanly on a plain white surface (the
 *                white-haloed variants disappear into a white page).
 *
 * The `width` prop drives the size of the wordmark image; the tagline
 * scales proportionally so the lockup keeps its rhythm at any size from
 * compact in-app through hero on the welcome screen / splash.
 */
export type BrandLockupVariant = "light" | "dark" | "navy";

// Official YouBelong brand marks. Both versions of the same lockup —
// "bold" is the white wordmark with baked navy halo (for dark/photo bg),
// "navy" is the navy-ink wordmark (for white bg). Aspect ratios differ
// because the navy variant was cropped from the master file and has
// slightly different padding around the butterfly/people graphic.
const BRAND_LOGO_LIGHT = require("../../assets/brand/youbelong-logo-bold.png");
const BRAND_LOGO_NAVY = require("../../assets/brand/youbelong-logo-navy.png");
const LOGO_ASPECT_LIGHT = 1066 / 326;
const LOGO_ASPECT_NAVY = 993 / 330;

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
  const isNavy = variant === "navy";
  const source = isNavy ? BRAND_LOGO_NAVY : BRAND_LOGO_LIGHT;
  const aspect = isNavy ? LOGO_ASPECT_NAVY : LOGO_ASPECT_LIGHT;
  const imgH = Math.round(width / aspect);

  // Tagline reads as a wide descriptor — letter-spaced "C O M M U N I T Y"
  // sized so it visually mirrors the breadth of the wordmark above it.
  // Calibrated to match the welcome screen rhythm: the tagline must span
  // roughly the same horizontal width as the wordmark itself.
  const taglineFs = Math.max(11, Math.round(width * 0.06));
  // Letter spacing tuned so 9 letters * (fs + spacing) ≈ image width. This
  // matches the very-airy "C O M M U N I T Y" treatment on the welcome
  // screen rather than a tight monospaced look.
  const taglineLetterSpacing = Math.max(taglineFs * 0.55, (width - taglineFs * 9) / 9);
  // Navy wordmark pairs with the same brand teal as the light variant;
  // dark backgrounds get the mint tag so it stays readable.
  const taglineColor = variant === "dark" ? "#A7F3D0" : "#1B7A8A";

  return (
    <View style={styles.wrap} testID={testID || "brand-lockup"}>
      <Image
        source={source}
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
