import React from "react";
import { View, Text, StyleSheet } from "react-native";
import ButterflyLogo from "./ButterflyLogo";

/**
 * BrandLockup — the official "YouBelong COMMUNITY" lockup, rendered natively
 * (no image asset) so it stays crisp on every screen density and is easy to
 * tweak in the future.
 *
 * Layout (top → bottom):
 *   [ small butterfly perched above-right of the wordmark ]
 *   YouBelong            ← bold teal wordmark
 *   C O M M U N I T Y    ← letter-spaced teal descriptor underline
 *
 * Two visual variants:
 *   - "light"  → for light backgrounds (default — uses brand teal #1B7A8A)
 *   - "dark"   → for dark backgrounds (white text, mint butterfly accent)
 *
 * The `size` prop is the WORDMARK font size in points — everything else
 * (butterfly, tagline, spacing) scales proportionally so the lockup keeps
 * its recognisable rhythm at any size from 28pt (compact in-app) through
 * 80pt (hero on the welcome screen / splash).
 */
export type BrandLockupVariant = "light" | "dark";

export default function BrandLockup({
  size = 64,
  variant = "light",
  showButterfly = true,
  testID,
}: {
  size?: number;             // wordmark font size in points
  variant?: BrandLockupVariant;
  showButterfly?: boolean;
  testID?: string;
}) {
  const wordmarkFs = size;
  const taglineFs  = Math.max(9, size * 0.27);
  const butterflyW = size * 0.95;
  const wordmarkColor = variant === "dark" ? "#FFFFFF" : "#1B7A8A"; // brand teal
  const taglineColor  = variant === "dark" ? "#A7F3D0" : "#1B7A8A";
  // "C O M M U N I T Y" letter spacing — wide enough to read as a descriptor
  // strap without becoming sparse. Tracking ~0.5em is the brand norm.
  const taglineLetterSpacing = taglineFs * 0.48;

  return (
    <View style={styles.wrap} testID={testID || "brand-lockup"}>
      {/* Butterfly + wordmark row — butterfly perches above-right of the "g".
          We use marginBottom: negative so the butterfly visually overlaps the
          top of the wordmark, matching the brand sheet composition. */}
      {showButterfly ? (
        <View
          style={{
            alignSelf: "flex-end",
            marginRight: size * 0.18,
            marginBottom: -size * 0.22,
            zIndex: 2,
          }}
        >
          <ButterflyLogo size={butterflyW} />
        </View>
      ) : null}

      <Text
        allowFontScaling={false}
        style={[
          styles.wordmark,
          {
            fontSize: wordmarkFs,
            color: wordmarkColor,
            lineHeight: wordmarkFs * 1.02,
          },
        ]}
      >
        YouBelong
      </Text>

      <Text
        allowFontScaling={false}
        style={[
          styles.tagline,
          {
            fontSize: taglineFs,
            color: taglineColor,
            letterSpacing: taglineLetterSpacing,
            marginTop: size * 0.06,
            // Compensate for the right-side bias the letter-spacing adds
            // (RN renders trailing spacing as real width) so the tagline
            // optically centers under the wordmark.
            paddingLeft: taglineLetterSpacing,
          },
        ]}
      >
        COMMUNITY
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  tagline: {
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
});
