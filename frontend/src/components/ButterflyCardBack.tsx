import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, G } from "react-native-svg";
import type { SeasonTheme } from "@/src/lib/seasons";

/**
 * ButterflyCardBack — the branded FriendPlace card back for Klondike.
 *
 * Design brief (June 2026):
 *   • Recognisable FriendPlace butterfly silhouette (matches the app icon).
 *   • Teal + navy-blue gradient body — the two brand hues.
 *   • Seasonal accent stripe so the back subtly shifts with the theme
 *     (Winter → cool blue, Christmas → red, Summer → gold, etc.) while
 *     the wings always stay teal/navy so members instantly recognise the
 *     card back as "the FriendPlace deck".
 *   • Fully vector — no image assets, scales cleanly from a 44px card in
 *     the tableau up to the 78×112 preview on the hub.
 *   • Zero dependencies beyond `react-native-svg` (already installed).
 *
 * Usage:
 *   <ButterflyCardBack width={44} height={62} season={season} />
 */
export function ButterflyCardBack({
  width,
  height,
  season,
  showCorners = true,
}: {
  width: number;
  height: number;
  season?: SeasonTheme;
  /** Small "🦋" corner marks — hidden for very tiny previews. */
  showCorners?: boolean;
}) {
  // Radius scales with size so the small in-play card looks proportional
  // and the big hub preview reads as a solid, chunky card.
  const r = Math.max(4, Math.round(Math.min(width, height) * 0.09));
  // Brand gradient — teal → navy. Kept constant across seasons.
  const TEAL_LIGHT = "#14B8A6";
  const TEAL = "#0F766E";
  const NAVY = "#1E3A7F";
  const NAVY_DEEP = "#0B2E4F";
  // Seasonal accent stripe — falls back to a warm champagne if no season.
  const accent = season?.accent || "#FBBF24";
  const accentSoft = season?.cardBackSecondary || "#93C5FD";

  return (
    <View style={[styles.wrap, { width, height, borderRadius: r }]}>
      <Svg width={width} height={height} viewBox="0 0 100 140">
        <Defs>
          <SvgGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={NAVY} stopOpacity={1} />
            <Stop offset="0.55" stopColor={TEAL} stopOpacity={1} />
            <Stop offset="1" stopColor={NAVY_DEEP} stopOpacity={1} />
          </SvgGradient>
          <SvgGradient id="wingGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={TEAL_LIGHT} stopOpacity={0.95} />
            <Stop offset="1" stopColor={NAVY} stopOpacity={1} />
          </SvgGradient>
        </Defs>

        {/* Solid background rounded rectangle */}
        <Path
          d={roundedRectPath(0, 0, 100, 140, 9)}
          fill="url(#bgGrad)"
        />

        {/* Seasonal accent stripe crossing behind the butterfly. Two
            translucent bands give a subtle "ribbon" effect that changes
            with the theme without competing with the brand marks. */}
        <G opacity={0.55}>
          <Path d="M -20 96 L 120 68 L 120 78 L -20 106 Z" fill={accentSoft} />
          <Path d="M -20 78 L 120 50 L 120 56 L -20 84 Z" fill={accent} opacity={0.55} />
        </G>

        {/* Butterfly — pair of wings mirrored around a slim body. Each
            wing is a bezier path with a large upper lobe and a small
            lower lobe, matching the FriendPlace app icon silhouette. */}
        <G transform="translate(50 70)">
          {/* left wings */}
          <Path
            d="
              M 0 -18
              C -8 -34, -34 -38, -40 -22
              C -46 -8, -32 -2, -14 -6
              C -22 4, -32 14, -30 22
              C -26 30, -14 26, -6 18
              C -4 20, -2 20, 0 18
              Z
            "
            fill="url(#wingGrad)"
            stroke="#FFFFFF"
            strokeWidth="0.8"
            strokeOpacity="0.35"
          />
          {/* right wings (mirror) */}
          <Path
            d="
              M 0 -18
              C 8 -34, 34 -38, 40 -22
              C 46 -8, 32 -2, 14 -6
              C 22 4, 32 14, 30 22
              C 26 30, 14 26, 6 18
              C 4 20, 2 20, 0 18
              Z
            "
            fill="url(#wingGrad)"
            stroke="#FFFFFF"
            strokeWidth="0.8"
            strokeOpacity="0.35"
          />
          {/* Wing decorative dots */}
          <Circle cx="-24" cy="-20" r="2.4" fill={accent} opacity={0.85} />
          <Circle cx="24" cy="-20" r="2.4" fill={accent} opacity={0.85} />
          <Circle cx="-18" cy="16" r="1.6" fill="#FFFFFF" opacity={0.7} />
          <Circle cx="18" cy="16" r="1.6" fill="#FFFFFF" opacity={0.7} />
          {/* Body */}
          <Path
            d="M -1.5 -22 L 1.5 -22 L 2.2 22 L -2.2 22 Z"
            fill="#F1F5F9"
          />
          {/* Antennae */}
          <Path
            d="M -1.5 -22 C -6 -30, -10 -34, -14 -34"
            stroke="#F1F5F9"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M 1.5 -22 C 6 -30, 10 -34, 14 -34"
            stroke="#F1F5F9"
            strokeWidth="1.3"
            strokeLinecap="round"
            fill="none"
          />
        </G>

        {/* Brand wordmark strap — hidden on very small cards where it
            would be illegible. Renders "youbelong" in a small pill so
            the brand is present even at glance-distance. */}
        {width >= 60 && (
          <G transform="translate(50 122)">
            <Path
              d={roundedRectPath(-24, -7, 48, 14, 7)}
              fill="#FFFFFF"
              opacity={0.18}
            />
            {/* Simple ASCII wordmark rendered via three tiny circles +
                text approximation — Svg's <Text> would need font loading
                on native so we go glyphless. */}
            <Circle cx="-14" cy="0" r="2" fill="#FFFFFF" opacity={0.8} />
            <Circle cx="-6" cy="0" r="2" fill="#FFFFFF" opacity={0.8} />
            <Circle cx="2" cy="0" r="2" fill="#FFFFFF" opacity={0.8} />
            <Circle cx="10" cy="0" r="2" fill="#FFFFFF" opacity={0.8} />
          </G>
        )}

        {/* Corner butterflies (small) — only when the card is big enough */}
        {showCorners && width >= 50 && (
          <>
            <Circle cx="12" cy="12" r="3" fill={accent} opacity={0.55} />
            <Circle cx="88" cy="12" r="3" fill={accent} opacity={0.55} />
            <Circle cx="12" cy="128" r="3" fill={accent} opacity={0.55} />
            <Circle cx="88" cy="128" r="3" fill={accent} opacity={0.55} />
          </>
        )}
      </Svg>
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
    ...Platform.select({
      web: { boxShadow: "0 1px 3px rgba(0,0,0,0.25)" },
      default: {},
    }),
  },
});
