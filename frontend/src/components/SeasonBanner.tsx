/**
 * SeasonBanner — a small horizontal card that shows the current
 * season with its label, tagline and a small row of themed emoji.
 * Used across all game hubs (Bingo, Crossword, Sudoku, Solitaire,
 * etc.) so the game area gains a subtle sense of "time of year"
 * without any per-game code duplication.
 *
 * Renders nothing (falls back to null) when the caller passes an
 * empty season object, so it's safe to drop into a hub even before
 * we've confirmed the seasons engine is wired up.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { SeasonTheme } from "@/src/lib/seasons";

type Props = {
  season: SeasonTheme;
  /** Optional short prefix such as the game name — "Sudoku". */
  prefix?: string;
  c: {
    surfaceSecondary: string;
    border: string;
    onSurface: string;
    muted: string;
    brand: string;
  };
  scale: number;
};

export default function SeasonBanner({ season, prefix, c, scale }: Props) {
  if (!season?.label) return null;
  const emojis = (season.emojis || []).slice(0, 3).join(" ");
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: c.surfaceSecondary,
          // Accent stripe on the leading edge so the banner clearly
          // reads as a seasonal decoration rather than another card.
          borderLeftColor: season.accent || c.brand,
          borderColor: c.border,
        },
      ]}
      accessibilityLabel={`Currently ${season.label}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.muted, fontSize: 12 * scale, letterSpacing: 0.4, fontWeight: "700" }}>
          {(prefix ? `${prefix.toUpperCase()} · ` : "") + "SEASON"}
        </Text>
        <Text
          style={{
            color: c.onSurface,
            fontWeight: "900",
            fontSize: 16 * scale,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {season.label}
        </Text>
        {season.tagline ? (
          <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }} numberOfLines={2}>
            {season.tagline}
          </Text>
        ) : null}
      </View>
      {emojis ? (
        <Text style={styles.emojiRow} accessibilityElementsHidden>
          {emojis}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  emojiRow: {
    fontSize: 22,
    letterSpacing: 3,
  },
});
