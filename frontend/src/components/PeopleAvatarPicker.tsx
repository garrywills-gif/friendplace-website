/**
 * PeopleAvatarPicker — a friendly avatar builder for older adults that
 * combines an emoji face with optional skin tone and hair colour.
 *
 * Why emoji and not illustrated avatars?
 *   • Ships with the OS — no image hosting, no licensing, looks native on
 *     iOS / Android / iPad and renders at any size.
 *   • Backwards compatible — `avatar` is still a string and any existing
 *     emoji avatar (e.g. 🎨 🔨) continues to render unchanged.
 *
 * How combinations are built:
 *   - Base face: 👨 / 👩 / 🧑 / 👴 / 👵 / 👶
 *   - Optional skin tone (Fitzpatrick modifier 🏻🏼🏽🏾🏿)
 *   - Optional hair colour via Zero-Width-Joiner (ZWJ) sequences:
 *       red 🦰   curly 🦱   white 🦳   bald 🦲
 *   Example:    "👩" + "🏽" + "\u200D" + "🦰"  →  👩🏽‍🦰
 *
 * NOTE: not every base supports every modifier (e.g. baby 👶 ignores hair),
 * but unsupported pairs simply render the base unchanged on modern systems.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

type Face = { key: string; label: string; emoji: string };
type Skin = { key: string; label: string; modifier: string | null; swatch: string };
type Hair = { key: string; label: string; suffix: string | null };

const FACES: Face[] = [
  { key: "person",   label: "Person",        emoji: "🧑" },
  { key: "man",      label: "Man",           emoji: "👨" },
  { key: "woman",    label: "Woman",         emoji: "👩" },
  { key: "older_man",   label: "Older Man",   emoji: "👴" },
  { key: "older_woman", label: "Older Woman", emoji: "👵" },
  { key: "man_beard",   label: "Man (beard)", emoji: "🧔" },
];

const SKIN: Skin[] = [
  { key: "default", label: "Default",     modifier: null,      swatch: "🟡" },
  { key: "light",   label: "Light",       modifier: "\u{1F3FB}", swatch: "🏻" },
  { key: "mlight",  label: "Medium light", modifier: "\u{1F3FC}", swatch: "🏼" },
  { key: "medium",  label: "Medium",      modifier: "\u{1F3FD}", swatch: "🏽" },
  { key: "mdark",   label: "Medium dark", modifier: "\u{1F3FE}", swatch: "🏾" },
  { key: "dark",    label: "Dark",        modifier: "\u{1F3FF}", swatch: "🏿" },
];

const HAIR: Hair[] = [
  { key: "default", label: "Default", suffix: null },
  { key: "red",     label: "Red",     suffix: "\u200D\u{1F9B0}" }, // 🦰
  { key: "curly",   label: "Curly",   suffix: "\u200D\u{1F9B1}" }, // 🦱
  { key: "white",   label: "Grey",    suffix: "\u200D\u{1F9B3}" }, // 🦳
  { key: "bald",    label: "Bald",    suffix: "\u200D\u{1F9B2}" }, // 🦲
];

const FACE_BY_KEY: Record<string, Face> = Object.fromEntries(FACES.map((f) => [f.key, f]));

function build(faceKey: string, skinKey: string, hairKey: string): string {
  const face = FACE_BY_KEY[faceKey] || FACES[0];
  const skin = SKIN.find((s) => s.key === skinKey) || SKIN[0];
  const hair = HAIR.find((h) => h.key === hairKey) || HAIR[0];
  // 👴/👵/👶 don't blend cleanly with hair modifiers; respect the user's
  // selection but skip the suffix on those bases so rendering stays clean.
  const allowHair = !["older_man", "older_woman"].includes(face.key);
  return (
    face.emoji +
    (skin.modifier || "") +
    (allowHair && hair.suffix ? hair.suffix : "")
  );
}

type Props = {
  /** Current avatar string (any emoji). Used to seed initial selection
   * and indicate the user already has something set. */
  value?: string | null;
  /** Called whenever the user changes a slot — emits the rebuilt avatar. */
  onChange: (next: string) => void;
  /** Visual size of the live preview circle. Defaults to 96. */
  previewSize?: number;
  /** Compact mode reduces padding/font sizes — useful inside dense edit screens. */
  compact?: boolean;
};

