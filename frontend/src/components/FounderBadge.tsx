/**
 * FounderBadge — shows the 🦋 Founding Member crest beside a user's name.
 *
 * Renders nothing for non-founders, so callers can drop it unconditionally:
 *   <FounderBadge user={user} />
 *
 * Two visual modes:
 *   • "chip"  — bigger pill with full label "🦋 Founding Member #42".
 *               Use on profile hero, account screen, and the public profile.
 *   • "tag"   — compact inline tag "🦋 Founder" to sit beside a name in
 *               feed cards (Notice Board, DMs, friend chips) without crowding.
 *
 * Why a badge at all?
 *   The Founding Member cohort is capped (default 250). The badge is the
 *   visible thank-you that turns "I was early" into something you can show
 *   off in the community — a clean recruiting signal too: when someone sees
 *   it on a Notice author, they instantly understand the app has a real
 *   pre-launch community behind it.
 */
import React from "react";
import { Text, View, StyleProp, ViewStyle, TextStyle } from "react-native";
import { useTheme } from "@/src/lib/theme";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

type Variant = "chip" | "tag";

type Props = {
  user?: { is_founder?: boolean; founder_number?: number | null } | null;
  variant?: Variant;
  /** Show the cohort number ("#42") even on the tag variant. Default true
   * for chip, false for tag (numbers crowd the inline tag). */
  showNumber?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function FounderBadge({
  user,
  variant = "tag",
  showNumber,
  style,
  textStyle,
}: Props) {
  const { c, scale } = useTheme();

  if (!user || !user.is_founder) {
    return null;
  }

  const includeNumber = showNumber ?? (variant === "chip");
  const numberSuffix =
    includeNumber && user.founder_number ? ` #${user.founder_number}` : "";
  const label =
    variant === "chip"
      ? `Founding Member${numberSuffix}`
      : `Founder${numberSuffix}`;

  // Brand-aligned palette: warm gold border (the crest) + brand-tertiary
  // tinted bg so the badge feels celebratory without yelling on a feed.
  const isChip = variant === "chip";
  const markSize = (isChip ? 14 : 12) * scale;
  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: isChip ? 12 : 8,
          paddingVertical: isChip ? 6 : 3,
          borderRadius: 999,
          backgroundColor: c.brandTertiary,
          borderWidth: 1,
          borderColor: "#D4A017",
        },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Founding member${user.founder_number ? ` number ${user.founder_number}` : ""}`}
    >
      <GeorgeButterflyMark size={markSize} />
      <Text
        style={[
          {
            color: c.brand,
            fontWeight: "900",
            fontSize: (isChip ? 13 : 11) * scale,
            letterSpacing: 0.2,
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}
