/**
 * FounderMark — the small 🦋 butterfly that sits next to a Founding
 * Member's name everywhere in the app.
 *
 * Why a butterfly?
 *   Stars feel like a leaderboard / competition. The butterfly is the
 *   YouBelong brand mark — it says "this person was part of the founding
 *   cohort" without ranking them.
 *
 * Behaviour:
 *   • Renders nothing for non-founders (safe to drop in everywhere).
 *   • Tap → small modal explaining what a Founding Member is, plus the
 *     person's founder_number when known. The modal is intentionally
 *     friendly + descriptive rather than gamified.
 *
 * Inputs:
 *   FounderMark accepts EITHER a user-shaped object with `is_founder` and
 *   optional `founder_number`, OR explicit `isFounder` + `founderNumber`
 *   props (handy for documents like notices / group posts where the
 *   author's founder bits travel as flat fields, not a nested user).
 */
import React, { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/src/lib/theme";

type Props = {
  user?: { is_founder?: boolean; founder_number?: number | null } | null;
  isFounder?: boolean;
  founderNumber?: number | null;
  /** Size of the butterfly glyph (default 14). */
  size?: number;
  /** Test id for automated testing. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export default function FounderMark({
  user,
  isFounder,
  founderNumber,
  size = 14,
  testID,
  style,
}: Props) {
  const { c, scale } = useTheme();
  const [open, setOpen] = useState(false);

  const founder = isFounder ?? user?.is_founder ?? false;
  const number = founderNumber ?? user?.founder_number ?? null;

  if (!founder) return null;

  return (
    <>
      <Pressable
        testID={testID || "founder-mark"}
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          number ? `Founding Member number ${number} — tap for details` : "Founding Member — tap for details"
        }
        style={[styles.touchable, style]}
      >
        <Text style={{ fontSize: size }} accessibilityElementsHidden>
          🦋
        </Text>
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable
          testID="founder-mark-backdrop"
          onPress={() => setOpen(false)}
          style={styles.backdrop}
        >
          <Pressable
            // Stop propagation so taps inside the sheet don't dismiss it.
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[styles.sheet, { backgroundColor: c.surface }]}
          >
            <Text style={{ fontSize: 48 }}>🦋</Text>
            <Text style={[styles.title, { color: c.onSurface, fontSize: 22 * scale }]}>
              {number ? `Founding Member #${number}` : "Founding Member"}
            </Text>
            <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
              One of the first 500 members who helped build the YouBelong community.
            </Text>
            <Pressable
              testID="founder-mark-close"
              onPress={() => setOpen(false)}
              style={[styles.btn, { backgroundColor: c.brand }]}
            >
              <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 17 * scale }}>
                Got it
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  touchable: {
    paddingHorizontal: 2,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  title: { fontWeight: "900", textAlign: "center", marginTop: 4 },
  body: { textAlign: "center", lineHeight: 22 },
  btn: {
    marginTop: 8,
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 999,
    minHeight: 48,
  },
});
