/**
 * GameWinModal — shared celebratory modal shown after any game is won
 * or completed. Standardises the "🎉 Great job!" experience across
 * Solitaire, Sudoku, Word Search, Bingo, Trivia and Crossword so every
 * game ends with the same warm, encouraging beat.
 *
 * Design goals:
 *   - **One consistent visual pattern**: emoji hero → headline →
 *     summary line → optional points pill → 2-3 action buttons.
 *   - **Encouraging tone**: every button reads as an *invitation*
 *     ("Play another", "Try a harder puzzle"), not a dismissal.
 *   - **Fully customisable copy** via props so each game keeps its
 *     own voice ("You solved!", "BINGO!", "You beat the deck").
 *   - **Optional seasonal accent** — passes through a `SeasonTheme`
 *     so the modal picks up today's colours/emoji when supplied.
 *   - **Extensible actions** via an `actions` array — each entry is
 *     a button with icon, label, style variant, and onPress. Prevents
 *     a growing prop surface as we add game-specific buttons.
 */
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SeasonTheme } from "@/src/lib/seasons";

export type WinAction = {
  testID?: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /**
   * "primary" — filled brand background (the main call to action).
   * "secondary" — outlined, uses brand colour for text/border.
   * "ghost" — text-only, no background/border.
   */
  variant?: "primary" | "secondary" | "ghost";
};

type Props = {
  visible: boolean;
  onRequestClose: () => void;
  /** Small emoji shown at the top (defaults to 🎉). */
  emoji?: string;
  /** Bold headline — e.g. "Great job!", "BINGO!", "You beat the deck!". */
  title: string;
  /** Short subline — e.g. "You solved 'Aussie Ports' in 2:14". */
  subtitle?: string;
  /** Points earned this round. Renders as a pill under the subtitle. */
  points?: number;
  /** Action buttons — rendered top-to-bottom in order provided. */
  actions: WinAction[];
  /** Optional seasonal accents (border/emoji sprinkle). */
  season?: SeasonTheme;
  /** Theme colours passed from the parent screen (surface/brand etc). */
  c: {
    surface: string;
    onSurface: string;
    brand: string;
    brandTertiary: string;
    surfaceSecondary: string;
    border: string;
    muted: string;
  };
  /** Accessibility scale factor (matches `useTheme().scale`). */
  scale: number;
};

export default function GameWinModal({
  visible,
  onRequestClose,
  emoji = "🎉",
  title,
  subtitle,
  points,
  actions,
  season,
  c,
  scale,
}: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.bg}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: c.surface,
              // Use the seasonal accent as the border when we have
              // one — turns the celebration into a small nod to the
              // current season. Falls back to the app brand colour.
              borderColor: season?.accent || c.brand,
            },
          ]}
        >
          {/* Seasonal sprinkle above the hero emoji — a tiny row of
              seasonal decorations that only appears when we have a
              season handy. Keeps the vibe subtle. */}
          {season?.emojis && season.emojis.length > 0 ? (
            <Text style={styles.seasonRow}>{season.emojis.slice(0, 4).join("  ")}</Text>
          ) : null}
          <Text style={styles.emoji}>{emoji}</Text>
          <Text
            style={[
              styles.title,
              { color: c.onSurface, fontSize: 26 * scale },
            ]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                { color: c.brand, fontSize: 15 * scale },
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
          {typeof points === "number" && points > 0 ? (
            <View style={[styles.pointsPill, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 16 * scale }}>
                +{points} points 🦋
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            {actions.map((a, idx) => {
              const variant = a.variant || (idx === 0 ? "primary" : "secondary");
              const isPrimary = variant === "primary";
              const isGhost = variant === "ghost";
              const bg = isPrimary ? c.brand : isGhost ? "transparent" : c.surfaceSecondary;
              const border = isPrimary
                ? c.brand
                : isGhost
                ? "transparent"
                : c.brand;
              const fg = isPrimary ? "#FFFFFF" : isGhost ? c.muted : c.brand;
              return (
                <Pressable
                  key={a.label + idx}
                  testID={a.testID}
                  onPress={a.onPress}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      backgroundColor: bg,
                      borderColor: border,
                      borderWidth: isGhost ? 0 : isPrimary ? 0 : 1.5,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {a.icon ? (
                    <Ionicons name={a.icon} size={18} color={fg} />
                  ) : null}
                  <Text
                    style={{
                      color: fg,
                      fontWeight: isGhost ? "700" : "900",
                      fontSize: (isGhost ? 14 : 15) * scale,
                    }}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 2,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: "center",
  },
  seasonRow: {
    fontSize: 20,
    marginBottom: 6,
    letterSpacing: 4,
  },
  emoji: {
    fontSize: 56,
    textAlign: "center",
  },
  title: {
    fontWeight: "900",
    textAlign: "center",
    marginTop: 4,
  },
  subtitle: {
    fontWeight: "800",
    textAlign: "center",
    marginTop: 4,
  },
  pointsPill: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  actions: {
    width: "100%",
    gap: 10,
    marginTop: 20,
  },
  actionBtn: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  },
});
