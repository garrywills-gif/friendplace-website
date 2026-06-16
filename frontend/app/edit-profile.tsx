import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Image, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import SuburbField from "@/src/components/SuburbField";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";

const EMOJI_AVATARS = ["\uD83E\uDD8B", "\uD83C\uDF38", "\uD83C\uDF3A", "\u2615\uFE0F", "\uD83C\uDFA8", "\uD83C\uDFB5", "\uD83C\uDFB2", "\uD83C\uDF31", "\uD83D\uDC15", "\uD83D\uDC08", "\uD83C\uDF55", "\uD83C\uDF70"];
const INTERESTS = ["Gardening", "Cooking", "Reading", "Travel", "Movies", "Music", "Walking", "Pets", "History", "Art", "Crafts", "Sports", "Family", "Volunteering", "Photography", "Bird watching"];
const GAMES = ["Jigsaw", "Trivia", "Bingo", "Word Search", "Memory Match", "Sudoku", "Spot The Difference"];

export default function ProfileEdit() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const [first_name, setFirstName] = useState(user?.first_name || "");
  const [suburb, setSuburb] = useState((user as any)?.suburb || "");
  const [bio, setBio] = useState((user as any)?.bio || "");
  const [avatar, setAvatar] = useState((user as any)?.avatar || "\uD83E\uDD8B");
  const [interests, setInterests] = useState<string[]>((user as any)?.interests || []);
  const [favourite_games, setFavGames] = useState<string[]>((user as any)?.favourite_games || []);
  const [birthday, setBirthday] = useState((user as any)?.birthday || "");
  const [privacy, setPrivacy] = useState((user as any)?.privacy_settings || { profile_visibility: "everyone", friend_requests: "everyone", show_in_find_friends: true });
  const [saving, setSaving] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);

  useEffect(() => {
    if (user) {
      setFirstName(user.first_name || "");
      setSuburb((user as any).suburb || "");
      setBio((user as any).bio || "");
      setAvatar((user as any).avatar || "\uD83E\uDD8B");
      setInterests((user as any).interests || []);
      setFavGames((user as any).favourite_games || []);
      setBirthday((user as any).birthday || "");
      if ((user as any).privacy_settings) setPrivacy((user as any).privacy_settings);
    }
  }, [user?.id]);

  const pickPhoto = async () => {
    setPickingPhoto(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { show("Photo permission needed"); return; }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: true });
      if (r.canceled || !r.assets?.[0]) return;
      const asset = r.assets[0];
      if (asset.base64) {
        const dataUri = `data:image/jpeg;base64,${asset.base64}`;
        setAvatar(dataUri);
      } else if (asset.uri) {
        setAvatar(asset.uri);
      }
    } catch (e) { console.warn(e); show("Could not pick a photo"); }
    finally { setPickingPhoto(false); }
  };

  const toggle = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await api.updateProfile(user.id, { first_name, suburb, bio, avatar, interests, favourite_games, birthday });
      await api.updatePrivacySettings(user.id, privacy);
      await refresh?.();
      show("Profile saved");
      router.back();
    } catch (e: any) {
      show("Could not save. Please try again.");
    } finally { setSaving(false); }
  };

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Edit Profile" /><Text style={{ padding: 20, color: c.onSurface }}>Please log in.</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Edit Profile" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 18 }}>
        {/* Avatar */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>PHOTO</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={[styles.avatarPreview, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
              {avatar?.startsWith("data:") || avatar?.startsWith("http") ? (
                <Image source={{ uri: avatar }} style={{ width: 92, height: 92, borderRadius: 46 }} />
              ) : (
                <AvatarBubble value={avatar} size={52} />
              )}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable testID="profile-pick-photo" onPress={pickPhoto} disabled={pickingPhoto} style={[styles.btn, { backgroundColor: c.brand }]}>
                {pickingPhoto ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="image" size={18} color="#FFF" /><Text style={styles.btnText}>Upload photo</Text></>}
              </Pressable>
            </View>
          </View>
          <Text style={[styles.section, { color: c.muted, marginTop: 14 }]}>OR PICK AN EMOJI</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {EMOJI_AVATARS.map((e) => (
              <Pressable key={e} onPress={() => setAvatar(e)} style={[styles.emojiBtn, { backgroundColor: avatar === e ? c.brand : c.surfaceTertiary, borderColor: avatar === e ? c.brand : c.border }]}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Basics */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>NAME</Text>
          <TextInput value={first_name} onChangeText={setFirstName} placeholder="Your first name" placeholderTextColor={c.muted} style={[styles.field, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceTertiary, fontSize: 16 * scale }]} />
          <Text style={[styles.section, { color: c.muted, marginTop: 12 }]}>LOCATION (OPTIONAL)</Text>
          <SuburbField
            initialValue={suburb}
            preferNotToSay={((user as any)?.location_visibility) === "private"}
            onChange={async (m, pns) => {
              if (pns) {
                setSuburb("");
                try { await api.setLocation(user.id, { prefer_not_to_say: true }); } catch {}
              } else if (m) {
                setSuburb(m.name);
                try { await api.setLocation(user.id, { suburb: m.name }); } catch {}
              }
            }}
          />
          <Text style={[styles.section, { color: c.muted, marginTop: 12 }]}>BIRTHDAY (OPTIONAL)</Text>
          <TextInput value={birthday} onChangeText={setBirthday} placeholder="YYYY-MM-DD or MM-DD" placeholderTextColor={c.muted} style={[styles.field, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceTertiary, fontSize: 16 * scale }]} />
        </View>

        {/* Bio */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>ABOUT ME</Text>
          <TextInput value={bio} onChangeText={setBio} multiline placeholder="A few words about you, your hobbies, what you'd like to chat about." placeholderTextColor={c.muted} style={[styles.field, { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceTertiary, fontSize: 16 * scale, minHeight: 100, textAlignVertical: "top" }]} maxLength={500} />
          <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 4, textAlign: "right" }}>{bio.length}/500</Text>
        </View>

        {/* Interests */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>INTERESTS</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {INTERESTS.map((i) => {
              const on = interests.includes(i);
              return (
                <Pressable key={i} testID={`interest-${i}`} onPress={() => toggle(interests, setInterests, i)} style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceTertiary, borderColor: on ? c.brand : c.border }]}>
                  <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: on ? "900" : "700", fontSize: 13 * scale }}>{i}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Favourite games */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>FAVOURITE GAMES</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {GAMES.map((g) => {
              const on = favourite_games.includes(g);
              return (
                <Pressable key={g} testID={`favgame-${g}`} onPress={() => toggle(favourite_games, setFavGames, g)} style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceTertiary, borderColor: on ? c.brand : c.border }]}>
                  <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: on ? "900" : "700", fontSize: 13 * scale }}>{g}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Privacy */}
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.section, { color: c.muted }]}>PRIVACY</Text>
          <SegmentRow label="Who can see my profile" options={[{ key: "everyone", label: "Everyone" }, { key: "friends", label: "Friends only" }]} value={privacy.profile_visibility} onChange={(v) => setPrivacy({ ...privacy, profile_visibility: v })} c={c} scale={scale} />
          <SegmentRow label="Who can send friend requests" options={[{ key: "everyone", label: "Everyone" }, { key: "friends", label: "Friends of friends" }, { key: "off", label: "Off" }]} value={privacy.friend_requests} onChange={(v) => setPrivacy({ ...privacy, friend_requests: v })} c={c} scale={scale} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 * scale, flex: 1 }}>Show me in Find Friends</Text>
            <Pressable testID="toggle-find-friends" onPress={() => setPrivacy({ ...privacy, show_in_find_friends: !privacy.show_in_find_friends })} style={[styles.toggle, { backgroundColor: privacy.show_in_find_friends ? c.brand : c.surfaceTertiary, borderColor: privacy.show_in_find_friends ? c.brand : c.border }]}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFF", marginLeft: privacy.show_in_find_friends ? 20 : 2 }} />
            </Pressable>
          </View>
        </View>

        <Pressable testID="profile-save" onPress={save} disabled={saving} style={[styles.btnSave, { backgroundColor: c.brand, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={[styles.btnText, { fontSize: 17 * scale }]}>Save changes</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SegmentRow({ label, options, value, onChange, c, scale }: any) {
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 14 * scale, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {options.map((o: any) => {
          const on = o.key === value;
          return (
            <Pressable key={o.key} onPress={() => onChange(o.key)} style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1.5, backgroundColor: on ? c.brand : c.surfaceTertiary, borderColor: on ? c.brand : c.border, alignItems: "center" }}>
              <Text style={{ color: on ? "#FFF" : c.onSurface, fontWeight: on ? "900" : "700", fontSize: 13 * scale }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontWeight: "800", fontSize: 12, letterSpacing: 0.4, marginBottom: 6 },
  card: { padding: 14, borderRadius: 18, borderWidth: 1 },
  field: { padding: 12, borderRadius: 12, borderWidth: 1 },
  avatarPreview: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  emojiBtn: { width: 50, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5 },
  toggle: { width: 44, height: 26, borderRadius: 13, borderWidth: 1.5, justifyContent: "center" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 999 },
  btnSave: { paddingVertical: 16, borderRadius: 999, alignItems: "center", marginTop: 6 },
  btnText: { color: "#FFF", fontWeight: "900", fontSize: 15 },
});
