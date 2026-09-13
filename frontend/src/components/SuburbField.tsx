import React, { useEffect, useState, useRef } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

type SuburbMatch = { name: string; postcode: string; state: string; lat?: number; lng?: number };

type Props = {
  initialValue?: string;
  onChange: (
    suburb: { name: string; postcode?: string; state?: string } | null,
  ) => void;
  testID?: string;
};

/** Searchable Australian suburb/locality picker.
 *  Backed by the central ~17,500-locality dataset via /api/suburbs/search.
 *  Suburb is required — there is no "prefer not to say" option. */
export default function SuburbField({ initialValue = "", onChange, testID }: Props) {
  const { c, scale } = useTheme();
  const [text, setText] = useState(initialValue);
  const [matches, setMatches] = useState<SuburbMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [pickedSuburb, setPickedSuburb] = useState<SuburbMatch | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!text || text.length < 2) { setMatches([]); return; }
    // If the current text exactly matches the chosen suburb label, don't re-search.
    if (pickedSuburb && text === `${pickedSuburb.name}, ${pickedSuburb.state} ${pickedSuburb.postcode}`) return;
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
  }, [text, pickedSuburb]);

  const choose = (m: SuburbMatch) => {
    setPickedSuburb(m);
    setText(`${m.name}, ${m.state} ${m.postcode}`);
    setMatches([]);
    setOpen(false);
    onChange({ name: m.name, postcode: m.postcode, state: m.state });
  };

  const clear = () => {
    setText("");
    setMatches([]);
    setPickedSuburb(null);
    setOpen(false);
    onChange(null);
  };

  return (
    <View>
      <View style={{ position: "relative" }}>
        <TextInput
          testID={testID || "suburb-field"}
          value={text}
          onChangeText={(t) => { setText(t); if (pickedSuburb) { setPickedSuburb(null); onChange(null); } }}
          placeholder="Choose your suburb or nearest town"
          placeholderTextColor={c.muted}
          style={[styles.input, { backgroundColor: c.surfaceSecondary, color: c.onSurface, borderColor: c.border, fontSize: 16 * scale }]}
          autoCorrect={false}
          onFocus={() => { if (matches.length) setOpen(true); }}
        />
        {!!text && (
          <Pressable hitSlop={10} onPress={clear} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={20} color={c.muted} />
          </Pressable>
        )}
        {loading && <View style={styles.loading}><ActivityIndicator size="small" color={c.brand} /></View>}
      </View>

      {open && matches.length > 0 && (
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
      )}

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
});
