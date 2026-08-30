/**
 * GalleryPicker — bottom-sheet picker used from the Notice Board and
 * Local Events composers to attach a photo.
 *
 * Members choose one of three paths:
 *   1. Pick a bundled FriendPlace gallery photo (33 across 11 themes)
 *   2. Upload their own photo from the device library
 *   3. Remove any currently-attached photo
 *
 * Emits a plain string via `onPick` that lives in the Notice/Event
 * `image` field:
 *   - "gallery:coffee-catchups/01"      — resolves to a bundled asset
 *   - "data:image/jpeg;base64,…"        — member-uploaded photo
 *   - ""                                — cleared
 *
 * The consumer renders the current image via `resolveImageSource` —
 * a tiny helper co-located here so every surface treats the string
 * the same way.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import {
  GALLERY_THEMES,
  galleryToImageString,
  resolveGallerySource,
  isGalleryImage,
} from "@/src/lib/gallery";

/** Resolve any image-field string to a React Native Image source. */
export function resolveImageSource(value?: string | null) {
  if (!value) return null;
  const gallery = resolveGallerySource(value);
  if (gallery) return gallery;
  if (/^(data:|https?:)/i.test(value)) return { uri: value };
  return null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with a new image-field string, or empty string to clear. */
  onPick: (imageString: string) => void;
  /** The currently-attached image string — used to highlight the
   * current pick when re-opening the sheet. */
  currentValue?: string | null;
  /** TestFlight Fix Batch 1 (Garry, Aug 2026 — P0 #2):
   * Whether to render the picker inside a native <Modal>. Default true
   * for standalone callers (e.g. New Event screen). Set to FALSE when
   * this picker is being rendered inside ANOTHER <Modal> — iOS refuses
   * to stack two Modals (the second one silently fails to present and
   * taps are swallowed, then the underlying view can freeze when the
   * outer Modal dismisses). Inline mode renders as an absolute-position
   * overlay that lives inside the parent Modal's view tree. */
  modal?: boolean;
}

export default function GalleryPicker({ visible, onClose, onPick, currentValue, modal = true }: Props) {
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    if (currentValue && isGalleryImage(currentValue)) {
      const themeKey = currentValue.replace(/^gallery:/, "").split("/")[0];
      if (GALLERY_THEMES.some((t) => t.key === themeKey)) return themeKey;
    }
    return GALLERY_THEMES[0].key;
  });
  const [uploading, setUploading] = useState(false);

  const theme = useMemo(
    () => GALLERY_THEMES.find((t) => t.key === activeTheme) || GALLERY_THEMES[0],
    [activeTheme],
  );

  const pickFromDevice = useCallback(async () => {
    setUploading(true);
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
        aspect: [3, 2],
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const asset = r.assets[0];
      if (asset.base64) {
        onPick(`data:image/jpeg;base64,${asset.base64}`);
        onClose();
      } else if (asset.uri) {
        onPick(asset.uri);
        onClose();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[gallery-picker] pick failed:", e);
      Alert.alert("Couldn't pick a photo", "Please try again.");
    } finally {
      setUploading(false);
    }
  }, [onPick, onClose]);

  const sheetBody = (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close photo picker" />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            paddingBottom: Math.max(insets.bottom + 12, 20),
          },
        ]}
      >
        {/* Grip + header */}
        <View style={styles.grip}>
          <View style={[styles.gripBar, { backgroundColor: c.border }]} />
        </View>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: c.onSurface, fontSize: 18 * scale }]}>Attach a photo</Text>
          <Pressable
            testID="gallery-close"
            onPress={onClose}
            hitSlop={12}
            style={{ padding: 6 }}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={22} color={c.muted} />
          </Pressable>
        </View>

        {/* Actions row — Upload & Remove */}
        <View style={styles.actionRow}>
          <Pressable
            testID="gallery-upload"
            onPress={pickFromDevice}
            disabled={uploading}
            style={[
              styles.actionBtn,
              {
                backgroundColor: c.brand,
                opacity: uploading ? 0.75 : 1,
              },
            ]}
          >
            {uploading ? (
              <ActivityIndicator color={c.onBrandPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={18} color={c.onBrandPrimary} />
                <Text style={{ color: c.onBrandPrimary, fontWeight: "800", fontSize: 14 * scale }}>
                  Upload your own
                </Text>
              </>
            )}
          </Pressable>
          {currentValue ? (
            <Pressable
              testID="gallery-remove"
              onPress={() => { onPick(""); onClose(); }}
              style={[styles.actionBtn, { backgroundColor: c.surfaceTertiary, borderColor: c.border, borderWidth: 1 }]}
            >
              <Ionicons name="close-circle" size={18} color={c.muted} />
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.subheading, { color: c.muted, fontSize: 12 * scale }]}>
          OR PICK A FRIENDPLACE PHOTO
        </Text>

        {/* Theme tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.themeRow}
        >
          {GALLERY_THEMES.map((t) => {
            const on = t.key === activeTheme;
            return (
              <Pressable
                key={t.key}
                testID={`gallery-theme-${t.key}`}
                onPress={() => setActiveTheme(t.key)}
                style={[
                  styles.themeChip,
                  {
                    backgroundColor: on ? c.brand : c.surfaceSecondary,
                    borderColor: on ? c.brand : c.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 15 }}>{t.emoji}</Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: on ? c.onBrandPrimary : c.onSurface,
                    fontWeight: "800",
                    fontSize: 13 * scale,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Image grid for the active theme */}
        <ScrollView style={{ flexGrow: 0, maxHeight: 340 }} contentContainerStyle={styles.imageGrid}>
          {theme.images.map((im) => {
            const ref = galleryToImageString(im.id);
            const on = currentValue === ref;
            return (
              <Pressable
                key={im.id}
                testID={`gallery-image-${im.id}`}
                onPress={() => { onPick(ref); onClose(); }}
                style={[
                  styles.imageTile,
                  {
                    borderColor: on ? c.brand : "transparent",
                    borderWidth: on ? 3 : 0,
                  },
                ]}
              >
                <Image source={im.source} style={styles.imageThumb} resizeMode="cover" />
                {on ? (
                  <View style={[styles.imageCheck, { backgroundColor: c.brand }]}>
                    <Ionicons name="checkmark" size={16} color={c.onBrandPrimary} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </>
  );

  // Inline mode: caller is already inside a <Modal> (e.g. Notice Board
  // composer). Rendering a nested <Modal> on iOS causes the second one
  // to silently fail. Render as an absolute-position overlay instead.
  if (!modal) {
    if (!visible) return null;
    return (
      <View
        pointerEvents="box-none"
        style={StyleSheet.absoluteFillObject}
        testID="gallery-picker-inline"
      >
        {sheetBody}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {sheetBody}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 12,
    maxHeight: "88%",
  },
  grip: { alignItems: "center", paddingTop: 2, paddingBottom: 6 },
  gripBar: { width: 40, height: 4, borderRadius: 2 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontWeight: "900" },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 999,
    minHeight: 44,
  },
  subheading: {
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  themeRow: {
    gap: 8,
    paddingRight: 8,
    paddingBottom: 4,
  },
  themeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    maxWidth: 260,
  },
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 8,
  },
  imageTile: {
    width: "31%",
    aspectRatio: 3 / 2,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  imageThumb: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  imageCheck: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
  },
});
