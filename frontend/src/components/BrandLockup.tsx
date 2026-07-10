import React from "react";
import { View, Text, StyleSheet } from "react-native";

/**
 * BrandLockup — the FriendPlace wordmark.
 *
 * Rendered as pure React Native text (no image asset) so the wordmark
 * always displays the current brand name even before the final PNG logo
 * lands. Two-tone split: navy "Friend" + teal "Place" matches the sample
 * lockup you shared. Tagline "FIND YOUR PEOPLE" sits underneath.
 *
 * Once the final vector logo PNG is uploaded, this component can switch
 * back to an image-based render — the API (variant + width + testID +
 * showTagline) stays identical so no calling code needs to change.
 *
 * Variants:
 *   - "light"  → white text (for dark / photo backgrounds)
 *   - "dark"   → white text with mint tagline (for dark backgrounds)
 *   - "navy"   → navy + teal split with slate tagline (for white bg)
 */
export type BrandLockupVariant = "light" | "dark" | "navy";

const NAVY_INK = "#17326B";
const TEAL_INK = "#0F766E";
const TAGLINE_INK = "#708EAA";

export default function BrandLockup({
  width = 320,
  variant = "light",
  showTagline = true,
  testID,
}: {
  width?: number;
  variant?: BrandLockupVariant;
  showTagline?: boolean;
  testID?: string;
}) {
  // Font size derived from the requested width — keeps the wordmark
  // rhythm consistent across a huge range (splash 400 → header 120).
  const fontSize = Math.round(width * 0.19);
  const tagSize = Math.max(11, Math.round(width * 0.055));
  const gap = Math.max(4, Math.round(width * 0.02));

  const friendColor = variant === "navy" ? NAVY_INK : "#FFFFFF";
  const placeColor = variant === "navy" ? TEAL_INK : "#5EEAD4"; // mint on dark
  const tagColor = variant === "navy" ? TAGLINE_INK : variant === "dark" ? "#5EEAD4" : "#E2E8F0";

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={[styles.word, { color: friendColor, fontSize }]}>Friend</Text>
        <Text style={[styles.word, { color: placeColor, fontSize }]}>Place</Text>
      </View>
      {showTagline && (
        <Text style={[styles.tagline, { color: tagColor, fontSize: tagSize, marginTop: gap }]}>
          FIND YOUR PEOPLE
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  word: {
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  tagline: {
    fontWeight: "800",
    letterSpacing: 4,
  },
});
