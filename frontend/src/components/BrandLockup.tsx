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
// Brighter, cleaner teal for the "Place" span on light backgrounds.
// The previous #0F766E (Tailwind teal-700) is technically teal but sits
// close enough to forest-green in hue that older eyes read it as
// "green" — especially when placed next to the deep navy "Friend" span.
// #14B8A6 (Tailwind teal-500) is unambiguously teal to virtually every
// user, still passes AA contrast on white, and stays visually harmonious
// with the mint (#5EEAD4) we use on the welcome/dark hero.
const TEAL_INK = "#14B8A6";
const TAGLINE_INK = "#708EAA";

// The definitive teal butterfly logo — the primary FriendPlace brand mark.
// Rendered as a rounded-square icon (the artwork ships with its own subtle
// teal→blue gradient tile so it reads on both dark and light backgrounds).
// NOTE: filename versioned (`-v5.png`) to guarantee Metro's asset
// hasher generates a fresh identifier when we tweak the icon. v5
// FIXES a bilateral asymmetry that was baked into the original
// artwork — the left top wing had a flat outer edge. v5 mirrors
// the good right half over the vertical centre-line so both wings
// have matching graceful curves. Padding: ~25% L/R, ~22% top, ~28% bottom.
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v5.png");

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
  // Tagline size — bumped so the "FIND YOUR PEOPLE" strap doesn't get
  // lost under the wordmark, especially at the smaller lockup widths
  // used on the Home header (~140px). Older-audience readability.
  const tagSize = Math.max(11, Math.round(width * 0.075));
  const gap = Math.max(4, Math.round(width * 0.02));
  // Letter-spacing scales with width — at very narrow lockups (≤160px)
  // the previous fixed 4px spacing pushed "FIND YOUR PEOPLE" past the
  // container even after `adjustsFontSizeToFit`, causing the trailing
  // "LE" to be truncated to "FIND YOUR PEOP…" on the Home header.
  // Below 220px we ramp the spacing down proportionally so the strap
  // always fits without losing its airy uppercase feel at larger sizes.
  const tagLetterSpacing = width >= 220 ? 4 : Math.max(1, Math.round((width - 120) / 40));

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
          style={[styles.tagline, { color: tagColor, fontSize: tagSize, letterSpacing: tagLetterSpacing, marginTop: gap }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          // Clip instead of adding "…" — if we ever run out of room the
          // trailing edge just gets trimmed silently rather than
          // showing the reader a broken word.
          ellipsizeMode="clip"
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
    // NOTE: letterSpacing is applied dynamically via inline style
    // (see the render) so narrow lockups can shrink it and avoid the
    // "FIND YOUR PEOP…" truncation on small screens.
    textAlign: "center",
  },
});
