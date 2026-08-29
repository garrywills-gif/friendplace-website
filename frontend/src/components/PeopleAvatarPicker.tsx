/**
 * PeopleAvatarPicker — the three-option FriendPlace member avatar picker.
 *
 * TABS
 *   1. **Choose a FriendPlace avatar** — 72 curated 3D preset portraits
 *      (see `src/lib/avatar-presets.ts`). Filterable by age band. Stored
 *      as `"preset:portrait-17"` in `user.avatar`.
 *   2. **Upload your own photo** — expo-image-picker with 1:1 crop,
 *      quality 0.6, base64 payload. Stored as `data:image/jpeg;base64,…`
 *      in `user.avatar`. AvatarBubble now recognises both `data:` and
 *      `preset:` refs, so uploads render everywhere the emoji ones did.
 *   3. **Or use a fun emoji** — the original legacy emoji builder
 *      (face / skin / hair / glasses) is preserved intact for
 *      backward-compat. All existing emoji-string avatars keep rendering.
 *
 * `user.avatar` stays a single string — no schema change on the backend.
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import AvatarBubble, { parseAvatar, withGlasses } from "./AvatarBubble";
import {
  AVATAR_PRESETS,
  AVATAR_PRESET_GROUPS,
  presetToAvatarString,
  isPresetAvatar,
  type AvatarPresetGroup,
} from "@/src/lib/avatar-presets";

// ---------- Legacy emoji builder (unchanged from the previous version) ----------

type Face = { key: string; label: string; emoji: string };
type Skin = { key: string; label: string; modifier: string | null; swatch: string };
type Hair = { key: string; label: string; suffix: string | null };

const FACES: Face[] = [
  { key: "person",     label: "Person",       emoji: "🧑" },
  { key: "man",        label: "Man",          emoji: "👨" },
  { key: "woman",      label: "Woman",        emoji: "👩" },
  { key: "man_beard",  label: "Man (beard)",  emoji: "🧔" },
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
  { key: "black",   label: "Black",   suffix: null },
  { key: "brown",   label: "Brown",   suffix: "\u200D\u{1F9B1}" },
  { key: "red",     label: "Red",     suffix: "\u200D\u{1F9B0}" },
  { key: "white",   label: "Grey",    suffix: "\u200D\u{1F9B3}" },
  { key: "bald",    label: "Bald",    suffix: "\u200D\u{1F9B2}" },
];

const FACE_BY_KEY: Record<string, Face> = Object.fromEntries(FACES.map((f) => [f.key, f]));

function buildEmojiAvatar(faceKey: string, skinKey: string, hairKey: string, glasses: boolean): string {
  const face = FACE_BY_KEY[faceKey] || FACES[0];
  const skin = SKIN.find((s) => s.key === skinKey) || SKIN[0];
  const hair = HAIR.find((h) => h.key === hairKey) || HAIR[0];
  const base = face.emoji + (skin.modifier || "") + (hair.suffix || "");
  return glasses ? `${base}::g` : base;
}

// ---------- Tab shell ----------

type Mode = "preset" | "upload" | "emoji";

type Props = {
  /** Current avatar string (any format). Used to seed the picker and
   * to indicate the active selection. */
  value?: string | null;
  /** Called whenever the user changes the avatar. */
  onChange: (next: string) => void;
  /** Live preview circle size. Defaults to 96. */
  previewSize?: number;
  /** Compact mode — reduces padding/font in dense edit screens. */
  compact?: boolean;
};

function seedMode(value?: string | null): Mode {
  if (!value) return "preset";
  if (isPresetAvatar(value)) return "preset";
  const { base } = parseAvatar(value);
  if (base && /^data:/i.test(base)) return "upload";
  if (base && /^https?:/i.test(base)) return "upload";
  return "emoji";
}

