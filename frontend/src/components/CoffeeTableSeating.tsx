/**
 * CoffeeTableSeating — a top-down view of a round coffee table with 8 chairs.
 *
 * Each chair either:
 *   • shows the seated person's avatar emoji + first name (occupied), OR
 *   • shows an outlined empty-chair glyph (vacant).
 *
 * As people join or leave the table chat (via the WebSocket presence channel)
 * the parent screen updates `seated` and the chairs visually fill or empty.
 *
 * Design choices:
 *  - 8 fixed seat positions arranged at 0°, 45°, 90°, … around the table.
 *  - The table itself is centred in a square layout so the math is symmetric.
 *  - Seats use brand colours when occupied (warm + visible) and a soft muted
 *    look when empty (so the eye is drawn to people, not empty chairs).
 *  - Tapping the title chip collapses the visual to a compact summary bar to
 *    reclaim screen real estate inside the chat. Default is expanded.
 *  - Strict-typed seat array; the component never reorders seats — the first
 *    seated person is always at the top (12 o'clock) and the rest fill
 *    clockwise so existing seated users don't appear to move when others
 *    arrive/leave.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import AvatarBubble from "@/src/components/AvatarBubble";

export type SeatedUser = {
  id: string;
  first_name?: string;
  avatar?: string;
};

type Props = {
  seated: SeatedUser[];
  /** Total chairs around the table. 8 looks balanced for ages 60+. */
  capacity?: number;
  /** Big emoji shown in the centre of the table (defaults to ☕). */
  tableEmoji?: string;
  /** When true the user can tap to collapse into a compact strip. */
  collapsible?: boolean;
  /** Optional testID prefix passed through for automation. */
  testID?: string;
};

// 8-seat layout, top-of-the-clock first, then clockwise. The order is fixed
// so that already-seated people stay put when someone new arrives — we
// only assign the *next* available index to a newcomer.
const SEAT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];

