import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";

/**
 * BrandLockup — the primary FriendPlace brand mark.
 *
 * Layout:
 *   [ Teal butterfly icon (with two linked people forming the body) ]
 *   [       Friend[navy]Place[teal] wordmark                        ]
 *   [       FIND YOUR PEOPLE  (optional tagline)                    ]
 *
 * The butterfly is now the primary FriendPlace logo and appears above
 * the wordmark on every screen (welcome, splash, home header, etc.).
 * The wordmark tone still adapts to the surface — `dark` for the navy
 * welcome/splash gradient, `navy` for the white Home surface.
 *
 * The butterfly image ships as a rounded-square app-icon PNG with a
 * teal→blue gradient backdrop. It sits on any background because the
 * artwork owns its own background — no cutout needed.
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

// The definitive teal butterfly logo — the primary FriendPlace brand mark.
// Rendered as a rounded-square icon (the artwork ships with its own subtle
// teal→blue gradient tile so it reads on both dark and light backgrounds).
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon.png");

export default function BrandLockup({
  width = 320,
  variant = "light",
  showTagline = true,
  showButterfly = true,
  testID,
}: {
  width?: number;
  variant?: BrandLockupVariant;
  showTagline?: boolean;
  showButterfly?: boolean;
  testID?: string;
}) {
  // Font size derived from the requested width — keeps the wordmark
  // rhythm consistent across a huge range (splash 400 → header 120).
  // Slightly reduced ratio so the butterfly reads as the primary brand
  // mark and the wordmark plays a supporting role.
  const fontSize = Math.round(width * 0.17);
  const tagSize = Math.max(11, Math.round(width * 0.055));
  const gap = Math.max(4, Math.round(width * 0.02));

  // Butterfly icon sizing — the butterfly is the heart of the FriendPlace
  // brand and should be the first thing users notice. Sized larger than
  // the wordmark suggests. Aims for ~150–160px on login, ~210px max on
  // wide splash surfaces, and ~65px in the compact home header.
  const butterflySize = Math.max(64, Math.min(210, Math.round(width * 0.46)));

  const friendColor = variant === "navy" ? NAVY_INK : "#FFFFFF";
  const placeColor = variant === "navy" ? TEAL_INK : "#5EEAD4"; // mint on dark
  const tagColor = variant === "navy" ? TAGLINE_INK : variant === "dark" ? "#5EEAD4" : "#E2E8F0";

  return (
    <View style={styles.wrap} testID={testID}>
      {showButterfly && (
        <Image
          source={BUTTERFLY_LOGO}
          style={{
            width: butterflySize,
            height: butterflySize,
            marginBottom: Math.max(6, Math.round(width * 0.03)),
            // Soft rounded mask — the artwork is already a rounded square
            // but the extra clip guarantees clean edges on all densities.
            borderRadius: Math.round(butterflySize * 0.22),
          }}
          resizeMode="contain"
          accessibilityLabel="FriendPlace butterfly logo"
        />
      )}
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
