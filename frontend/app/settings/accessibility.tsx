import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Modal, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Speech from "expo-speech";
import { useTheme, ThemePrefs } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import { loadFavourites, toggleFavourite } from "@/src/lib/thoughts";

type RowDef = {
  key: keyof ThemePrefs;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  note?: string;
};

const ROWS: RowDef[] = [
  { key: "readMessagesAloud", title: "Read messages aloud", desc: "Show a speaker icon beside messages, posts and Today's Thought so you can tap to hear them.", icon: "volume-high" },
  { key: "autoReadNewMessages", title: "Auto-read new messages", desc: "Automatically speak incoming chat messages as they arrive.", icon: "chatbubble-ellipses" },
  { key: "largeText", title: "Larger text mode", desc: "Increase the size of text across the app for easier reading.", icon: "text" },
  { key: "highContrast", title: "High contrast mode", desc: "Stronger colours and bolder borders to help low-vision users.", icon: "contrast" },
  { key: "simplified", title: "Simplified mode", desc: "Larger buttons and more breathing room; reduces visual clutter.", icon: "layers" },
  // Voice typing — we lean on the device's own keyboard dictation, which
  // works out of the box on iPhone, iPad and Android. Our in-app mic button
  // is a separate, richer "tap to talk" panel still in design (no backend
  // service required for the keyboard route — keeps costs at zero).
  {
    key: "voiceInputEnabled",
    title: "Voice typing",
    desc: "Tap any message box, then tap the 🎤 on your device's keyboard to dictate instead of typing. Works on iPhone, iPad and Android.",
    icon: "mic",
    note: "Coming Soon — an extra in-app microphone button with live transcription. Until then, your keyboard's microphone works everywhere in FriendPlace.",
  },
];

export default function Accessibility() {
  const router = useRouter();
  const { c, scale, prefs, setPref } = useTheme();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [favsOpen, setFavsOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => { (async () => setFavs(await loadFavourites()))(); }, [favsOpen]);

  const sample = "You belong here. This is what reading aloud sounds like on your device.";
  const playSample = () => {
    Speech.stop();
    Speech.speak(sample, { language: "en-US", rate: 0.95, pitch: 1.02 });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Accessibility" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={[styles.intro, { color: c.onSurfaceSecondary, fontSize: 16 * scale }]}>
          Make FriendPlace easier to see, hear and use. These settings are saved on this device.
        </Text>

        {ROWS.map((r) => {
          const v = !!prefs[r.key];
          return (
            <View key={r.key} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <View style={[styles.iconBox, { backgroundColor: c.brandTertiary }]}>
                <Ionicons name={r.icon} size={22} color={c.brand} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.rowTitle, { color: c.onSurface, fontSize: 17 * scale }]}>{r.title}</Text>
                <Text style={[styles.rowDesc, { color: c.muted, fontSize: 14 * scale }]}>{r.desc}</Text>
                {r.note && <Text style={[styles.rowNote, { color: c.warning, fontSize: 12 * scale }]}>{r.note}</Text>}
              </View>
              <Switch
                testID={`acc-toggle-${r.key}`}
                value={v}
                onValueChange={(nv) => { setPref(r.key, nv); show(`${r.title} ${nv ? "on" : "off"}`); }}
                trackColor={{ true: c.brand, false: c.border }}
                thumbColor={"#FFFFFF"}
              />
            </View>
          );
        })}

        <View style={[styles.sampleCard, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={styles.sampleHead}>
            <Ionicons name="musical-notes" size={20} color={c.brand} />
            <Text style={[styles.sampleTitle, { color: c.brand, fontSize: 15 * scale }]}>HEAR HOW READING ALOUD SOUNDS</Text>
          </View>
          <Text style={[styles.sampleText, { color: c.onSurface, fontSize: 16 * scale }]}>{sample}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
            <Pressable testID="acc-sample-play" onPress={playSample} style={[styles.playBtn, { backgroundColor: c.brand }]}>
              <Ionicons name="play" size={18} color={"#FFFFFF"} />
              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 15 * scale }}>Play sample</Text>
            </Pressable>
            <SpeakButton text={sample} color={c.brand} bg={c.surfaceSecondary} size={22} testID="acc-sample-speak" />
          </View>
        </View>

        <Pressable testID="acc-open-favs" onPress={() => setFavsOpen(true)} style={[styles.favsLink, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Ionicons name="heart" size={22} color={c.error} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 17 * scale }}>Favourite thoughts ({favs.length})</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>Tap the heart on Today's Thought to save your favourites.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.muted} />
        </Pressable>
      </ScrollView>

      <Modal visible={favsOpen} animationType="slide" transparent onRequestClose={() => setFavsOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface }]}>
            <View style={styles.modalHead}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale }}>Favourite thoughts</Text>
              <Pressable onPress={() => setFavsOpen(false)} hitSlop={8} style={{ padding: 6 }}>
                <Ionicons name="close" size={26} color={c.onSurface} />
              </Pressable>
            </View>
            <FlatList
              data={favs}
              keyExtractor={(t, i) => `${i}-${t}`}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              ListEmptyComponent={() => (
                <Text style={{ color: c.muted, fontSize: 15 * scale, paddingVertical: 20, textAlign: "center" }}>
                  No favourites yet. Tap the heart on Today's Thought.
                </Text>
              )}
              renderItem={({ item }) => (
                <View style={[styles.favRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontSize: 16 * scale, flex: 1 }}>{item}</Text>
                  <SpeakButton text={item} color={c.brand} size={20} />
                  <Pressable onPress={async () => {
                    const r = await toggleFavourite(item);
                    setFavs(r.favourites);
                  }} hitSlop={8} style={{ padding: 6 }}>
                    <Ionicons name="trash" size={18} color={c.muted} />
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 10 },
  intro: { fontWeight: "500", marginBottom: 6, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 18, borderWidth: 1 },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontWeight: "800" },
  rowDesc: { marginTop: 2, lineHeight: 19 },
  rowNote: { marginTop: 4, fontWeight: "700" },
  sampleCard: { marginTop: 14, borderRadius: 18, padding: 14, borderWidth: 1.5 },
  sampleHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sampleTitle: { fontWeight: "900", letterSpacing: 0.6 },
  sampleText: { fontWeight: "600", marginTop: 8, lineHeight: 24 },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  favsLink: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1, marginTop: 10 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "80%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  favRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, gap: 6 },
});