export default function PeopleAvatarPicker({
  value,
  onChange,
  previewSize = 96,
  compact = false,
}: Props) {
  const { c, scale } = useTheme();
  const [mode, setMode] = useState<Mode>(() => seedMode(value));
  const [current, setCurrent] = useState<string>(value ?? "");

  // Keep parent in sync any time the picker changes selection.
  useEffect(() => {
    if (current) onChange(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const pad = compact ? 10 : 14;

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
          <AvatarBubble value={current} size={previewSize - 12} textSize={Math.round(previewSize * 0.62)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.previewLabel, { color: c.muted, fontSize: 12 * scale }]}>YOUR AVATAR</Text>
          <Text style={[styles.previewTitle, { color: c.onSurface, fontSize: (compact ? 15 : 17) * scale }]}>
            {modeTitle(current)}
          </Text>
        </View>
      </View>

      {/* Mode tabs — always render all three so members can move freely. */}
      <View style={[styles.tabRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
        <ModeTab
          testID="avatar-mode-preset"
          label="FriendPlace"
          icon="happy-outline"
          active={mode === "preset"}
          onPress={() => setMode("preset")}
          c={c} scale={scale}
        />
        <ModeTab
          testID="avatar-mode-upload"
          label="Your photo"
          icon="camera-outline"
          active={mode === "upload"}
          onPress={() => setMode("upload")}
          c={c} scale={scale}
        />
        <ModeTab
          testID="avatar-mode-emoji"
          label="Fun emoji"
          icon="happy-sharp"
          active={mode === "emoji"}
          onPress={() => setMode("emoji")}
          c={c} scale={scale}
        />
      </View>

      {mode === "preset" ? (
        <PresetTab value={current} onPick={setCurrent} c={c} scale={scale} />
      ) : mode === "upload" ? (
        <UploadTab value={current} onPick={setCurrent} c={c} scale={scale} />
      ) : (
        <EmojiTab value={current} onPick={setCurrent} c={c} scale={scale} compact={compact} />
      )}
    </View>
  );
}

function modeTitle(value: string): string {
  if (!value) return "Not set yet";
  if (isPresetAvatar(value)) return "FriendPlace avatar";
  const { base } = parseAvatar(value);
  if (base && /^data:/i.test(base)) return "Your photo";
  if (base && /^https?:/i.test(base)) return "Your photo";
  return "Fun emoji";
}

function ModeTab({ testID, label, icon, active, onPress, c, scale }: {
  testID: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  c: any;
  scale: number;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[
        styles.tabItem,
        {
          backgroundColor: active ? c.brand : "transparent",
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={active ? c.onBrandPrimary : c.muted} />
      <Text
        style={{
          color: active ? c.onBrandPrimary : c.onSurface,
          fontWeight: "800",
          fontSize: 13 * scale,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- Preset tab ----------

function PresetTab({ value, onPick, c, scale }: {
  value: string;
  onPick: (v: string) => void;
  c: any;
  scale: number;
}) {
  const [group, setGroup] = useState<AvatarPresetGroup>(() => {
    // Seed the filter to the currently-selected preset's group if any.
    if (isPresetAvatar(value)) {
      const found = AVATAR_PRESETS.find((p) => `preset:${p.id}` === value);
      if (found) return found.group;
    }
    return "senior"; // Sensible default for FriendPlace's core audience.
  });

  const filtered = useMemo(
    () => AVATAR_PRESETS.filter((p) => p.group === group),
    [group],
  );

  return (
    <View style={{ gap: 10 }}>
      {/* Age filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {AVATAR_PRESET_GROUPS.map((g) => {
          const on = g.key === group;
          return (
            <Pressable
              key={g.key}
              testID={`avatar-group-${g.key}`}
              onPress={() => setGroup(g.key)}
              style={[
                styles.groupChip,
                {
                  backgroundColor: on ? c.brand : c.surfaceTertiary,
                  borderColor: on ? c.brand : c.border,
                },
              ]}
            >
              <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>
                {g.label}
              </Text>
              <Text style={{ color: on ? c.onBrandPrimary : c.muted, fontWeight: "600", fontSize: 11 * scale, marginLeft: 4 }}>
                {g.hint}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Grid */}
      <View style={styles.presetGrid}>
        {filtered.map((p) => {
          const ref = presetToAvatarString(p.id);
          const on = value === ref;
          return (
            <Pressable
              key={p.id}
              testID={`avatar-preset-${p.id}`}
              onPress={() => onPick(ref)}
              accessibilityLabel={`Choose ${p.id}`}
              style={[
                styles.presetTile,
                {
                  borderColor: on ? c.brand : c.border,
                  borderWidth: on ? 3 : 1.5,
                  backgroundColor: c.surfaceSecondary,
                },
              ]}
            >
              <Image source={p.source} style={styles.presetImage} resizeMode="cover" />
              {on ? (
                <View style={[styles.presetCheck, { backgroundColor: c.brand }]}>
                  <Ionicons name="checkmark" size={16} color={c.onBrandPrimary} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------- Upload tab ----------

function UploadTab({ value, onPick, c, scale }: {
  value: string;
  onPick: (v: string) => void;
  c: any;
  scale: number;
}) {
  const [busy, setBusy] = useState(false);
  const { base } = parseAvatar(value);
  const hasPhoto = !!(base && /^(data:|https?:)/i.test(base));

  const pick = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain === false) {
          Alert.alert(
            "Photo permission needed",
            "Please allow FriendPlace to access your photo library from Settings.",
          );
        }
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const asset = r.assets[0];
      if (asset.base64) {
        onPick(`data:image/jpeg;base64,${asset.base64}`);
      } else if (asset.uri) {
        onPick(asset.uri);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[avatar-picker] pick failed:", e);
      Alert.alert("Couldn't pick a photo", "Please try again.");
    } finally {
      setBusy(false);
    }
  }, [onPick]);

  return (
    <View style={{ gap: 12, alignItems: "center", paddingVertical: 12 }}>
      <Text style={{ color: c.muted, fontSize: 13 * scale, textAlign: "center", lineHeight: 19, paddingHorizontal: 8 }}>
        Choose a favourite photo of yourself.{"\n"}You can crop it into a circle after picking.
      </Text>
      <Pressable
        testID="avatar-upload-btn"
        onPress={pick}
        disabled={busy}
        style={[
          styles.uploadBtn,
          {
            backgroundColor: c.brand,
            opacity: busy ? 0.75 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={c.onBrandPrimary} />
        ) : (
          <>
            <Ionicons name={hasPhoto ? "sync" : "cloud-upload"} size={18} color={c.onBrandPrimary} />
            <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 15 * scale }}>
              {hasPhoto ? "Choose a different photo" : "Upload your own photo"}
            </Text>
          </>
        )}
      </Pressable>
      <Text style={{ color: c.muted, fontSize: 11 * scale, textAlign: "center", fontStyle: "italic", paddingHorizontal: 12 }}>
        Only members can see your profile photo. You can change or remove it anytime.
      </Text>
    </View>
  );
}

// ---------- Legacy emoji tab (existing behaviour preserved) ----------

function EmojiTab({ value, onPick, c, scale, compact }: {
  value: string;
  onPick: (v: string) => void;
  c: any;
  scale: number;
  compact: boolean;
}) {
  // Seed slot state from the current value where possible; otherwise
  // fall back to the first option in each list.
  const [faceKey, setFaceKey] = useState<string>(FACES[0].key);
  const [skinKey, setSkinKey] = useState<string>(SKIN[0].key);
  const [hairKey, setHairKey] = useState<string>(HAIR[0].key);
  const [glasses, setGlasses] = useState<boolean>(() => parseAvatar(value).glasses);

  const rebuilt = useMemo(
    () => buildEmojiAvatar(faceKey, skinKey, hairKey, glasses),
    [faceKey, skinKey, hairKey, glasses],
  );

  // Only push a new value up when the user is actually in the emoji tab
  // and their current avatar isn't already the same.
  useEffect(() => {
    if (rebuilt !== value) onPick(rebuilt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuilt]);

  const swatchSize = compact ? 40 : 48;

  return (
    <View style={{ gap: 10 }}>
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

      <Section title="SKIN TONE" muted={c.muted} scale={scale}>
        <View style={{ flexDirection: "row", gap: 6 }}>
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

      <Section title="HAIR" muted={c.muted} scale={scale}>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {HAIR.map((h) => {
            const on = h.key === hairKey;
            const preview = buildEmojiAvatar(faceKey, skinKey, h.key, false);
            return (
              <Pressable
                key={h.key}
                testID={`avatar-hair-${h.key}`}
                onPress={() => setHairKey(h.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.brand : c.surfaceTertiary,
                    borderColor: on ? c.brand : c.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 22 }}>{preview}</Text>
                <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>
                  {h.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="GLASSES" muted={c.muted} scale={scale}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable
            testID="avatar-glasses-off"
            onPress={() => setGlasses(false)}
            style={[styles.chip, {
              backgroundColor: !glasses ? c.brand : c.surfaceTertiary,
              borderColor: !glasses ? c.brand : c.border,
            }]}
          >
            <Text style={{ fontSize: 18 }}>—</Text>
            <Text style={{ color: !glasses ? c.onBrandPrimary : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>
              No
            </Text>
          </Pressable>
          <Pressable
            testID="avatar-glasses-on"
            onPress={() => setGlasses(true)}
            style={[styles.chip, {
              backgroundColor: glasses ? c.brand : c.surfaceTertiary,
              borderColor: glasses ? c.brand : c.border,
            }]}
          >
            <Text style={{ fontSize: 22 }}>👓</Text>
            <Text style={{ color: glasses ? c.onBrandPrimary : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>
              Glasses
            </Text>
          </Pressable>
        </View>
      </Section>
    </View>
  );
}

function Section({ title, children, muted, scale }: {
  title: string;
  children: React.ReactNode;
  muted: string;
  scale: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: muted, fontSize: 12 * scale, fontWeight: "800", letterSpacing: 0.4 }}>{title}</Text>
      {children}
    </View>
  );
}

// Re-export the withGlasses helper for callers that still toggle a glasses
// overlay outside the picker (e.g. Edit Profile).
export { withGlasses };

const styles = StyleSheet.create({
  previewRow: { flexDirection: "row", alignItems: "center" },
  previewCircle: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  previewLabel: { fontWeight: "800", letterSpacing: 0.4 },
  previewTitle: { fontWeight: "900", marginTop: 2 },

  tabRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 999,
  },

  groupChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },

  presetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "flex-start",
  },
  presetTile: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: "hidden",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  presetImage: {
    width: "100%",
    height: "100%",
    borderRadius: 44,
  },
  presetCheck: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    // subtle white halo so the tick stays readable on any preset
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
  },

  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
    minHeight: 48,
  },

  swatch: {
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
  },
});
