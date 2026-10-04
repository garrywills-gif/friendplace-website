import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView,
  Platform, Pressable, Image, ActivityIndicator, Modal, Linking, Keyboard, ScrollView,
  AppState,
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
import SpeakButton from "@/src/components/SpeakButton";
import AvatarWithBadge from "@/src/components/status/AvatarWithBadge";
import FounderMark from "@/src/components/FounderMark";
import ZoomableImageViewer from "@/src/components/ZoomableImageViewer";
import VoiceInputButton from "@/src/components/VoiceInputButton";
import CafeLookingBanner from "@/src/components/status/CafeLookingBanner";
import { useComposerLock } from "@/src/lib/composer-lock";

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
  const [notFound, setNotFound] = useState(false);
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
  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock whenever the member has typed something, queued a photo, or
  // the keyboard is open — so the GlobalDmPrompt defers to the next
  // poll cycle instead of interrupting them. Recording is covered
  // separately by VoiceInputButton's own lock.
  useComposerLock(text.length > 0 || draftImage !== null || kbOpen);
  const [zoom, setZoom] = useState<string | null>(null); // full-screen image viewer
  const [permBlocked, setPermBlocked] = useState(false);
  // Creator controls: manage sheet + edit form. Only the host of a
  // non-permanent table sees these (see `isHost` below).
  const [manageOpen, setManageOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState("");
  const [eEmoji, setEEmoji] = useState("☕");
  const [eDesc, setEDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const isHost = !!(user?.id && table && table.host_id === user.id && !table.protected && !table.persistent);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!id || !user) return;
    let closed = false;             // set when the screen unmounts — stops reconnects
    let reconnectTimer: any = null;
    let backoff = 1000;             // start at 1s, double on each failure (cap 15s)
    const seenIds = new Set<string>(); // de-dupe across refetches + socket pushes

    // Hoist the message loader so both the initial fetch and every WS
    // (re)open can call it — the WS was previously only loading history
    // on first mount, so any message sent while the socket was dead
    // (iOS backgrounding, network blip, server restart) never appeared
    // on this device until the user manually left and rejoined.
    // iter232 (Neo, Oct 2026 — RED #2): FP Café / Xanda's-table
    // regression where messages sent on the iPad didn't appear on the
    // phone — the phone's socket had quietly died and nothing was
    // refetching history on reconnect.
    const loadMessages = async () => {
      try {
        const msgs: Msg[] = await api.tableMessages(id);
        const merged: Msg[] = [];
        for (const m of msgs) {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); merged.push(m); }
        }
        setMessages((prev) => {
          // Merge server history with any newer local-only system
          // chips (join/leave) we may have added since.
          const sysOnly = prev.filter((p) => p.system && !seenIds.has(p.id));
          return [...merged, ...sysOnly];
        });
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
      } catch { /* transient — keep current state */ }
    };

    (async () => {
      try {
        const t = await api.getTable(id);
        setTable(t); setSeated(t.seated_users || []);
      } catch {
        // Table was closed/deleted by its host, or never existed. Show a
        // friendly "this table has closed" state instead of a blank screen
        // (real-device fix #4: tapping an invite to a closed table).
        setNotFound(true);
        return;
      }
      await loadMessages();
    })();

    let seatTimer: any = null;
    const openSocket = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl(`/ws/table/${id}?user_id=${user.id}&token=${encodeURIComponent(token || "")}`));
      wsRef.current = ws;
      // Authoritative seat reconcile — the presence events give instant
      // feedback, but join/leave/reconnect/background can desync the count
      // across devices (real-device fix #5). Re-pull the server's seated list
      // on (re)connect and on a light interval so every device converges.
      const reconcileSeats = async () => {
        try {
          const t = await api.getTable(id);
          setSeated(t.seated_users || []);
          setTable((prev: any) => (prev ? { ...prev, ...t } : t));
        } catch { /* transient — keep current state */ }
      };
      ws.onopen = () => {
        backoff = 1000;              // reset backoff on successful (re)connect
        reconcileSeats();
        // CRITICAL: refetch history on every (re)open so messages sent
        // while this device's socket was dead are never missed.
        loadMessages();
      };
      if (seatTimer) clearInterval(seatTimer);
      seatTimer = setInterval(reconcileSeats, 15000);
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.type === "message") {
          // De-dupe by message id — reconnect/refetch/double-broadcast must
          // never render the same message twice (real-device fix #6).
          if (data.message && !seenIds.has(data.message.id)) {
            seenIds.add(data.message.id);
            setMessages((m) => [...m, data.message]);
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
          }
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
            if (!seenIds.has(sysId)) {
              seenIds.add(sysId);
              setMessages((m) => [...m, { id: sysId, user_id: "system", system: true, text: line } as Msg]);
              setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
            }
          }
        } else if (data.type === "error") {
          show(data.message || "Send failed");
        }
      };
      ws.onclose = () => {
        if (closed) return;
        // Exponential-backoff reconnect — covers iOS background kills,
        // Wi-Fi drops, server restarts. loadMessages() runs again on the
        // next onopen so no message is permanently missed.
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, 15000);
          openSocket();
        }, backoff);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };
    openSocket();

    // iter232 (Neo, Oct 2026 — RED #2): iOS kills the WS when the app
    // backgrounds; `onclose` may not fire until the user foregrounds,
    // so proactively kick a reconnect + history refetch the moment the
    // app becomes active again. Covers "I opened my phone and nothing
    // new had come through from the iPad."
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        openSocket();
      } else {
        // Socket still OPEN — just catch up on anything we might have
        // missed while backgrounded.
        loadMessages();
      }
    });

    return () => {
      closed = true;
      appStateSub.remove();
      if (seatTimer) clearInterval(seatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* noop */ }
      if (user && id) api.leaveTable(id, user.id).catch(() => {});
    };
  }, [id, user?.id]);

  const send = () => {
    const t = text.trim();
    if ((!t && !draftImage) || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: t, image: draftImage || "" }));
    setText(""); setDraftImage(null);
  };

  const openEdit = () => {
    setEName(table?.name || "");
    setEEmoji(table?.emoji || "☕");
    setEDesc(table?.description || "");
    setManageOpen(false);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!user || !id || !eName.trim()) { show("Give your table a name"); return; }
    setSavingEdit(true);
    try {
      const updated = await api.updateTable(id, { host_id: user.id, name: eName.trim(), emoji: eEmoji, description: eDesc });
      setTable((prev: any) => ({ ...prev, ...updated }));
      setEditOpen(false);
      show("Table updated");
    } catch { show("Could not update table"); }
    finally { setSavingEdit(false); }
  };

  const confirmClose = () => {
    setManageOpen(false);
    setCloseConfirm(true);
  };

  const doClose = async () => {
    if (!user || !id) return;
    setClosing(true);
    try {
      await api.deleteTable(id, user.id);
      try { wsRef.current?.close(); } catch { /* noop */ }
      setCloseConfirm(false);
      show("Table closed");
      router.replace("/lounge" as any);
    } catch { show("Could not close table"); }
    finally { setClosing(false); }
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
      {notFound ? (
        <>
          <Header title="Table" />
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
            <Text style={{ fontSize: 52 }}>☕</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, textAlign: "center" }}>This table has closed</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, textAlign: "center", lineHeight: 22 }}>
              The host wrapped up this chat. Plenty of other tables are open in the FP Café — come find a seat.
            </Text>
            <Pressable
              testID="table-closed-back"
              onPress={() => router.replace("/lounge" as any)}
              style={({ pressed }) => [{ marginTop: 8, backgroundColor: c.brand, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 999, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Back to FP Café</Text>
            </Pressable>
          </View>
        </>
      ) : (
      <>
      <Header
        title={table ? `${table.emoji} ${table.name}` : "Table"}
        right={isHost ? (
          <Pressable
            testID="table-manage-btn"
            onPress={() => setManageOpen(true)}
            hitSlop={12}
            accessibilityLabel="Manage your table"
            style={({ pressed }) => [styles.manageBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={c.onSurface} />
          </Pressable>
        ) : undefined}
      />
      {/* Presence & Status — global "Looking for a chat" banner. Sits
          above seating so a chatter's invitation is the first social
          signal a visitor sees. Auto-hides when the list is empty.
          Design ref: §5.2 in /app/memory/design-presence-and-status.md. */}
      <CafeLookingBanner currentTableId={typeof id === "string" ? id : undefined} />
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
                <AvatarWithBadge
                  value={u.avatar}
                  userId={u.id}
                  size={30}
                  fallback="🙂"
                  isSelf={u.id === user?.id}
                />
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

      {/* Invitee roster (host-facing) — who the host invited and whether
          each has joined, is still pending, or declined. Only the host
          sees this, and only when the seating diagram is expanded so it
          never competes with the keyboard/composer. */}
      {!collapseSeating && isHost && Array.isArray(table?.invitees) && table.invitees.length > 0 ? (
        <View style={[styles.inviteeWrap, { borderColor: c.border }]} testID="table-invitees">
          <Text style={[styles.inviteeTitle, { color: c.muted }]}>YOU INVITED</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 12 }}>
            {table.invitees.map((inv: any) => {
              const st = inv.status;
              const pill =
                st === "joined" ? { bg: "#DCFCE7", fg: "#15803D", label: "Joined" }
                : st === "declined" ? { bg: "#FEE2E2", fg: "#B91C1C", label: "Declined" }
                : { bg: c.surfaceTertiary, fg: c.muted, label: "Invited" };
              return (
                <View key={inv.id} style={styles.inviteeChip} testID={`invitee-${inv.id}`}>
                  <AvatarBubble value={inv.avatar} size={34} fallback="🙂" />
                  <Text numberOfLines={1} style={[styles.inviteeName, { color: c.onSurface, fontSize: 12 * scale }]}>{inv.first_name}</Text>
                  <View style={[styles.inviteePill, { backgroundColor: pill.bg }]}>
                    <Text numberOfLines={1} style={{ color: pill.fg, fontWeight: "800", fontSize: 10.5 * scale }}>{pill.label}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

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
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 20 }}
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
                {/* Manual read-aloud on every café message (accessibility) —
                    tap to hear it. Never auto-plays. (Garry, 1031.) */}
                {!!item.text && (
                  <SpeakButton
                    text={item.user_name ? `${item.user_name} says. ${item.text}` : item.text}
                    color={c.muted}
                    bg={c.surfaceTertiary}
                    size={18}
                    testID={`cafe-speak-${item.id}`}
                  />
                )}
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

        {/* Round-8 polish (Garry, Jun 2026 #4d): composer restructured
            to mirror George Event Creation exactly — the input and mic
            sit inside a rounded pill, the photo attach button lives
            OUTSIDE the pill on the left. Same paddings, same gap, same
            teal mic colour so members get one visual language across
            every composer in the app. */}
        <View style={[styles.composerRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Pressable
            testID="table-photo"
            onPress={pickPhoto}
            disabled={picking}
            accessibilityLabel="Add a photo"
            style={({ pressed }) => [styles.photoBtn, { backgroundColor: c.surfaceTertiary, opacity: pressed || picking ? 0.6 : 1 }]}
          >
            {picking ? <ActivityIndicator color={c.brand} size="small" /> : <Ionicons name="image" size={24} color={c.brand} />}
          </Pressable>
          <View style={[styles.composerPill, { backgroundColor: c.surfaceSecondary }]}>
            <TextInput
              testID="table-input"
              value={text}
              onChangeText={setText}
              placeholder={draftImage ? "Add a caption…" : "Say something kind…"}
              placeholderTextColor={c.muted}
              style={[styles.pillInput, { color: c.onSurface, fontSize: 15 * scale }]}
              multiline
              onSubmitEditing={send}
            />
            {/* TestFlight round-7 (Garry, Feb 2026 #20): unified mic/send
                toggle via shared VoiceInputButton. Empty text → mic; text
                → send. Matches George's composer 1:1. */}
            <VoiceInputButton
              testID="table-voice"
              sendTestID="table-send"
              value={text}
              onChangeText={setText}
              userId={user?.id}
              onError={show}
              size={42}
              onSend={send}
              voiceEnabled={prefs.voiceInputEnabled}
            />
          </View>
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
              To share photos in the FP Café, allow FriendPlace access to your photos in Settings.
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
      {/* Creator manage sheet — Edit / Close */}
      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={() => setManageOpen(false)}>
        <Pressable style={styles.manageBg} onPress={() => setManageOpen(false)}>
          <Pressable style={[styles.manageSheet, { backgroundColor: c.surface }]} onPress={(e: any) => e.stopPropagation && e.stopPropagation()}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginBottom: 4 }}>Manage your table</Text>
            <Pressable testID="table-edit-open" onPress={openEdit} style={({ pressed }) => [styles.manageItem, { backgroundColor: c.surfaceSecondary, opacity: pressed ? 0.8 : 1 }]}>
              <Ionicons name="create-outline" size={22} color={c.brand} />
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Edit table</Text>
            </Pressable>
            <Pressable testID="table-close-open" onPress={confirmClose} style={({ pressed }) => [styles.manageItem, { backgroundColor: "#FEE2E2", opacity: pressed ? 0.8 : 1 }]}>
              <Ionicons name="trash-outline" size={22} color="#DC2626" />
              <Text style={{ color: "#DC2626", fontWeight: "800", fontSize: 16 * scale }}>Close / delete table</Text>
            </Pressable>
            <Pressable onPress={() => setManageOpen(false)} style={[styles.manageItem, { justifyContent: "center" }]}>
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 16 * scale }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit table form */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.editWrap}>
          <View style={[styles.editSheet, { backgroundColor: c.surface }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale }}>Edit table</Text>
              <Pressable onPress={() => setEditOpen(false)} hitSlop={10}><Ionicons name="close" size={24} color={c.onSurface} /></Pressable>
            </View>
            <View style={styles.editEmojiRow}>
              {["☕", "🌱", "📚", "🐾", "🎨", "🔨", "🏠", "👋"].map((e) => (
                <Pressable key={e} onPress={() => setEEmoji(e)} style={[styles.editEmojiPick, { backgroundColor: eEmoji === e ? c.brandTertiary : c.surfaceSecondary, borderColor: eEmoji === e ? c.brand : c.border }]}>
                  <Text style={{ fontSize: 24 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="table-edit-name" value={eName} onChangeText={setEName} placeholder="Table name" placeholderTextColor={c.muted} style={[styles.editInput, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 18 * scale }]} />
            <TextInput testID="table-edit-desc" value={eDesc} onChangeText={setEDesc} placeholder="Short description" placeholderTextColor={c.muted} style={[styles.editInput, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale, height: 80 }]} multiline />
            <Pressable testID="table-edit-save" onPress={saveEdit} disabled={savingEdit} style={({ pressed }) => [styles.editSave, { backgroundColor: c.brand, opacity: (pressed || savingEdit) ? 0.8 : 1 }]}>
              {savingEdit ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 17 * scale }}>Save changes</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Close / delete confirmation */}
      <Modal visible={closeConfirm} transparent animationType="fade" onRequestClose={() => setCloseConfirm(false)}>
        <View style={styles.confirmBg}>
          <View style={[styles.confirmCard, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 34 }}>🗑️</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginTop: 6, textAlign: "center" }}>Close this table?</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center", lineHeight: 22 }}>
              This removes it from the FP Café and clears its chat. This can&apos;t be undone.
            </Text>
            <Pressable testID="table-close-confirm" onPress={doClose} disabled={closing} style={({ pressed }) => [styles.confirmBtn, { backgroundColor: "#DC2626", opacity: (pressed || closing) ? 0.8 : 1 }]}>
              {closing ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Close table</Text>}
            </Pressable>
            <Pressable testID="table-close-cancel" onPress={() => setCloseConfirm(false)} style={[styles.confirmBtn, { borderColor: c.border, borderWidth: 1.5, marginTop: 6 }]}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Keep table</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </>
      )}
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
  // Round-8 polish (#4d): composer 1:1 with George. Outer row hosts the
  // photo attach on the left + a rounded pill wrapping the input and
  // mic on the right — the same structure George Event Creation uses.
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
  },
  composerPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  pillInput: {
    flex: 1,
    paddingVertical: 8,
    maxHeight: 120,
  },
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
  inviteeWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  inviteeTitle: { fontWeight: "800", letterSpacing: 0.6, fontSize: 11, marginBottom: 8 },
  inviteeChip: { alignItems: "center", width: 76, gap: 3 },
  inviteeName: { fontWeight: "700", maxWidth: 72, textAlign: "center" },
  inviteePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, alignSelf: "center" },
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
  manageBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  manageBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  manageSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 10 },
  manageItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16, borderRadius: 14, minHeight: 56 },
  editWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  editSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
  editEmojiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  editEmojiPick: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  editInput: { borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600" },
  editSave: { marginTop: 4, alignItems: "center", justifyContent: "center", paddingVertical: 15, borderRadius: 999, minHeight: 52 },
  confirmBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  confirmCard: { width: "100%", maxWidth: 420, borderRadius: 20, padding: 22, alignItems: "center" },
  confirmBtn: { marginTop: 14, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999, minHeight: 48, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
});
