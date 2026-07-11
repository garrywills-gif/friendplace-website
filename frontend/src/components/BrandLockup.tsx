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
 * Fully responsive — the whole lockup scales as a single unit and can
 * never overflow the parent container. Two techniques together prevent
 * left/right clipping on any device:
 *
 *   1. Fixed `width` + `overflow: hidden` on the outer wrap so React
 *      Native's Text layout has a bounded viewport to shrink into.
 *   2. Wordmark rendered as ONE `<Text adjustsFontSizeToFit numberOfLines={1}>`
 *      with nested `<Text>` spans for the two-tone colour split. Nesting
 *      is the only way iOS's font-shrinking can measure the FULL wordmark
 *      and reduce the size proportionally — sibling Texts in a row can
 *      only clip, they never shrink.
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
  /** Optional explicit butterfly size (px). Callers that also want to
   *  bound the butterfly by available HEIGHT (e.g. welcome hero on
   *  iPhone SE) can pass their own computed size. */
  butterflySize?: number;
  testID?: string;
}) {
  // Font size derived from the requested width. Ratio 0.14 was chosen so
  // that "FriendPlace" (11 chars, ~0.55 aspect at 900 weight) plus the
  // letter spacing overhead comfortably fits within `width` on real
  // devices. `adjustsFontSizeToFit` is the safety net that trims further
  // on very narrow phones (iPhone mini) or when accessibility text
  // scaling is on.
  const fontSize = Math.round(width * 0.14);
  const tagSize = Math.max(11, Math.round(width * 0.05));
  const gap = Math.max(4, Math.round(width * 0.02));

  // Butterfly icon sizing — proportional to width by default. Callers
  // (welcome screen) can override with `butterflySize` to also cap
  // against available screen height.
  const bfy = butterflySize ?? Math.max(64, Math.min(200, Math.round(width * 0.38)));

  const friendColor = variant === "navy" ? NAVY_INK : "#FFFFFF";
  const placeColor = variant === "navy" ? TEAL_INK : "#5EEAD4"; // mint on dark
  const tagColor = variant === "navy" ? TAGLINE_INK : variant === "dark" ? "#5EEAD4" : "#E2E8F0";

  return (
    // `width` + `overflow: hidden` = a hard visual cage the wordmark can
    // never escape. `alignSelf: center` keeps it visually balanced when
    // the parent doesn't set alignment.
    <View
      style={[styles.wrap, { width, maxWidth: "100%" }]}
      testID={testID}
    >
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
      {/* Wordmark — SINGLE Text with two nested colour spans so iOS can
          shrink the whole word if it's too wide. `numberOfLines={1}` is
          required for adjustsFontSizeToFit to activate on iOS. */}
      <Text
        style={[styles.word, { fontSize, color: friendColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        accessibilityRole="header"
        accessibilityLabel="FriendPlace"
      >
        Friend<Text style={{ color: placeColor }}>Place</Text>
      </Text>
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
    alignSelf: "center",
    // Any accidental child overflow (e.g. shadow bleed) is clipped here
    // so the brand mark never bleeds off the phone edges.
    overflow: "hidden",
  },
  word: {
    fontWeight: "900",
    letterSpacing: -0.5,
    textAlign: "center",
    includeFontPadding: false,
  },
  tagline: {
    fontWeight: "800",
    letterSpacing: 4,
    textAlign: "center",
  },
});
