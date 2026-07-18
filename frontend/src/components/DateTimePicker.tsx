import React, { useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

/**
 * Cross-platform Date + Time fields tailored for older-adult tap targets.
 *
 * - DateField: shows a friendly month-calendar modal (today highlighted, past
 *   dates greyed out). On web also accepts manual typing via the same field.
 * - TimeField: shows a list of 15-minute slots starting at 6:00 AM through
 *   10:00 PM in a modal. 12-hour AM/PM labelling for readability.
 *
 * Value formats are kept compatible with the existing backend contract:
 *   date: "YYYY-MM-DD" (Australian local calendar)
 *   time: "HH:MM" (24-hour)
 */

function pad(n: number) { return n.toString().padStart(2, "0"); }
function isoFromYMD(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function parseISO(iso: string): { y: number; m: number; d: number } | null {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!mm) return null;
  return { y: parseInt(mm[1], 10), m: parseInt(mm[2], 10) - 1, d: parseInt(mm[3], 10) };
}
function monthName(m: number): string {
  return ["January","February","March","April","May","June","July","August","September","October","November","December"][m];
}
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

export function DateField({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID?: string }) {
  const { c, scale } = useTheme();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const todayStr = isoFromYMD(today.getFullYear(), today.getMonth(), today.getDate());
  const parsed = parseISO(value) || { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
  const [viewY, setViewY] = useState(parsed.y);
  const [viewM, setViewM] = useState(parsed.m);

  const displayLabel = useMemo(() => {
    const p = parseISO(value);
    if (!p) return "Choose date";
    return new Date(p.y, p.m, p.d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [value]);

  const firstWeekday = new Date(viewY, viewM, 1).getDay(); // 0=Sun
  const days = daysInMonth(viewY, viewM);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (viewM === 0) { setViewY(viewY - 1); setViewM(11); } else { setViewM(viewM - 1); }
  };
  const nextMonth = () => {
    if (viewM === 11) { setViewY(viewY + 1); setViewM(0); } else { setViewM(viewM + 1); }
  };

  return (
    <>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        style={{ borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginTop: 4, backgroundColor: c.surfaceSecondary, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <Ionicons name="calendar" size={20} color={c.brand} />
        <Text style={{ color: value ? c.onSurface : c.muted, fontWeight: "700", fontSize: 16 * scale, flex: 1 }}>{displayLabel}</Text>
        <Ionicons name="chevron-down" size={18} color={c.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Full-screen backdrop + centered sheet — this arrangement
            keeps the picker legible on tablets. The old positioning
            (absolute left:16/right:16) stretched the sheet across
            the whole tablet, which in turn made the 7-column grid
            look like a 20-column strip. */}
        <View style={styles.centerWrap}>
          <Pressable onPress={() => setOpen(false)} style={styles.backdrop} />
          <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.calHead}>
            <Pressable onPress={prevMonth} hitSlop={10} style={styles.calNav}><Ionicons name="chevron-back" size={22} color={c.brand} /></Pressable>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale }}>{monthName(viewM)} {viewY}</Text>
            <Pressable onPress={nextMonth} hitSlop={10} style={styles.calNav}><Ionicons name="chevron-forward" size={22} color={c.brand} /></Pressable>
          </View>
          <View style={styles.weekRow}>
            {["S","M","T","W","T","F","S"].map((w, i) => (
              <Text key={i} style={[styles.weekLabel, { color: c.muted, fontSize: 12 * scale }]}>{w}</Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((d, idx) => {
              if (d == null) return <View key={`b-${idx}`} style={styles.cell} />;
              const iso = isoFromYMD(viewY, viewM, d);
              const isToday = iso === todayStr;
              const isSel = iso === value;
              const isPast = iso < todayStr;
              return (
                <Pressable
                  key={iso}
                  testID={`date-cell-${iso}`}
                  disabled={isPast}
                  onPress={() => { onChange(iso); setOpen(false); }}
                  style={styles.cell}
                >
                  <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: isSel ? c.brand : isToday ? c.brandTertiary : "transparent", opacity: isPast ? 0.32 : 1 }}>
                    <Text style={{ color: isSel ? "#FFF" : isToday ? c.brand : c.onSurface, fontWeight: isSel || isToday ? "900" : "700", fontSize: 15 * scale }}>{d}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => setOpen(false)} style={[styles.closeBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
          </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

export function TimeField({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID?: string }) {
  const { c, scale } = useTheme();
  const [open, setOpen] = useState(false);

  // 15-minute slots from 6:00 AM to 10:00 PM (older-adult-friendly day range).
  const slots = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 15) {
        const v = `${pad(h)}:${pad(m)}`;
        const period = h >= 12 ? "PM" : "AM";
        const display = `${((h + 11) % 12) + 1}:${pad(m)} ${period}`;
        out.push({ value: v, label: display });
      }
    }
    return out;
  }, []);

  const displayLabel = useMemo(() => {
    const found = slots.find((s) => s.value === value);
    if (found) return found.label;
    // Allow legacy custom-typed times to round-trip.
    if (/^\d{2}:\d{2}$/.test(value)) {
      const [hh, mm] = value.split(":").map((n) => parseInt(n, 10));
      const period = hh >= 12 ? "PM" : "AM";
      return `${((hh + 11) % 12) + 1}:${pad(mm)} ${period}`;
    }
    return "Choose time";
  }, [value, slots]);

  return (
    <>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        style={{ borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginTop: 4, backgroundColor: c.surfaceSecondary, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <Ionicons name="time" size={20} color={c.brand} />
        <Text style={{ color: value ? c.onSurface : c.muted, fontWeight: "700", fontSize: 16 * scale, flex: 1 }}>{displayLabel}</Text>
        <Ionicons name="chevron-down" size={18} color={c.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.centerWrap}>
          <Pressable onPress={() => setOpen(false)} style={styles.backdrop} />
          <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border, maxHeight: 480 }]}>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, padding: 14, paddingBottom: 6 }}>Pick a time</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {slots.map((s) => {
              const on = s.value === value;
              return (
                <Pressable
                  key={s.value}
                  testID={`time-slot-${s.value}`}
                  onPress={() => { onChange(s.value); setOpen(false); }}
                  style={{ paddingHorizontal: 18, paddingVertical: 14, backgroundColor: on ? c.brandTertiary : "transparent", flexDirection: "row", alignItems: "center", gap: 10 }}
                >
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? c.brand : c.muted} />
                  <Text style={{ color: c.onSurface, fontWeight: on ? "900" : "700", fontSize: 16 * scale }}>{s.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => setOpen(false)} style={[styles.closeBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
          </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Full-screen wrapper so the sheet centres on any device — vital
  // on tablets where an absolute `left:16/right:16` sheet would
  // stretch across the whole screen and warp the 7-column grid.
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    // width caps out at 380 so the calendar stays phone-shaped even
    // on iPad landscape; on narrow phones it happily fills 100%.
    width: "100%",
    maxWidth: 380,
    borderRadius: 18, borderWidth: 1, padding: 8,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 10 },
  calNav: { padding: 8 },
  // 7-column layout — each cell is exactly 1/7 of the sheet's width,
  // so weekday headers and day numbers stay in lockstep at any width.
  weekRow: { flexDirection: "row", paddingVertical: 4 },
  weekLabel: { flex: 1, textAlign: "center", fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 4 },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center", marginVertical: 2 },
  closeBtn: { marginTop: 8, paddingVertical: 12, alignItems: "center", borderRadius: 12, borderWidth: 1 },
});