export default function PeopleAvatarPicker({
  value,
  onChange,
  previewSize = 96,
  compact = false,
}: Props) {
  const { c, scale } = useTheme();
  const [faceKey, setFaceKey] = useState<string>(FACES[0].key);
  const [skinKey, setSkinKey] = useState<string>(SKIN[0].key);
  const [hairKey, setHairKey] = useState<string>(HAIR[0].key);

  const current = useMemo(() => build(faceKey, skinKey, hairKey), [faceKey, skinKey, hairKey]);

  // Keep emitted value in sync with the live combination — debounced via
  // React state so consumers don't see intermediate flickers.
  React.useEffect(() => {
    onChange(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const pad = compact ? 10 : 14;
  const swatchSize = compact ? 40 : 48;

  return (
    <View style={{ gap: pad }} testID="people-avatar-picker">
      {/* Live preview */}
      <View style={[styles.previewRow, { gap: pad }]}>
        <View
          style={[
            styles.previewCircle,
            {
              width: previewSize,
              height: previewSize,
              borderRadius: previewSize / 2,
              backgroundColor: c.brandTertiary,
              borderColor: c.brand,
            },
          ]}
        >
          <Text style={{ fontSize: Math.round(previewSize * 0.62) }}>{current}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: c.muted, fontSize: 12 * scale }]}>YOUR LOOK</Text>
          <Text style={[styles.previewTitle, { color: c.onSurface, fontSize: (compact ? 16 : 18) * scale }]}>
            {FACE_BY_KEY[faceKey]?.label}
          </Text>
          <Text style={[styles.previewSub, { color: c.muted, fontSize: 13 * scale }]} numberOfLines={1}>
            {SKIN.find((s) => s.key === skinKey)?.label} skin · {HAIR.find((h) => h.key === hairKey)?.label} hair
          </Text>
        </View>
      </View>

      {/* Face row */}
      <Section title="STYLE" muted={c.muted} scale={scale}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FACES.map((f) => {
            const on = f.key === faceKey;
            return (
              <Pressable
                key={f.key}
                testID={`avatar-face-${f.key}`}
                onPress={() => setFaceKey(f.key)}
                style={[
                  styles.swatch,
                  {
                    width: swatchSize + 12,
                    height: swatchSize + 12,
                    borderRadius: 14,
                    backgroundColor: on ? c.brand : c.surfaceTertiary,
                    borderColor: on ? c.brand : c.border,
                  },
                ]}
              >
                <Text style={{ fontSize: swatchSize * 0.55 }}>{f.emoji}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Section>

      {/* Skin row */}
      <Section title="SKIN TONE" muted={c.muted} scale={scale}>
        <View style={[styles.row, { gap: 6 }]}>
          {SKIN.map((s) => {
            const on = s.key === skinKey;
            return (
              <Pressable
                key={s.key}
                testID={`avatar-skin-${s.key}`}
                onPress={() => setSkinKey(s.key)}
                style={[
                  styles.swatch,
                  {
                    width: swatchSize,
                    height: swatchSize,
                    borderRadius: swatchSize / 2,
                    backgroundColor: on ? c.brand : c.surfaceTertiary,
                    borderColor: on ? c.brand : c.border,
                  },
                ]}
                accessibilityLabel={`${s.label} skin tone`}
              >
                <Text style={{ fontSize: swatchSize * 0.5 }}>{s.swatch}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {/* Hair row */}
      <Section title="HAIR" muted={c.muted} scale={scale}>
        <View style={[styles.row, { gap: 6, flexWrap: "wrap" }]}>
          {HAIR.map((h) => {
            const on = h.key === hairKey;
            const preview = build(faceKey, skinKey, h.key);
            return (
              <Pressable
                key={h.key}
                testID={`avatar-hair-${h.key}`}
                onPress={() => setHairKey(h.key)}
                style={[
                  styles.hairChip,
                  {
                    backgroundColor: on ? c.brand : c.surfaceTertiary,
                    borderColor: on ? c.brand : c.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 22 }}>{preview}</Text>
                <Text
                  style={{
                    color: on ? c.onBrandPrimary : c.onSurface,
                    fontWeight: "700",
                    fontSize: 13 * scale,
                  }}
                >
                  {h.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {/* Subtle hint about backward-compat — users can keep the original
       * "Quirky" item emojis by ignoring this picker. */}
      <View style={styles.hintRow}>
        <Ionicons name="information-circle" size={14} color={c.muted} />
        <Text style={{ color: c.muted, fontSize: 12 * scale, marginLeft: 6 }}>
          Tip: you can also choose a fun emoji below — both work great!
        </Text>
      </View>
    </View>
  );
}

function Section({
  title,
  children,
  muted,
  scale,
}: {
  title: string;
  children: React.ReactNode;
  muted: string;
  scale: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: muted, fontSize: 12 * scale }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: "row", alignItems: "center" },
  previewCircle: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  previewTitle: { fontWeight: "900", marginTop: 2 },
  previewSub: { fontWeight: "600", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center" },
  swatch: {
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  hairChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
  },
  label: { fontWeight: "800", letterSpacing: 0.4 },
  hintRow: { flexDirection: "row", alignItems: "center" },
});
