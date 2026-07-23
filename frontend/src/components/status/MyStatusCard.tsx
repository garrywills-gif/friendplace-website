/**
 * MyStatusCard — the "My Status" card on the Home screen. Shows the
 * signed-in member's current effective status, and lets them toggle
 * the three manual statuses (Looking / Happy / Busy).
 *
 * Layout matches the LOCKED interactive mockup at
 * `/app/frontend/app/preview/status-mockups.tsx`:
 *   • Primary 🦋 "Looking for a chat" button (fills full width, flips
 *     to a "tap to stop" state when active).
 *   • Two half-width pills side-by-side: 😊 Happy to connect ·
 *     🟡 Busy right now.
 *   • Small "✕ Clear" chip appears only when a manual status is set.
 *   • Footer line: "☕ In the FP Café and ⚫ Offline are set
 *     automatically."
 *
 * Design references:
 *   • §5.1 Home screen "My Status" section
 *   • Refinement notes: no explicit "🟢 Online" header line, pills
 *     side-by-side, warmer wording, clear pill positioned on its
 *     own row when relevant.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/src/lib/theme";
import {
  useMyStatus,
  STATUS_META,
  type EffectiveStatus,
} from "@/src/lib/status-context";

type PillProps = {
  label: string;
  icon: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  brand: string;
  brandTint: string;
  surface: string;
  onSurface: string;
  onBrand: string;
  border: string;
  testID?: string;
};

function Pill({
  label,
  icon,
  active,
  disabled,
  onPress,
  brand,
  brandTint,
  surface,
  onSurface,
  onBrand,
  border,
  testID,
}: PillProps) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: active ? brand : pressed ? brandTint : surface,
          borderColor: active ? brand : brand,
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text
        numberOfLines={1}
        style={{
          color: active ? onBrand : onSurface,
          fontWeight: "800",
          fontSize: 14,
          marginLeft: 6,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function MyStatusCard({ testID = "home-my-status" }: { testID?: string }) {
  const { c, scale } = useTheme();
  const { me, busy, setManual } = useMyStatus();

  // Local optimistic derivation — reading directly off `me.manual`
  // keeps the pills in sync with the server's canonical view. If
  // `me` is null (first-load or logged-out) we still render the
  // controls in a neutral "online" state so the card isn't blank.
  const manual = me?.manual ?? null;
  const effective: EffectiveStatus = me?.effective ?? "online";
  const isLooking = manual === "looking";
  const isHappy = manual === "happy";
  const isBusy = manual === "busy";

  // Human-readable "in X minutes / hours" hint for the primary
  // button when Looking is active. Falls back gracefully.
  const timeLeft = React.useMemo(() => {
    if (!isLooking || !me?.manual_expires_at) return null;
    const ms = new Date(me.manual_expires_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} min left`;
    const hrs = Math.round(mins / 60);
    return `${hrs}h left`;
  }, [isLooking, me?.manual_expires_at]);

  // Header line — shows the effective status glyph + label. For plain
  // Online we skip it entirely (design refinement: "no need to
  // announce Online — it's the default").
  const showHeader = effective !== "online";
  const headerMeta = showHeader ? STATUS_META[effective] : null;

  const toggle = (target: "looking" | "happy" | "busy") => {
    if (busy) return;
    setManual(manual === target ? null : target);
  };

  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.cardTitle, { color: c.onSurface, fontSize: 13 * scale }]}>MY STATUS</Text>
        {showHeader && headerMeta ? (
          <View style={[styles.effectiveChip, { backgroundColor: c.brandTertiary }]}>
            <Text style={{ fontSize: 14 }}>{headerMeta.glyph}</Text>
            <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale, marginLeft: 4 }}>
              {headerMeta.label}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Primary 🦋 toggle — full-width, obvious tap target. */}
      <Pressable
        testID="my-status-looking"
        onPress={() => toggle("looking")}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ selected: isLooking, disabled: busy }}
        accessibilityLabel={isLooking ? "Stop looking for a chat" : "Start looking for a chat"}
        style={({ pressed }) => [
          styles.primary,
          {
            backgroundColor: isLooking ? c.brand : pressed ? c.brandTertiary : c.surface,
            borderColor: c.brand,
            opacity: busy ? 0.7 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
        ]}
      >
        <Text style={{ fontSize: 18 }}>🦋</Text>
        <Text
          style={{
            color: isLooking ? "#FFFFFF" : c.onSurface,
            fontWeight: "900",
            fontSize: 15 * scale,
            marginLeft: 8,
          }}
        >
          {isLooking
            ? timeLeft
              ? `✓ Looking for a chat · ${timeLeft}`
              : "✓ Looking for a chat — tap to stop"
            : "Looking for a chat"}
        </Text>
      </Pressable>

      {/* Half/half Happy · Busy pill row. */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Pill
            testID="my-status-happy"
            label="Happy to connect"
            icon="😊"
            active={isHappy}
            disabled={busy}
            onPress={() => toggle("happy")}
            brand={c.brand}
            brandTint={c.brandTertiary}
            surface={c.surface}
            onSurface={c.onSurface}
            onBrand={c.onBrandPrimary}
            border={c.brand}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Pill
            testID="my-status-busy"
            label="Busy right now"
            icon="🟡"
            active={isBusy}
            disabled={busy}
            onPress={() => toggle("busy")}
            brand={c.brand}
            brandTint={c.brandTertiary}
            surface={c.surface}
            onSurface={c.onSurface}
            onBrand={c.onBrandPrimary}
            border={c.brand}
          />
        </View>
      </View>

      {/* Small ✕ Clear pill — only when there IS something to clear. */}
      {manual !== null && (
        <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
          <Pressable
            testID="my-status-clear"
            onPress={() => (busy ? undefined : setManual(null))}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Clear my status"
            style={({ pressed }) => [
              styles.clearPill,
              {
                backgroundColor: pressed ? c.brandTertiary : c.surface,
                borderColor: c.border,
                opacity: busy ? 0.5 : 1,
              },
            ]}
          >
            <Text style={{ color: c.muted, fontWeight: "800", fontSize: 13 * scale }}>✕ Clear</Text>
          </Pressable>
        </View>
      )}

      <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 10, lineHeight: 17 }}>
        ☕ In the FP Café and ⚫ Offline are set automatically.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitle: {
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  effectiveChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 2,
    minHeight: 52,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 2,
    minHeight: 44,
  },
  clearPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
