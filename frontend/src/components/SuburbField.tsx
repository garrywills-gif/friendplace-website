import React, { useEffect, useState, useRef } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

type SuburbMatch = { name: string; postcode: string; state: string; lat?: number; lng?: number };

type Props = {
  initialValue?: string;
  preferNotToSay?: boolean;
  onChange: (
    suburb: { name: string; postcode?: string; state?: string } | null,
    prefer_not_to_say?: boolean,
  ) => void;
  testID?: string;
};

/** Searchable Australian suburb picker with "Prefer not to say" option.
 *  Optional Near-Me hook can be passed by parent (we surface it as a button). */
export default function SuburbField({ initialValue = "", preferNotToSay = false, onChange, testID }: Props) {
  const { c, scale } = useTheme();
  const [text, setText] = useState(initialValue);
  const [matches, setMatches] = useState<SuburbMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [pickedSuburb, setPickedSuburb] = useState<SuburbMatch | null>(null);
  const [pns, setPns] = useState(preferNotToSay);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (pns || !text || text.length < 2) { setMatches([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r: any = await api.suburbsSearch(text);
        setMatches(r.results || []);
        setOpen(true);
      } finally { setLoading(false); }
    }, 220);
    return () => clearTimeout(timer.current);
  }, [text, pns]);

  const choose = (m: SuburbMatch) => {
    setPickedSuburb(m);
    setText(`${m.name}, ${m.state} ${m.postcode}`);
    setOpen(false);
    setPns(false);
    onChange({ name: m.name, postcode: m.postcode, state: m.state }, false);
  };

  const togglePns = () => {
    const next = !pns;
    setPns(next);
    if (next) {
      setText("");
      setMatches([]);
      setPickedSuburb(null);
      setOpen(false);
      onChange(null, true);
    } else {
      onChange(null, false);
    }
  };

  return (
    <View>
      <View style={{ position: "relative" }}>
        <TextInput
          testID={testID || "suburb-field"}
          value={text}
          onChangeText={(t) => { setText(t); if (pns) setPns(false); }}
          placeholder="Start typing your suburb"
          placeholderTextColor={c.muted}
          editable={!pns}
          style={[styles.input, { backgroundColor: pns ? c.surfaceTertiary : c.surfaceSecondary, color: c.onSurface, borderColor: c.border, fontSize: 16 * scale }]}
          autoCorrect={false}
          onFocus={() => { if (matches.length) setOpen(true); }}
        />
        {!!text && !pns && (
          <Pressable hitSlop={10} onPress={() => { setText(""); setMatches([]); setPickedSuburb(null); onChange(null, false); }} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={20} color={c.muted} />
          </Pressable>
        )}
        {loading && <View style={styles.loading}><ActivityIndicator size="small" color={c.brand} /></View>}
      </View>

      {open && !pns && text.length >= 2 && (
        matches.length > 0 ? (
          <View style={[styles.dropdown, { backgroundColor: c.surface, borderColor: c.border }]}>
            {matches.map((m, idx) => (
              <Pressable
                key={`${m.postcode}-${m.name}-${idx}`}
                testID={`suburb-match-${m.name}`}
                onPress={() => choose(m)}
                style={[styles.row, { borderBottomColor: c.border }]}
              >
                <Ionicons name="location" size={18} color={c.brand} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>{m.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{m.state} · {m.postcode}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          !loading ? (
            /* TestFlight Fix Batch 1 (Garry, Aug 2026 — P1 #6):
               When the typed suburb has no matches, previously the
               dropdown just stayed hidden and the member could leave
               the field with unrecognised free-text — their profile
               kept its previous suburb (or empty), silently excluding
               them from Find a Friend results. This helpful "no
               matches" state guides them to pick a nearby major town
               so their suburb is actually recognised. */
            <View
              testID="suburb-no-matches"
              style={[styles.dropdown, { backgroundColor: c.surface, borderColor: c.border, padding: 14, gap: 8 }]}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <Ionicons name="information-circle-outline" size={22} color={c.brand} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>
                    We don&rsquo;t have that suburb yet
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 4, lineHeight: 18 }}>
                    Try the closest main town or suburb — or tap &ldquo;Prefer not to say&rdquo; below and add it later.
                  </Text>
                </View>
              </View>
            </View>
          ) : null
        )
      )}

      <Pressable
        testID="suburb-pns"
        onPress={togglePns}
        style={[styles.pns, { backgroundColor: pns ? c.brand : c.surfaceSecondary, borderColor: pns ? c.brand : c.border }]}
      >
        <Ionicons name={pns ? "checkmark-circle" : "lock-closed"} size={18} color={pns ? "#FFF" : c.onSurface} />
        <Text style={{ color: pns ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale, marginLeft: 8 }}>Prefer not to say</Text>
      </Pressable>
      <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 6 }}>We only ever show your suburb publicly — never your street address.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, paddingRight: 40 },
  clearBtn: { position: "absolute", right: 10, top: 12 },
  loading: { position: "absolute", right: 36, top: 14 },
  dropdown: { borderWidth: 1.5, borderRadius: 12, marginTop: 6, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1 },
  pns: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, alignSelf: "flex-start", marginTop: 10 },
});
