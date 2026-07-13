import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView,
  Platform, Pressable, Image, ActivityIndicator, Modal, Linking, Keyboard,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";
import CoffeeTableSeating from "@/src/components/CoffeeTableSeating";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";
import ZoomableImageViewer from "@/src/components/ZoomableImageViewer";
import VoiceInputButton from "@/src/components/VoiceInputButton";

type Msg = {
  id: string;
  user_id: string;
  user_name?: string;
  avatar?: string;
  text?: string;
  image?: string;
  user_is_founder?: boolean;
  user_founder_number?: number | null;
  /** Local-only marker for join/leave system messages so we can render
   *  them as centered pill chips rather than chat bubbles. Never sent
   *  to the backend. */
  system?: boolean;
};

export default function TableChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale, prefs } = useTheme();
  const { user, token } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [table, setTable] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [seated, setSeated] = useState<any[]>([]);
  const [draftImage, setDraftImage] = useState<string | null>(null); // base64 preview before sending
  const [picking, setPicking] = useState(false);
  // Collapse the table-seating diagram whenever the on-screen keyboard is
  // open OR the user is actively composing. Reclaiming that vertical space
  // gives the chat feed the whole screen so the newest messages sit right
  // above the keyboard — matches native iOS Messages/WhatsApp behaviour.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKbOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKbOpen(false),
    );
    return () => { show.remove(); hide.remove(); };
  }, []);
  const collapseSeating = kbOpen || text.length > 0;
  const [zoom, setZoom] = useState<string | null>(null); // full-screen image viewer
  const [permBlocked, setPermBlocked] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const t = await api.getTable(id);
      setTable(t); setSeated(t.seated_users || []);
      const msgs = await api.tableMessages(id);
      setMessages(msgs);
    })();
    const ws = new WebSocket(wsUrl(`/ws/table/${id}?user_id=${user.id}&token=${encodeURIComponent(token || "")}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "message") {
        setMessages((m) => [...m, data.message]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      } else if (data.type === "presence") {
        setSeated((s) => {
          if (!data.user) return s;
          if (data.event === "join") return s.find((u: any) => u.id === data.user.id) ? s : [...s, data.user];
          return s.filter((u: any) => u.id !== data.user.id);
        });
        // Insert a local-only "system message" so the chat feed shows a
        // gentle "Garry took a seat" / "Garry left the table" chip — the
        // same social cue you'd get sitting at a real cafe. The backend
        // isn't persisting these, so we key on user id + event + a coarse
        // 5s bucket to dedupe against duplicate WS broadcasts.
        if (data.user && (data.event === "join" || data.event === "leave")) {
          const first = data.user.first_name || data.user.name || "Someone";
          const bucket = Math.floor(Date.now() / 5000);
          const sysId = `sys:${data.user.id}:${data.event}:${bucket}`;
          const line = data.event === "join"
            ? `🪑 ${first} took a seat`
            : `👋 ${first} left the table`;
          setMessages((m) => (m.some((x) => x.id === sysId) ? m : [...m, { id: sysId, user_id: "system", system: true, text: line } as Msg]));
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
        }
      } else if (data.type === "error") {
        show(data.message || "Send failed");
      }
    };
    return () => { ws.close(); if (user && id) api.leaveTable(id, user.id).catch(() => {}); };
  }, [id, user?.id]);

  const send = () => {
    const t = text.trim();
    if ((!t && !draftImage) || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: t, image: draftImage || "" }));
    setText(""); setDraftImage(null);
  };

  /**
   * Open the device photo library, compress the picked image to a small JPEG
   * data-URI, and stage it as a draft so the user can review (and optionally
   * add a caption) before sending. Follows the FriendPlace permission contract:
   * pre-request explanation is handled by the OS picker prompt for photos —
   * we only ever need read-only access to a single picked item, which is the
   * "ph_picker"-grade permission on iOS 14+ and Android 13+.
   */
  const pickPhoto = async () => {
    if (picking) return;
    setPicking(true);
    try {
      // On web Image Picker doesn't need permissions; on native it asks.
      if (Platform.OS !== "web") {
        const p = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (p.status !== "granted") {
          const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (r.status !== "granted") {
            if (!r.canAskAgain) setPermBlocked(true);
            else show("Photo permission needed to share images");
            return;
          }
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
        base64: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      // Resize to a max long-edge of 1200 and re-encode as JPEG ~70% so we
      // stay well under the backend's 600 KB cap on base64 payloads.
      const longEdge = Math.max(asset.width || 1, asset.height || 1);
      const targetW = (asset.width && (asset.width >= asset.height) && longEdge > 1200) ? 1200 : undefined;
      const targetH = (asset.height && (asset.height > (asset.width || 0)) && longEdge > 1200) ? 1200 : undefined;
      const actions: ImageManipulator.Action[] = [];
      if (targetW) actions.push({ resize: { width: targetW } });
      else if (targetH) actions.push({ resize: { height: targetH } });
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (!out.base64) { show("Couldn't read photo"); return; }
      const dataUri = `data:image/jpeg;base64,${out.base64}`;
      // Guard against any too-large outliers (10:1 base64 vs file is the worst-case).
      if (dataUri.length > 580_000) {
        show("Photo too large — try a smaller one");
        return;
      }
      setDraftImage(dataUri);
    } catch (e) {
      show("Couldn't open photo library");
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={table ? `${table.emoji} ${table.name}` : "Table"} />
      {collapseSeating ? (
        // Compact strip — keeps seated members visible even while the user
        // is typing so it still feels like a conversation with faces, not
        // a text screen with no context. The full seating diagram returns
        // as soon as the keyboard is dismissed and the composer is empty.
        <View style={[styles.compactStrip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]} testID="table-seating-compact">
          <Text style={{ fontSize: 22, marginRight: 8 }}>{table?.emoji || "☕"}</Text>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
            {seated.slice(0, 8).map((u: any) => (
              <View key={u.id} style={{ alignItems: "center", marginRight: 4 }}>
                <AvatarBubble value={u.avatar} size={30} fallback="🙂" />
              </View>
            ))}
            {seated.length === 0 && (
              <Text style={{ color: c.muted, fontSize: 13 * scale, fontStyle: "italic" }}>
                You&apos;re the first here — say hi!
              </Text>
            )}
            {seated.length > 8 && (
              <View style={[styles.moreChip, { backgroundColor: c.brandTertiary }]}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale }}>+{seated.length - 8}</Text>
              </View>
            )}
          </View>
          <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700", marginLeft: 6 }}>
            {seated.length}/8
          </Text>
        </View>
      ) : (
        <CoffeeTableSeating
          seated={seated}
          tableEmoji={table?.emoji || "☕"}
          testID="table-seating"
          // Compact size inside the chat view so the conversation feed
          // sits up close to the table diagram and the screen feels more
          // active & social (full 360 footprint is reserved for the
          // table-listing screen where seating is the hero). Hidden while
          // the keyboard is up so the chat gets the whole screen.
          maxSize={260}
        />
      )}

      {/* Crossword shortcut — only on the Daily Crossword table. Lets
          players jump back and forth between solving the puzzle and
          chatting about it without losing their place. Tap-to-play opens
          the daily puzzle deep-link directly. */}
      {table?.daily_crossword ? (
        <Pressable
          testID="table-open-crossword"
          onPress={() => router.push("/games/crossword/play?daily=1" as any)}
          accessibilityRole="button"
          accessibilityLabel="Open today's crossword"
          style={({ pressed }) => [
            styles.xwordCta,
            {
              backgroundColor: "#1B7A8A",
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.xwordIconBubble}>
            <Text style={{ fontSize: 22 }}>✏️</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 17 * scale, letterSpacing: 0.2 }}>
              Open Today&apos;s Crossword
            </Text>
            <Text style={{ color: "#BAE6FD", fontWeight: "700", fontSize: 13 * scale, marginTop: 2 }}>
              Pick up where you left off · share clues with the table
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 14 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            // Local-only system messages ("🪑 Garry took a seat") render
            // as centred pill chips so they don't get confused with real
            // chat bubbles.
            if (item.system) {
              return (
                <View style={styles.systemRow}>
                  <View style={[styles.systemPill, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                    <Text style={{ color: c.brand, fontWeight: "800", fontSize: 13 * scale }}>{item.text}</Text>
                  </View>
                </View>
              );
            }
            const mine = item.user_id === user?.id;
            const hasImg = !!item.image;
            return (
              <View style={[styles.msgRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                {!mine && <AvatarBubble value={item.avatar} size={24} fallback="🙂" />}
                <View style={[styles.bubble, { backgroundColor: mine ? c.brand : c.surfaceSecondary, borderColor: c.border, borderBottomLeftRadius: mine ? 18 : 4, borderBottomRightRadius: mine ? 4 : 18, padding: hasImg ? 6 : 12 }]}>
                  {!mine && !hasImg && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Text style={[styles.author, { color: c.muted, fontSize: 13 * scale }]}>{item.user_name}</Text>
                      <FounderMark isFounder={item.user_is_founder} founderNumber={item.user_founder_number} size={12} />
                    </View>
                  )}
                  {hasImg && (
                    <Pressable testID={`msg-img-${item.id}`} onPress={() => setZoom(item.image!)}>
                      {!mine && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingTop: 6 }}>
                          <Text style={[styles.authorOnImg, { fontSize: 13 * scale }]}>{item.user_name}</Text>
                          <FounderMark isFounder={item.user_is_founder} founderNumber={item.user_founder_number} size={12} />
                        </View>
                      )}
                      <Image source={{ uri: item.image! }} style={styles.msgImage} resizeMode="cover" />
                    </Pressable>
                  )}
                  {!!item.text && (
                    <Text style={[styles.body, { color: mine ? "#FFF" : c.onSurface, fontSize: 16 * scale, paddingHorizontal: hasImg ? 6 : 0, paddingTop: hasImg ? 6 : 0, paddingBottom: hasImg ? 4 : 0 }]}>{item.text}</Text>
                  )}
                </View>
              </View>
            );
          }}
        />

        {draftImage && (
          <View style={[styles.draftBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Image source={{ uri: draftImage }} style={styles.draftThumb} resizeMode="cover" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>Photo ready to send</Text>
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>Add a caption below (optional)</Text>
            </View>
            <Pressable testID="draft-remove" onPress={() => setDraftImage(null)} hitSlop={10} style={[styles.draftClose, { backgroundColor: c.error }]}>
              <Ionicons name="close" size={18} color="#FFF" />
            </Pressable>
          </View>
        )}

        <View style={[styles.composer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Pressable
            testID="table-photo"
            onPress={pickPhoto}
            disabled={picking}
            accessibilityLabel="Add a photo"
            style={({ pressed }) => [styles.photoBtn, { backgroundColor: c.surfaceTertiary, opacity: pressed || picking ? 0.6 : 1 }]}
          >
            {picking ? <ActivityIndicator color={c.brand} size="small" /> : <Ionicons name="image" size={24} color={c.brand} />}
          </Pressable>
          <TextInput
            testID="table-input"
            value={text}
            onChangeText={setText}
            placeholder={draftImage ? "Add a caption…" : "Say something kind…"}
            placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.onSurface, fontSize: 17 * scale, paddingVertical: 10, paddingHorizontal: 12 }}
            multiline
            onSubmitEditing={send}
          />
          {/* Tap-to-dictate mic — sits between the input and the send
              button so users can naturally: type OR speak, then hit
              send. On short taps the transcribed text is appended to
              whatever's already there, so half-typed messages don't get
              lost. Gated on the Accessibility → Voice input pref so
              users who prefer typing can switch it off. */}
          {prefs.voiceInputEnabled && (
            <VoiceInputButton
              testID="table-voice"
              value={text}
              onChangeText={setText}
              userId={user?.id}
              onError={show}
              size={40}
            />
          )}
          <Pressable testID="table-send" onPress={send} style={[styles.sendBtn, { backgroundColor: c.brand }]}>
            <Ionicons name="send" size={20} color="#FFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Full-screen zoomable image viewer — pinch / pan / double-tap. */}
      <ZoomableImageViewer uri={zoom} onClose={() => setZoom(null)} testID="table-zoom-viewer" />

      {/* Permanent-deny → open device Settings */}
      <Modal visible={permBlocked} transparent animationType="fade" onRequestClose={() => setPermBlocked(false)}>
        <View style={styles.permBg}>
          <View style={[styles.permCard, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 36 }}>📷</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginTop: 6, textAlign: "center" }}>Photo access blocked</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center", lineHeight: 22 }}>
              To share photos in the Coffee Lounge, allow FriendPlace access to your photos in Settings.
            </Text>
            <Pressable onPress={() => { setPermBlocked(false); Linking.openSettings(); }} style={[styles.permBtn, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Open Settings</Text>
            </Pressable>
            <Pressable onPress={() => setPermBlocked(false)} style={[styles.permBtn, { borderColor: c.border, borderWidth: 1.5, marginTop: 6 }]}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Prominent "Open Today's Crossword" CTA — only renders on the daily
  // crossword table. Sits between the seating diagram and the chat feed
  // so it's the first action your thumb finds, encouraging the
  // solve ↔ chat ↔ solve loop the lounge is built for.
  xwordCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    minHeight: 64,
  },
  xwordIconBubble: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  av: { fontSize: 24 },
  bubble: { maxWidth: "76%", borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  author: { fontWeight: "700", marginBottom: 2 },
  authorOnImg: { fontWeight: "700", marginBottom: 4, marginTop: 2, marginLeft: 6, color: "#475569" },
  body: { fontWeight: "500" },
  msgImage: { width: 240, height: 240, borderRadius: 12, backgroundColor: "#E2E8F0" },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 8, borderTopWidth: 1, gap: 8 },
  photoBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  draftBar: { flexDirection: "row", alignItems: "center", padding: 10, borderTopWidth: 1, gap: 6 },
  draftThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#E2E8F0" },
  draftClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  permBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  permCard: { width: "100%", maxWidth: 420, borderRadius: 20, padding: 22, alignItems: "center" },
  permBtn: { marginTop: 14, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  // Compact seated strip shown when the keyboard is up or the composer
  // has text. Keeps faces visible so it still feels social.
  compactStrip: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 52,
  },
  moreChip: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  // System messages ("🪑 Garry took a seat") — centred pill so they
  // read as ambient presence chatter rather than a message.
  systemRow: {
    alignItems: "center",
    marginVertical: 2,
  },
  systemPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
