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
 * The lockup is treated as a single responsive unit. It:
 *  - Constrains its own width so the wordmark can never overflow the
 *    parent container (prevented iPhone-mini clipping bug).
 *  - Auto-shrinks the wordmark font if the container is narrower than
 *    the natural text width would need (belt-and-braces on top of the
 *    calculated ratio, so old iPhones don't cut off the "F" in
 *    "FriendPlace" on the left edge).
 *  - Optionally scales the butterfly icon proportional to available
 *    HEIGHT as well as width — the welcome screen passes the actual
 *    hero size to keep the mark from dominating short devices.
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
  butterflySize,
  testID,
}: {
  width?: number;
  variant?: BrandLockupVariant;
  showTagline?: boolean;
  showButterfly?: boolean;
  /** Optional explicit butterfly size (px). If omitted we scale
   *  proportionally to `width`. Callers that also want to bound the
   *  butterfly by the available HEIGHT (e.g. the welcome hero on iPhone
   *  SE) can pass their own computed size. */
  butterflySize?: number;
  testID?: string;
}) {
  // Font ratio picked so that "FriendPlace" (11 letters, ~0.55 aspect at
  // 900 weight) FITS the requested width with a tiny margin. 0.155 gives
  // us ~93% coverage of `width` which leaves a couple of pixels of
  // breathing room on either side even at extreme weights/kerning.
  const fontSize = Math.round(width * 0.155);
  const tagSize = Math.max(11, Math.round(width * 0.05));
  const gap = Math.max(4, Math.round(width * 0.02));

  // Butterfly icon sizing — proportional to width by default. Callers
  // (welcome screen) can override with `butterflySize` when they also
  // want to cap against screen height.
  const bfy = butterflySize ?? Math.max(64, Math.min(210, Math.round(width * 0.42)));

  const friendColor = variant === "navy" ? NAVY_INK : "#FFFFFF";
  const placeColor = variant === "navy" ? TEAL_INK : "#5EEAD4"; // mint on dark
  const tagColor = variant === "navy" ? TAGLINE_INK : variant === "dark" ? "#5EEAD4" : "#E2E8F0";

  return (
    // Fixed width on the outer wrap so children (especially the wordmark
    // Text row) can never render wider than the requested lockup width.
    // Combined with numberOfLines={1} + adjustsFontSizeToFit below this
    // guarantees no left/right clipping on any device.
    <View style={[styles.wrap, { width, maxWidth: "100%" }]} testID={testID}>
      {showButterfly && (
        <Image
          source={BUTTERFLY_LOGO}
          style={{
            width: bfy,
            height: bfy,
            marginBottom: Math.max(6, Math.round(width * 0.03)),
            // Soft rounded mask — the artwork is already a rounded square
            // but the extra clip guarantees clean edges on all densities.
            borderRadius: Math.round(bfy * 0.22),
          }}
          resizeMode="contain"
          accessibilityLabel="FriendPlace butterfly logo"
        />
      )}
      {/* Wordmark row — width-clamped so nothing can push it wider than
          the lockup container. `numberOfLines` + `adjustsFontSizeToFit`
          are the second safety net that shrinks the type on ultra-narrow
          devices instead of clipping. Both Text elements share the same
          font size so the split colour "Friend | Place" stays balanced. */}
      <View style={[styles.wordRow, { maxWidth: width }]}>
        <Text
          style={[styles.word, { color: friendColor, fontSize }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          Friend
        </Text>
        <Text
          style={[styles.word, { color: placeColor, fontSize }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          Place
        </Text>
      </View>
      {showTagline && (
        <Text
          style={[styles.tagline, { color: tagColor, fontSize: tagSize, marginTop: gap }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          FIND YOUR PEOPLE
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    // Centred within the parent so any responsive scaling stays visually
    // balanced regardless of surrounding padding.
    alignSelf: "center",
  },
  wordRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  word: {
    fontWeight: "900",
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  tagline: {
    fontWeight: "800",
    letterSpacing: 4,
  },
});
