import React from "react";
import { View, StyleSheet, Platform, Image } from "react-native";
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, G } from "react-native-svg";
import type { SeasonTheme } from "@/src/lib/seasons";

/**
 * ButterflyCardBack — the branded FriendPlace card back for Klondike.
 *
 * Layered composition:
 *   1. Navy → teal → navy SVG gradient background (matches app brand)
 *   2. Seasonal accent stripe crossing behind the butterfly — subtle
 *      ribbon that shifts with the theme (Winter cool blue, Christmas
 *      red, etc.) without touching the brand mark itself.
 *   3. The new FriendPlace butterfly logo (two people forming the body)
 *      as a PNG overlay — same artwork as the app icon so the deck
 *      feels unmistakably FriendPlace.
 *   4. Small seasonal accent dots in each corner for visual polish.
 *
 * Scales cleanly from a 44px tableau card up to the 78×112 hub preview.
 *
 * Usage:
 *   <ButterflyCardBack width={44} height={62} season={season} />
 */
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon.png");

export function ButterflyCardBack({
  width,
  height,
  season,
  showCorners = true,
}: {
  width: number;
  height: number;
  season?: SeasonTheme;
  /** Small accent corner dots — hidden for very tiny previews. */
  showCorners?: boolean;
}) {
  // Radius scales with size so the small in-play card looks proportional
  // and the big hub preview reads as a solid, chunky card.
  const r = Math.max(4, Math.round(Math.min(width, height) * 0.09));
  // Brand gradient — teal → navy. Kept constant across seasons.
  const TEAL = "#0F766E";
  const NAVY = "#1E3A7F";
  const NAVY_DEEP = "#0B2E4F";
  // Seasonal accent stripe — falls back to a warm champagne if no season.
  const accent = season?.accent || "#FBBF24";
  const accentSoft = season?.cardBackSecondary || "#93C5FD";

  // Butterfly logo size — sits centred, occupying ~62% of the card width
  // so the seasonal accent stripe still shows on either side.
  const logoSize = Math.round(width * 0.62);

  return (
    <View style={[styles.wrap, { width, height, borderRadius: r }]}>
      <Svg width={width} height={height} viewBox="0 0 100 140" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={NAVY} stopOpacity={1} />
            <Stop offset="0.55" stopColor={TEAL} stopOpacity={1} />
            <Stop offset="1" stopColor={NAVY_DEEP} stopOpacity={1} />
          </SvgGradient>
        </Defs>

        {/* Solid background rounded rectangle */}
        <Path
          d={roundedRectPath(0, 0, 100, 140, 9)}
          fill="url(#bgGrad)"
        />

        {/* Seasonal accent stripe crossing behind the butterfly. Two
            translucent bands give a subtle "ribbon" effect that changes
            with the theme without competing with the brand mark. */}
        <G opacity={0.55}>
          <Path d="M -20 96 L 120 68 L 120 78 L -20 106 Z" fill={accentSoft} />
          <Path d="M -20 78 L 120 50 L 120 56 L -20 84 Z" fill={accent} opacity={0.55} />
        </G>

        {/* Corner accent dots — only when the card is big enough. */}
        {showCorners && width >= 50 && (
          <>
            <Circle cx="12" cy="12" r="3" fill={accent} opacity={0.55} />
            <Circle cx="88" cy="12" r="3" fill={accent} opacity={0.55} />
            <Circle cx="12" cy="128" r="3" fill={accent} opacity={0.55} />
            <Circle cx="88" cy="128" r="3" fill={accent} opacity={0.55} />
          </>
        )}
      </Svg>

      {/* Butterfly brand mark — the definitive FriendPlace logo (two
          people forming the butterfly body). Sized ~62% of the card so
          the ribbon accent still shows through on either side. */}
      <View pointerEvents="none" style={styles.logoWrap}>
        <Image
          source={BUTTERFLY_LOGO}
          style={{ width: logoSize, height: logoSize, borderRadius: Math.round(logoSize * 0.22) }}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

/** SVG path helper — rounded rectangle. */
function roundedRectPath(x: number, y: number, w: number, h: number, rr: number) {
  return `M ${x + rr} ${y}
    L ${x + w - rr} ${y}
    Q ${x + w} ${y} ${x + w} ${y + rr}
    L ${x + w} ${y + h - rr}
    Q ${x + w} ${y + h} ${x + w - rr} ${y + h}
    L ${x + rr} ${y + h}
    Q ${x} ${y + h} ${x} ${y + h - rr}
    L ${x} ${y + rr}
    Q ${x} ${y} ${x + rr} ${y} Z`;
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: { boxShadow: "0 1px 3px rgba(0,0,0,0.25)" },
      default: {},
    }),
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
