import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import VoiceInputButton from "@/src/components/VoiceInputButton";

const CAPTION_LIMIT = 500;
const MAX_PHOTOS = 6;

/**
 * Compose a new moment.
 *
 * Deliberately quiet UI: a single big caption box, an optional row of
 * photo thumbnails, a privacy toggle, and a Share button. No categories,
 * no titles, no emoji picker — the composer is designed to make sharing
 * a coffee or a walk feel as easy as thinking about it.
 */
export default function NewMoment() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();

  const [caption, setCaption] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState<"everyone" | "friends">("everyone");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const remaining = CAPTION_LIMIT - caption.length;
  const canShare = (caption.trim().length > 0 || photos.length > 0) && !saving;

  const addPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      show(`You can share up to ${MAX_PHOTOS} photos.`);
      return;
    }
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        show("Photo permission needed to add an image.");
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const uri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri || "";
      if (uri) setPhotos((arr) => [...arr, uri]);
    } catch {
      show("Couldn't pick a photo — please try again.");
    } finally {
      setPicking(false);
    }
  };

  const removePhoto = (i: number) => {
    setPhotos((arr) => arr.filter((_, idx) => idx !== i));
  };

  const share = async () => {
    if (!user || !canShare) return;
    setSaving(true);
    try {
      const r: any = await api.createMoment({
        user_id: user.id,
        caption: caption.trim(),
        photos,
        privacy,
      });
      show("Moment shared 🦋");
      // Replace so back doesn't bounce them back into the composer.
      router.replace(`/moments/${r.id}` as any);
    } catch (e: any) {
      show(e?.message || "Couldn't share your moment — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: c.border }]}>
        <Pressable
          testID="moment-new-cancel"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/moments" as any))}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Ionicons name="close" size={26} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.onSurface, fontSize: 18 * scale }]}>
          Share a Moment
        </Text>
        <Pressable
          testID="moment-new-share"
          disabled={!canShare}
          onPress={share}
          style={[
            styles.shareBtn,
            { backgroundColor: canShare ? c.brand : c.border },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 * scale }}>Share</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Prompt above the input — sets the intended tone. */}
          <Text style={{ color: c.muted, fontSize: 14 * scale, lineHeight: 20 }}>
            A photo, a story or something that made you smile today.
          </Text>

          <View style={[styles.captionWrap, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <TextInput
              testID="moment-caption"
              value={caption}
              onChangeText={(t) => setCaption(t.slice(0, CAPTION_LIMIT))}
              placeholder="What was your moment today?"
              placeholderTextColor={c.muted}
              multiline
              maxLength={CAPTION_LIMIT}
              style={{
                color: c.onSurface,
                fontSize: 16 * scale,
                lineHeight: 22,
                minHeight: 120,
                textAlignVertical: "top",
              }}
            />
            {/* Row: char count + dictate-your-moment mic. Speaking is
                far easier than typing on a phone keyboard, especially
                for older members. Locked with Garry 31 July 2026. */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <VoiceInputButton
                  value={caption}
                  onChangeText={(t) => setCaption(t.slice(0, CAPTION_LIMIT))}
                  userId={user?.id}
                  appendMode="append"
                  size={44}
                  testID="moment-caption-mic"
                />
                <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "600" }}>
                  Tap to dictate
                </Text>
              </View>
              <Text
                style={{
                  color: remaining < 40 ? "#B45309" : c.muted,
                  fontSize: 12 * scale,
                  fontWeight: "700",
                }}
              >
                {remaining} / {CAPTION_LIMIT}
              </Text>
            </View>
          </View>

          {/* Photo strip */}
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale, letterSpacing: 0.4 }}>
              PHOTOS (OPTIONAL)
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, marginTop: 8 }}
            >
              {photos.map((p, i) => (
                <View key={i} style={styles.photoBox}>
                  <Image source={{ uri: p }} style={{ width: 96, height: 96, borderRadius: 12 }} />
                  <Pressable
                    testID={`moment-photo-remove-${i}`}
                    onPress={() => removePhoto(i)}
                    style={styles.photoRemove}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  testID="moment-add-photo"
                  onPress={addPhoto}
                  disabled={picking}
                  style={[
                    styles.addPhoto,
                    { borderColor: c.border, backgroundColor: c.surfaceSecondary },
                  ]}
                >
                  {picking ? (
                    <ActivityIndicator color={c.brand} />
                  ) : (
                    <>
                      <Ionicons name="camera" size={22} color={c.brand} />
                      <Text style={{ color: c.brand, fontSize: 11 * scale, fontWeight: "800", marginTop: 4 }}>
                        Add
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </ScrollView>
          </View>

          {/* Privacy toggle */}
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale, letterSpacing: 0.4, marginBottom: 8 }}>
              WHO CAN SEE THIS
            </Text>
            <View style={{ gap: 8 }}>
              <PrivacyOption
                testID="privacy-everyone"
                active={privacy === "everyone"}
                icon="earth"
                title="Everyone on FriendPlace"
                sub="Any member can see, like or comment"
                onPress={() => setPrivacy("everyone")}
              />
              <PrivacyOption
                testID="privacy-friends"
                active={privacy === "friends"}
                icon="people"
                title="Friends only"
                sub="Only members you've added as friends"
                onPress={() => setPrivacy("friends")}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function PrivacyOption({
  active,
  icon,
  title,
  sub,
  onPress,
  testID,
}: {
  active: boolean;
  icon: any;
  title: string;
  sub: string;
  onPress: () => void;
  testID?: string;
}) {
  const { c, scale } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.privacyRow,
        {
          borderColor: active ? c.brand : c.border,
          backgroundColor: active ? c.brandTertiary : c.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={22} color={active ? c.brand : c.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>{sub}</Text>
      </View>
      <Ionicons
        name={active ? "radio-button-on" : "radio-button-off"}
        size={22}
        color={active ? c.brand : c.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  headerBtn: { flexDirection: "row", alignItems: "center", padding: 6, height: 40 },
  headerTitle: { fontWeight: "900", letterSpacing: 0.2 },
  shareBtn: {
    paddingHorizontal: 20,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
  },
  captionWrap: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  photoBox: { position: "relative" },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1F2937",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
});
