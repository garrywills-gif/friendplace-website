import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, Pressable, Alert, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { speakGeorgeAuto, stopGeorgeAuto } from "@/src/lib/tts-shared";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api, wsUrl } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import ReportSheet from "@/src/components/ReportSheet";
import { parseAvatar, avatarDisplayGlyph } from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";
import VoiceInputButton from "@/src/components/VoiceInputButton";
import { useComposerLock } from "@/src/lib/composer-lock";

// Notebook look-and-feel (Garry, 4 Aug 2026 TestFlight polish): both
// Notes to Myself and normal chats get a subtle ruled-paper background
// so messaging feels calmer and more readable. Zero functionality
// changes — pure visual treatment sitting behind the existing bubbles.
const NOTEBOOK_BG_SELF = "#F1F7F5";     // pale teal for Notes to Myself
const NOTEBOOK_BG_CHAT = "#FBFAF5";     // near-white cream for normal chats
// Ruled-line + margin-line opacity dialed back by ~40% on 5 Aug 2026
// (Garry launch polish): "fade the blue ruled lines by roughly 30–40%
// so they become more subtle. The notes themselves will stand out a
// little better while still keeping the notebook appearance."
const NOTEBOOK_LINE = "rgba(15,23,42,0.03)";
const NOTEBOOK_MARGIN_LINE = "rgba(220,38,38,0.09)"; // faint red left margin
const NOTEBOOK_LINE_HEIGHT = 32;
const NOTEBOOK_LINE_COUNT = 80;         // ~2560px of ruled paper — enough for any scroll

function NotebookBackground({ bg, showMargin }: { bg: string; showMargin: boolean }) {
  // Static ruled-paper backdrop. Rendered once behind the FlatList so
  // scrolling doesn't cause repaint churn. Doesn't scroll with content
  // — the lines are a visual texture, not a coordinate system. The
  // left margin line is exclusive to Notes to Myself so normal chats
  // stay clean of any journal cue.
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: bg }]}>
      {showMargin && (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 44, width: 1, backgroundColor: NOTEBOOK_MARGIN_LINE }} />
      )}
      {Array.from({ length: NOTEBOOK_LINE_COUNT }).map((_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (i + 1) * NOTEBOOK_LINE_HEIGHT,
            height: 1,
            backgroundColor: NOTEBOOK_LINE,
          }}
        />
      ))}
    </View>
  );
}

// Format helpers for date separators + per-bubble timestamps.
function _fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function _fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

// Combined "date · time" caption sitting under every bubble. Garry
// asked for the date to be visible alongside the time, not just the
// time — so we always render both.
function _fmtStamp(iso: string): string {
  const day = _fmtDay(iso);
  const time = _fmtTime(iso);
  if (!day && !time) return "";
  if (!day) return time;
  if (!time) return day;
  return `${day} · ${time}`;
}

// Row types for the FlatList — either a real message or an injected
// date separator computed from consecutive-message day changes.
type SepRow = { key: string; type: "sep"; label: string };
type MsgRow = { key: string; type: "msg"; data: any };
type Row = SepRow | MsgRow;

// iter213 (Garry, Oct 2026 — POLISH #3): mirror of the backend
// `_safe_display_name` heuristic for client-side labelling (e.g. the
// typing indicator). Returns the given name if it looks human-entered,
// otherwise "Someone" so we never leak a raw auth-style handle.
function _safeTypingName(raw: string | undefined | null): string {
  const name = String(raw || "").trim();
  if (!name) return "Someone";
  if (name.length > 20) return "Someone";
  if (name.includes("@")) return "Someone";
  if (/\d/.test(name)) return "Someone";
  if (!/[aeiouy]/i.test(name)) return "Someone";
  return name;
}

function _build_rows(messages: any[]): Row[] {
  const out: Row[] = [];
  let lastDay = "";
  for (const m of messages) {
    const iso = m?.created_at || "";
    const day = _fmtDay(iso);
    if (day && day !== lastDay) {
      out.push({ key: `sep-${day}-${m.id || out.length}`, type: "sep", label: day });
      lastDay = day;
    }
    out.push({ key: String(m.id || `m-${out.length}`), type: "msg", data: m });
  }
  return out;
}