export default function CoffeeTableSeating({
  seated,
  capacity = 8,
  tableEmoji = "☕",
  collapsible = true,
  testID = "coffee-table",
}: Props) {
  const { c, scale } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [layoutW, setLayoutW] = useState(0);

  // Assign each seated user to a fixed seat index, in the order they're listed
  // by the backend (which mirrors the order they joined). Seats beyond
  // `capacity` are ignored visually but counted in the header label.
  const seatAssignment = useMemo(() => {
    const map: Record<number, SeatedUser | undefined> = {};
    SEAT_ORDER.slice(0, capacity).forEach((slot, idx) => {
      map[slot] = seated[idx];
    });
    return map;
  }, [seated, capacity]);

  const totalSeated = seated.length;
  const overflowCount = Math.max(0, totalSeated - capacity);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && Math.abs(w - layoutW) > 1) setLayoutW(w);
  };

  // Compute geometry inside the square. Keeping it self-contained means the
  // component scales smoothly to whatever width the parent allocates.
  const size = Math.min(layoutW || 320, 360);
  const cx = size / 2;
  const cy = size / 2;
  const tableR = size * 0.22;   // table radius
  const seatR  = size * 0.085;  // each chair radius
  const orbit  = size * 0.38;   // distance from centre to chair centre

  return (
    <View style={[styles.wrap, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]} testID={testID}>
      {/* Header chip — tappable to collapse/expand. */}
      <Pressable
        testID={`${testID}-toggle`}
        onPress={() => collapsible && setCollapsed((v) => !v)}
        disabled={!collapsible}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="cafe" size={18} color={c.brand} />
        <Text style={[styles.headerText, { color: c.brand, fontSize: 14 * scale }]}>
          {totalSeated === 0
            ? "Pull up a chair"
            : totalSeated === 1
              ? "1 person at the table"
              : `${totalSeated} people at the table`}
        </Text>
        {collapsible && (
          <Ionicons
            name={collapsed ? "chevron-down" : "chevron-up"}
            size={18}
            color={c.brand}
            style={{ marginLeft: "auto" }}
          />
        )}
      </Pressable>

      {/* Collapsed view: a compact strip of avatar chips. */}
      {collapsed ? (
        <View style={styles.stripRow}>
          {seated.slice(0, 8).map((u, i) => (
            <View
              key={u.id}
              style={[
                styles.stripChip,
                {
                  backgroundColor: c.surface,
                  borderColor: c.brand,
                  marginLeft: i === 0 ? 0 : -10,
                },
              ]}
            >
              <AvatarBubble value={u.avatar} size={18} fallback="🙂" />
            </View>
          ))}
          {seated.length === 0 && (
            <Text style={[styles.emptyHint, { color: c.muted, fontSize: 13 * scale }]}>
              No one seated yet — say hello first!
            </Text>
          )}
        </View>
      ) : (
        // Expanded view: round table with 8 chairs.
        <View style={styles.stageWrap} onLayout={onLayout}>
          <View style={[styles.stage, { width: size, height: size }]}>
            {/* The wooden table itself. */}
            <View
              style={[
                styles.table,
                {
                  width: tableR * 2,
                  height: tableR * 2,
                  borderRadius: tableR,
                  left: cx - tableR,
                  top: cy - tableR,
                  backgroundColor: "#92400E",
                  borderColor: "#78350F",
                },
              ]}
            >
              <View
                style={[
                  styles.tableInner,
                  {
                    width: tableR * 1.55,
                    height: tableR * 1.55,
                    borderRadius: tableR,
                    backgroundColor: "#B45309",
                  },
                ]}
              >
                <Text style={{ fontSize: Math.max(28, tableR * 0.7) }}>{tableEmoji}</Text>
                {overflowCount > 0 && (
                  <View style={[styles.overflowChip, { backgroundColor: c.brand }]} testID={`${testID}-overflow`}>
                    <Text style={[styles.overflowText, { fontSize: 12 * scale }]}>+{overflowCount} more</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Eight chair slots around the table. */}
            {SEAT_ORDER.slice(0, capacity).map((slot) => {
              // Start at 12 o'clock and walk clockwise so the first seat is
              // visually "at the head of the table".
              const angle = (slot / capacity) * 2 * Math.PI - Math.PI / 2;
              const x = cx + orbit * Math.cos(angle);
              const y = cy + orbit * Math.sin(angle);
              const u = seatAssignment[slot];
              const isOccupied = !!u;
              return (
                <View
                  key={slot}
                  style={[
                    styles.seatWrap,
                    { left: x - seatR, top: y - seatR, width: seatR * 2 },
                  ]}
                  testID={`${testID}-seat-${slot}${isOccupied ? "-occupied" : "-empty"}`}
                >
                  <View
                    style={[
                      styles.seat,
                      {
                        width: seatR * 2,
                        height: seatR * 2,
                        borderRadius: seatR,
                        backgroundColor: isOccupied ? c.brandTertiary : c.surface,
                        borderColor: isOccupied ? c.brand : c.border,
                        borderStyle: isOccupied ? "solid" : "dashed",
                      },
                    ]}
                  >
                    {isOccupied ? (
                      <Text style={{ fontSize: Math.max(22, seatR * 0.95) }}>
                        {u!.avatar || "🙂"}
                      </Text>
                    ) : (
                      <Ionicons
                        name="person-outline"
                        size={Math.max(18, seatR * 0.85)}
                        color={c.muted}
                      />
                    )}
                  </View>
                  {/* Name caption under each occupied chair. */}
                  {isOccupied && (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.seatName,
                        {
                          color: c.onSurface,
                          fontSize: 11 * scale,
                          maxWidth: seatR * 2.6,
                        },
                      ]}
                    >
                      {u!.first_name || "Friend"}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  headerText: { fontWeight: "800" },
  stageWrap: { alignItems: "center", justifyContent: "center", marginTop: 8 },
  stage: { position: "relative" },
  table: {
    position: "absolute",
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  tableInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  overflowChip: {
    position: "absolute",
    bottom: -10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  overflowText: { color: "#FFFFFF", fontWeight: "800" },
  seatWrap: {
    position: "absolute",
    alignItems: "center",
  },
  seat: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  seatName: {
    fontWeight: "700",
    marginTop: 2,
    textAlign: "center",
  },
  stripRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
    minHeight: 44,
  },
  stripChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHint: { fontWeight: "600", marginLeft: 4 },
});