export default function DM() {
  const { id, other_id } = useLocalSearchParams<{ id: string; other_id?: string }>();
  const router = useRouter();
  const { c, scale, prefs } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { show } = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [other, setOther] = useState<any>(null);
  const [text, setText] = useState("");
  const [reportTarget, setReportTarget] = useState<null | { type: "user" } | { type: "message"; id: string }>(null);
  // iter212 (Garry, Oct 2026 — Next Action #1): typing dots. We fan a
  // lightweight {type:'typing', is_typing:boolean} event through the
  // DM WebSocket. Sent at most every 2s while the composer is active,
  // auto-cleared 3s after the last keystroke. Server does NOT persist
  // it — pure room broadcast — so there's no DB impact.
  const [otherTyping, setOtherTyping] = useState(false);
  const otherTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentAtRef = useRef<number>(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // iter213-b: explicit TextInput ref so a tap anywhere on the composer
  // pill (not just the exact text area) focuses the input and brings up
  // the keyboard. Previously only the TextInput's inner glyph area was
  // tappable, which members with larger fingers were missing on real
  // iPhones — tap-to-focus is now the whole white pill.
  const inputRef = useRef<TextInput | null>(null);
  const listRef = useRef<FlatList>(null);
  // Self-DM (Notes to Myself) — when the other participant is the
  // caller. The Header renames itself and the "report user" button
  // is hidden (there's nobody else to report). (Garry, 2 Aug 2026.)
  const isSelfDm = !!user && !!other_id && other_id === user.id;
  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock whenever the member has typed something so the
  // GlobalDmPrompt defers instead of interrupting. Recording is
  // covered separately by VoiceInputButton's own lock. We also hold
  // the lock while viewing THIS DM screen, but the path filter in
  // dm-notify-context already prevents any prompt for this conv.
  useComposerLock(text.length > 0);

  // iter212: debounced typing emitter — fires `is_typing:true` at most
  // every 2s while the composer has content, and schedules a
  // `is_typing:false` 3s after the last keystroke.
  const emitTyping = useCallback((is_typing: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify({ type: "typing", is_typing })); } catch { /* noop */ }
  }, []);
  const handleChangeText = useCallback((v: string) => {
    setText(v);
    const nowMs = Date.now();
    const hasChars = v.trim().length > 0;
    if (hasChars) {
      if (nowMs - typingSentAtRef.current > 2000) {
        typingSentAtRef.current = nowMs;
        emitTyping(true);
      }
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = setTimeout(() => {
        typingSentAtRef.current = 0;
        emitTyping(false);
      }, 3000);
    } else {
      // Composer emptied — tell peer immediately, don't let the "typing" ghost linger.
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingSentAtRef.current = 0;
      emitTyping(false);
    }
  }, [emitTyping]);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    // iter213 (Garry, Oct 2026 — RED #1): recipient's open chat could
    // still lag one message behind even with the iter211 reconnect+poll
    // because iOS sometimes keeps the WebSocket in `readyState=OPEN`
    // while silently dropping incoming frames (NAT idle, cellular→wifi
    // handover). The old `only poll when !wsAlive` logic trusted a
    // socket that was lying about being connected. New belt-AND-braces:
    //   • Reconnect loop on WS close/error (unchanged from iter211)
    //   • AppState→active → reconnect + reconcile (unchanged)
    //   • Reconcile poll runs EVERY 2.5s unconditionally while the chat
    //     is open — a healthy socket just finds nothing new to merge
    //     (id-dedup keeps it idempotent), a stale socket catches the
    //     missing message within ~2.5s. Battery impact on an active
    //     chat screen is negligible (one tiny GET), and this is only
    //     active while the DM screen itself is mounted.
    //   • WS "freshness" heartbeat: if we haven't received ANY frame
    //     for 20s AND the socket still claims OPEN, we force-close it
    //     to trigger the reconnect path. This catches zombie sockets.
    //   • Dedup by id (shared seenIds set) so a late poll never doubles
    //     up a message the WS already delivered.
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconcileTimer: ReturnType<typeof setInterval> | null = null;
    let freshnessTimer: ReturnType<typeof setInterval> | null = null;
    let wsAlive = false;
    let lastFrameAt = Date.now();
    let backoffMs = 1000;

    const seenIds = new Set<string>();
    const mergeMessages = (incoming: any[]) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      setMessages((cur) => {
        const map = new Map<string, any>();
        for (const m of cur) if (m?.id) { map.set(m.id, m); seenIds.add(m.id); }
        let added = 0;
        for (const m of incoming) {
          if (!m?.id || map.has(m.id)) continue;
          map.set(m.id, m);
          seenIds.add(m.id);
          added += 1;
        }
        if (!added) return cur;
        const next = Array.from(map.values());
        next.sort((a: any, b: any) => String(a?.created_at || "").localeCompare(String(b?.created_at || "")));
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
        return next;
      });
    };
    const appendOne = (m: any) => {
      if (!m) return;
      if (m.id && seenIds.has(m.id)) return;
      if (m.id) seenIds.add(m.id);
      setMessages((cur) => {
        if (m.id && cur.some((x) => x?.id === m.id)) return cur;
        return [...cur, m];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    };

    (async () => {
      const msgs = await api.dmMessages(id);
      if (cancelled) return;
      setMessages(msgs);
      for (const m of msgs || []) if (m?.id) seenIds.add(m.id);
      let peerId: string | undefined = other_id;
      if (!peerId && Array.isArray(msgs)) {
        const peerMsg = msgs.find((m: any) => m && m.user_id && m.user_id !== user.id);
        if (peerMsg) peerId = peerMsg.user_id;
      }
      if (peerId) try { if (!cancelled) setOther(await api.getUser(peerId)); } catch {}
      try { await api.dmMarkRead(id); } catch {}
    })();

    const reconcile = async () => {
      if (cancelled) return;
      try {
        const fresh: any = await api.dmMessages(id);
        if (!cancelled) mergeMessages(Array.isArray(fresh) ? fresh : []);
      } catch { /* silent — WS is primary */ }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(wsUrl(`/ws/dm/${id}?user_id=${user.id}&token=${encodeURIComponent(token || "")}`));
      } catch {
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 20000);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        wsAlive = true;
        lastFrameAt = Date.now();
        backoffMs = 1000;
        // Full reconcile on open — picks up anything missed while
        // disconnected (the exact scenario in the bug report).
        reconcile();
      };
      ws.onmessage = (ev) => {
        try {
          // iter213: any frame — message, typing, or anything else —
          // proves the socket is actually delivering. Bump the freshness
          // timestamp so the stale-socket watchdog stays satisfied.
          lastFrameAt = Date.now();
          const data = JSON.parse(ev.data);
          if (data?.type === "typing") {
            // iter212: ignore our own echo, otherwise reflect the
            // peer's typing state. We also auto-clear after 4s in
            // case we miss the "stopped typing" event (dropped WS,
            // app backgrounded, etc.).
            if (data.user_id && data.user_id !== user.id) {
              setOtherTyping(!!data.is_typing);
              if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
              if (data.is_typing) {
                otherTypingTimerRef.current = setTimeout(() => setOtherTyping(false), 4000);
              }
              // iter213 (Garry, Oct 2026 — POLISH #3): if we don't yet
              // know who the peer is (e.g. a brand-new thread with no
              // messages), fetch their profile now so the indicator can
              // say "Fiona is typing…" rather than the "Someone"
              // fallback. Guarded by `!other` so we don't refetch on
              // every keystroke.
              if (!other && data.user_id) {
                api.getUser(data.user_id).then((p) => setOther(p)).catch(() => {});
              }
            }
            return;
          }
          if (data?.type === "message" && data.message) {
            // Clear peer typing indicator the moment their message
            // actually arrives — no "typing…" ghost after send.
            if (data.message.user_id && data.message.user_id !== user.id) {
              setOtherTyping(false);
              if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
            }
            appendOne(data.message);
            if (prefs.autoReadNewMessages && data.message?.user_id !== user.id && data.message?.text) {
              void speakGeorgeAuto(String(data.message.text));
            }
            if (data.message?.user_id !== user.id) {
              api.dmMarkRead(id).catch(() => {});
            }
          }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        wsAlive = false;
        if (cancelled) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 20000);
      };
      ws.onerror = () => { /* onclose handles the reconnect */ };
    };
    connect();

    // iter213: reconciliation poll runs ALWAYS (every 2.5s) while the
    // DM screen is open — this is the belt that pairs with the WS
    // braces. A healthy socket will have delivered already so the fetch
    // merges nothing new (dedup handles it); a stale socket catches the
    // missing message within ~2.5s and the user is never "one message
    // behind" again.
    reconcileTimer = setInterval(() => {
      reconcile();
    }, 2500);

    // iter213: WS freshness watchdog. If the socket claims OPEN but
    // hasn't delivered any frame for 20s, assume it's a zombie and
    // force-close it so the reconnect path takes over. The reconcile
    // poll above has already been keeping the thread in sync, so this
    // is a cleanup action rather than a user-visible repair.
    freshnessTimer = setInterval(() => {
      const ws = wsRef.current;
      if (!ws) return;
      if (ws.readyState !== 1) return;
      if (Date.now() - lastFrameAt < 20000) return;
      try { ws.close(); } catch { /* noop */ }
    }, 5000);

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        // Force a reconnect + reconcile the moment the user comes back
        // to the app so idle-dropped sockets don't leave the thread stale.
        try { ws?.close(); } catch { /* noop */ }
        reconcile();
      }
    });

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (reconcileTimer) clearInterval(reconcileTimer);
      if (freshnessTimer) clearInterval(freshnessTimer);
      if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      try { appSub.remove(); } catch { /* noop */ }
      try { ws?.close(); } catch { /* noop */ }
      stopGeorgeAuto();
    };
  }, [id, user?.id, prefs.autoReadNewMessages, token, other_id]);

  const send = () => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: text.trim() }));
    setText("");
    // iter212: tell peer we stopped typing the moment we send so their
    // "X is typing…" indicator clears immediately (otherwise it stays
    // up for ~3s until the client-side debounce timer fires).
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingSentAtRef.current = 0;
    emitTyping(false);
  };

  // Clear notes — Notes to Myself only. Backend enforces the self-DM
  // guard; we only expose the button when isSelfDm is true so the
  // network 403 path is a safety net, not a UX one.
  //
  // Wording locked with Garry on 5 Aug 2026: notes auto-save the
  // moment they're sent, so any "Save / Disregard"-style dialog is
  // misleading. This is a pure destructive action — the copy reads
  // like clearing a physical notebook.
  //
  // Cross-platform confirm (fix for iOS "trash does nothing" report):
  // React Native's `Alert.alert` is a no-op on web AND has been
  // reported flaky on some iOS builds when the app isn't the topmost
  // presenter. We call it on native for the native look, and fall
  // back to `window.confirm` on web so the button never appears dead.
  const handleClearNotes = () => {
    if (!id) return;
    const doClear = async () => {
      try {
        await api.dmClearMessages(String(id));
        setMessages([]);
        try { show?.("Notebook cleared"); } catch {}
      } catch (e: any) {
        try { show?.(e?.message || "Couldn't clear the notebook. Please try again."); } catch {}
      }
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== "undefined" && window.confirm(
        "Clear notebook?\n\nThis will permanently remove every note from your notebook. This cannot be undone.",
      );
      if (ok) void doClear();
      return;
    }
    Alert.alert(
      "Clear notebook?",
      "This will permanently remove every note from your notebook. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear Notebook", style: "destructive", onPress: () => { void doClear(); } },
      ],
      { cancelable: true },
    );
  };

  // NOTE: onMicPress was a stub that told users to use the OS keyboard's
  // dictate key. Replaced with a real <VoiceInputButton> below which
  // records via expo-audio and transcribes via whisper-1.

  const rows: Row[] = useMemo(() => _build_rows(messages), [messages]);
  const notebookBg = isSelfDm ? NOTEBOOK_BG_SELF : NOTEBOOK_BG_CHAT;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header
        title={
          isSelfDm
            ? "📝 Notes to Myself"
            : other
            ? `${avatarDisplayGlyph(other.avatar) ?? ""} ${other.first_name}`.trim()
            : "Message"
        }
        titleAccessory={!isSelfDm && other ? <FounderMark user={other} size={15} testID="dm-header-founder" /> : null}
        right={
          isSelfDm ? (
            <Pressable
              testID="dm-clear-notes"
              onPress={handleClearNotes}
              hitSlop={8}
              style={{ padding: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Clear all notes"
            >
              <Ionicons name="trash-outline" size={22} color={c.muted} />
            </Pressable>
          ) : other_id ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable
                testID="dm-play-together"
                onPress={() => router.push(`/games/play?friend=${other_id}${other ? `&name=${encodeURIComponent(other.first_name || "")}` : ""}` as any)}
                hitSlop={8}
                style={{ padding: 6 }}
                accessibilityLabel="Play a game together"
              >
                <Ionicons name="game-controller-outline" size={22} color={c.brand} />
              </Pressable>
              <Pressable testID="dm-report-user" onPress={() => setReportTarget({ type: "user" })} hitSlop={8} style={{ padding: 6 }}>
                <Ionicons name="flag-outline" size={22} color={c.warning} />
              </Pressable>
            </View>
          ) : undefined
        } />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <View style={{ flex: 1 }}>
          <NotebookBackground bg={notebookBg} showMargin={isSelfDm} />
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 20 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              if (item.type === "sep") {
                // Injected day separator (Today / Yesterday / d MMM yyyy).
                return (
                  <View style={styles.sepRow}>
                    <View style={[styles.sepLine, { backgroundColor: c.border }]} />
                    <View style={[styles.sepPill, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <Text style={[styles.sepLabel, { color: c.muted, fontSize: 12 * scale }]}>{item.label}</Text>
                    </View>
                    <View style={[styles.sepLine, { backgroundColor: c.border }]} />
                  </View>
                );
              }
              const m = item.data;
              const mine = m.user_id === user?.id;
              const stamp = _fmtStamp(m.created_at || "");
              // iter213 (Garry, Oct 2026 — POLISH #4): incoming (not-mine)
              // bubbles were nearly invisible on the pale notebook paper
              // because `c.surfaceSecondary` is often very close to the
              // page colour. Give incoming bubbles a soft blue tint and a
              // slightly stronger border so they lift off the page.
              const bubbleBg = mine ? c.brand : "#EAF2FB";
              const bubbleBorder = mine ? c.brand : "#B6CFEA";
              return (
                <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
                    <View style={[{ padding: 12, borderRadius: 18, backgroundColor: bubbleBg, borderWidth: 1, borderColor: bubbleBorder, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, flexShrink: 1 }]}>
                      <Text style={{ color: mine ? "#FFF" : "#0F2A4D", fontSize: 16 * scale }}>{m.text}</Text>
                    </View>
                    {!mine && !isSelfDm && (
                      <Pressable testID={`dm-report-msg-${m.id}`} onLongPress={() => setReportTarget({ type: "message", id: m.id })} hitSlop={6} style={{ padding: 4 }}>
                        <Ionicons name="flag-outline" size={14} color={c.muted} />
                      </Pressable>
                    )}
                    {prefs.readMessagesAloud && (
                      <SpeakButton text={m.text} color={mine ? c.brand : c.muted} bg={c.surfaceTertiary} size={18} testID={`speak-msg-${m.id}`} />
                    )}
                  </View>
                  {!!stamp && (
                    <Text
                      style={{
                        color: c.muted,
                        fontSize: 11 * scale,
                        alignSelf: mine ? "flex-end" : "flex-start",
                        paddingHorizontal: 6,
                        paddingTop: 2,
                      }}
                    >
                      {stamp}
                    </Text>
                  )}
                </View>
              );
            }}
          />
        </View>
        <View style={[styles.composerRow, { backgroundColor: "#EAF2FB", borderColor: "#B6CFEA", paddingBottom: 12 + Math.max(insets.bottom - 4, 0) }]}>
          {/* iter212: typing indicator — a soft "{name} is typing…" row
              only appears when the OTHER participant is typing. We never
              show our own typing. */}
          {otherTyping && !isSelfDm ? (
            <View style={styles.typingRow} testID="dm-typing-indicator">
              <View style={[styles.typingPill, { backgroundColor: "#FFFFFF", borderColor: "#B6CFEA" }]}>
                <Text style={{ color: "#4A6B8F", fontSize: 13 * scale, fontWeight: "700" }}>
                  {/* iter213 (Garry, Oct 2026 — POLISH #3): use the
                      member's FriendPlace display name, never raw auth
                      identities. */}
                  {_safeTypingName(other?.first_name)} is typing…
                </Text>
              </View>
            </View>
          ) : null}
          {/* iter213 refinement (Garry, Oct 2026): composer was still
              cramped on real device — mic+input shared one tight pill
              and iPhone home-indicator was eating the bottom edge so
              taps missed. Fix: input gets its own full-width white pill
              that stretches edge-to-edge, mic sits beside it in a
              separate round button, and the whole row pads for the
              safe-area bottom inset. Tap target on the input is now
              44pt tall so a single tap always opens the keyboard. */}
          <View style={styles.composerBar}>
            <TextInput
              ref={inputRef}
              testID="dm-input"
              value={text}
              onChangeText={handleChangeText}
              placeholder={isSelfDm ? "Write yourself a note…" : "Type a message…"}
              placeholderTextColor="#8AA7C7"
              style={[styles.composerPill, { backgroundColor: "#FFFFFF", borderColor: "#B6CFEA", color: "#0F2A4D", fontSize: 16 * scale }]}
              multiline
              textAlignVertical="center"
            />
            <View style={styles.micWrap}>
              <VoiceInputButton
                testID="dm-mic"
                sendTestID="dm-send"
                value={text}
                onChangeText={handleChangeText}
                userId={user?.id}
                onError={show}
                size={48}
                onSend={send}
                voiceEnabled={prefs.voiceInputEnabled}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      {reportTarget && (
        <ReportSheet
          visible={!!reportTarget}
          onClose={() => setReportTarget(null)}
          target_type={reportTarget.type === "user" ? "user" : "message"}
          target_id={reportTarget.type === "message" ? reportTarget.id : undefined}
          target_user_id={other_id}
          target_user_name={other?.first_name}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Round-8 polish (#4d): DM composer 1:1 with George. Outer row has
  // paddings + top border; inner pill hosts input + mic.
  composerRow: {
    flexDirection: "column",
    gap: 6,
    paddingHorizontal: 12,
    // iter213-b (Garry, Oct 2026 — composer fit): more vertical room so
    // the input + mic clear the iPhone home-indicator safely. Bottom
    // padding is topped up at runtime with the safe-area inset so the
    // composer never sits under the home bar.
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1.5,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  typingPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "80%",
  },
  // iter213-b: composer BAR holds the full-width input pill + the
  // standalone mic button side-by-side. The input pill now stretches
  // across most of the row (flex: 1), so it reads as the obvious place
  // to type. The mic lives in its own compact wrapper on the right.
  composerBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  // iter213-b: the input pill IS the TextInput now (no wrapper
  // Pressable). On iOS, wrapping a TextInput in Pressable can swallow
  // the first tap and block the keyboard from appearing — making the
  // input itself the pill means a single tap always focuses it
  // natively. 54pt tall for a comfortable finger target.
  composerPill: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1.5,
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "ios" ? 15 : 10,
    paddingBottom: Platform.OS === "ios" ? 15 : 10,
    minHeight: 54,
    maxHeight: 120,
  },
  micWrap: {
    alignSelf: "flex-end",
    marginBottom: 2,
  },
  // Date separator (Today · Yesterday · long date) — a pill nested
  // between two hairlines so it sits calmly on the notebook paper.
  sepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 4,
  },
  sepLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  sepPill: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sepLabel: {
    fontWeight: "600",
  },
});
