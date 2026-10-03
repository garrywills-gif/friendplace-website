/**
 * CompanionNudge — a brief, self-dismissing in-app nudge from the
 * member's chosen companion (George / Georgia) when a new private
 * message or Flutter arrives while the app is foregrounded.
 *
 * Why: while a member is online the small unread badge is easy to miss
 * (Garry, TestFlight Jun 2026). This slides a gentle companion card in
 * from the top for a few seconds, then leaves. It is strictly additive:
 *   • It NEVER touches the unread badge — that stays until the item is
 *     opened (handled by the existing DM/notification read flows).
 *   • NO voice autoplay.
 *   • No route changes — tapping just navigates to the existing target.
 *
 * Driven by the real-time `notification` socket event (server-side
 * push_notification fan-out), so it needs no polling of its own.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useAudioPlayer } from "expo-audio";
import { useInboxEvent } from "@/src/lib/user-socket";
import { useGeorgeVoice, VOICE_LABELS } from "@/src/lib/george-voice";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/lib/toast";

// Notification types we nudge for: private messages, Flutters, Play
// Together invites, friend requests, and lightweight community greetings
// (welcome / birthday_wish) — all things a member wants to see right away,
// over any screen. iter210 adds welcome + birthday_wish so a sent Welcome
// or Birthday Wish surfaces as an immediate app-wide popup (not just the
// bell/inbox).
const NUDGE_TYPES = new Set(["dm", "dm_request", "flutter", "game_invite", "friend_request", "table_invite", "welcome", "birthday_wish"]);

// Routes where the companion stays quiet (mirrors GeorgeGlobalHost).
const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/waitlist"];

const VISIBLE_MS = 5500;

// Strip anything that would leak as raw text: data-URI/base64 avatar blobs,
// http(s) image URLs, and preset/gallery avatar refs that occasionally get
// prepended to a title. Guarantees the live banner never shows
// "data:image/jpeg;base64,…" to the member (TestFlight Jun 2026, FP Café).
const cleanText = (s: string): string => {
  if (!s) return "";
  return s
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "")
    .replace(/\b(?:gallery|preset):[^\s]+/g, "")
    .replace(/\bportrait-[0-9]+\b/g, "")
    .replace(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif|heic)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

type Nudge = {
  key: string;
  ntype: string;
  title: string;
  body: string;
  route: string;
  payload?: any;
};

export default function CompanionNudge() {
  const { c, scale, prefs } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname() || "";
  const { show } = useToast();
  const { user } = useAuth();
  const [actionBusy, setActionBusy] = useState(false);
  const { voice } = useGeorgeVoice();
  const companionName = VOICE_LABELS[voice]?.short || "George";
  // Soft companion-branded treatment so the nudge clearly stands out from
  // the page: George → gentle blue, Georgia → gentle teal.
  const isGeorgia = companionName.toLowerCase().startsWith("georgia");
  const tint = isGeorgia
    ? { bg: "#D5EFE8", border: "#0D9488", accent: "#0B7A70" }
    : { bg: "#D8EAFB", border: "#2E9EE2", accent: "#1E6FA8" };

  // Gentle flutter/chime when the nudge appears. Sound-effect only — this
  // is NOT voice autoplay. Kept quiet so it never startles.
  const chime = useAudioPlayer(require("@/assets/sounds/nudge.wav"));
  useEffect(() => { try { chime.volume = 0.45; } catch { /* noop */ } }, [chime]);

  const [nudge, setNudge] = useState<Nudge | null>(null);
  // Dedup guard. A single DM can arrive over BOTH the `notification`
  // push AND the `dm_update` fan-out. We collapse them by message id so
  // one message = one nudge, while genuinely NEW consecutive messages in
  // the same conversation each still nudge (Garry: "repeated consecutive
  // messages must remain reliable"). Keyed `${conv}:${msgId}`.
  const seenMsg = useRef<Map<string, number>>(new Map());
  const seenRecently = useCallback((key: string): boolean => {
    const now = Date.now();
    const m = seenMsg.current;
    // prune old keys so the map never grows unbounded
    for (const [k, t] of m) if (now - t > 180000) m.delete(k);
    // Window must exceed the reconciliation poll interval so the SAME message
    // can't be shown once by the socket and again by the poll. Keys are
    // per-message (conv:msgId), so distinct/consecutive messages are never
    // suppressed by this.
    if (m.has(key) && now - (m.get(key) as number) < 120000) return true;
    m.set(key, now);
    return false;
  }, []);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every notification id we've already surfaced (via socket OR poll) so the
  // reconciliation poll never double-shows an event the socket already
  // delivered, and never re-nudges after the member dismissed it.
  const shownIds = useRef<Set<string>>(new Set());
  // Mirror of `nudge` for the poll closure — so we never clobber a visible
  // (possibly persistent) nudge with a polled one.
  const nudgeRef = useRef<Nudge | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setNudge(null);
    });
  }, [anim]);

  const routeFor = (n: any): string => {
    const type = n?.type;
    const payload = n?.payload || {};
    if (type === "game_invite") {
      return payload.session_id ? `/games/play/${payload.session_id}` : "/games/play";
    }
    if (type === "flutter") return "/notifications";
    if (type === "friend_request") return "/friends";
    if (type === "table_invite") {
      return payload.table_id ? `/table/${payload.table_id}` : "/lounge";
    }
    // iter210: welcome / birthday_wish → sender's profile (same as the
    // Notifications row routes to) so recipients can wave back directly.
    if (type === "welcome" || type === "birthday_wish") {
      const fromId = payload.from_id;
      return fromId ? `/user/${fromId}` : "/notifications";
    }
    // dm / dm_request → open the exact conversation when we have it.
    const convId = payload.dm_id || payload.conv_id;
    const fromId = payload.from_id;
    if (convId) return `/dm/${convId}${fromId ? `?other_id=${fromId}` : ""}`;
    return "/messages";
  };

  useInboxEvent("notification", (evt: any) => {
    const n = evt?.notification;
    if (!n || !NUDGE_TYPES.has(n.type)) return;
    // Already surfaced (poll beat the socket, or vice-versa) → skip.
    if (n.id && shownIds.current.has(n.id)) return;
    // Stay quiet on auth/onboarding/welcome. Game invites & friend requests
    // must surface on EVERY screen (including Home "/") so they're never
    // missed. Passive chat/flutter nudges stay quiet on the bare index route.
    if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return;
    // Chat messages must surface on EVERY screen (including Home "/") so a
    // second/third message is never missed once a chat has been opened —
    // the only place we stay quiet is INSIDE that exact thread (checked
    // below). Passive flutters still stay quiet on the bare Home index.
    if (n.type === "flutter" && pathname === "/") return;
    const route = routeFor(n);
    if (route.startsWith("/dm/") && pathname.startsWith(route.split("?")[0])) return;
    // Dedup DM nudges against the dm_update fan-out — by message id so
    // consecutive distinct messages still nudge.
    if (n.type === "dm" || n.type === "dm_request") {
      const conv = n?.payload?.dm_id || n?.payload?.conv_id || "";
      const msgId = n?.payload?.msg_id || n?.id || "";
      if (conv && seenRecently(`${conv}:${msgId}`)) return;
    }
    if (n.id) shownIds.current.add(n.id);
    setNudge({
      key: n.id || String(Date.now()),
      ntype: n.type,
      title: cleanText(n.title || "") || (
        n.type === "flutter" ? "New Flutter"
        : n.type === "game_invite" ? "New game invite"
        : n.type === "friend_request" ? "New friend request"
        : n.type === "table_invite" ? "Table invite"
        : n.type === "welcome" ? "Someone welcomed you 👋"
        : n.type === "birthday_wish" ? "You got birthday wishes 🎂"
        : "New message"
      ),
      body: cleanText(n.body || ""),
      route,
      payload: n.payload || {},
    });
  });

  // Item 7: reliable app-wide live DM nudge. The `dm_update` fan-out is the
  // primary real-time DM event and reaches the recipient's inbox socket over
  // ANY screen (Games, FP Café, Moments…). If the parallel `notification`
  // push is missed (socket timing), this still surfaces the live nudge.
  useInboxEvent("dm_update", (evt: any) => {
    const conv = evt?.conv_id;
    const fromId = evt?.from_id;
    const fromName = evt?.from_name || "A friend";
    if (!conv) return;
    // Live chat nudge on ANY screen (incl. Home) — only stay silent inside
    // this exact conversation (checked just below) or on auth/onboarding.
    if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return;
    // Already inside this exact conversation → nothing to nudge about.
    if (pathname.startsWith(`/dm/${conv}`)) return;
    const msgId = evt?.last_message?.id || "";
    if (seenRecently(`${conv}:${msgId}`)) return;
    const body = cleanText(String(evt?.last_message?.text || ""));
    setNudge({
      key: `dm:${evt?.last_message?.id || Date.now()}`,
      ntype: evt?.is_chat_request ? "dm_request" : "dm",
      title: cleanText(`${fromName} sent you a message`),
      body,
      route: `/dm/${conv}${fromId ? `?other_id=${fromId}` : ""}`,
    });
  });

  // ── Reconciliation poll fallback (Garry, Sep 2026 — "notifications must
  // pop up no matter where they are; it did work and stopped") ──────────
  // The per-user socket is the PRIMARY live channel, but on real devices it
  // can silently drop while idle on Home (ingress idle-timeout / OS
  // backgrounding), so a game invite or chat-request can miss its live push.
  // Every few seconds we fetch recent unread actionable notifications and
  // surface any the socket never delivered — guaranteeing a popup within
  // seconds on ANY screen without a refresh or navigation. `shownIds`
  // dedups against the socket so nothing double-shows.
  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      // Never clobber a nudge that's already on screen (esp. persistent
      // game/friend/table invites waiting on a choice).
      if (nudgeRef.current) return;
      if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return;
      try {
        const rows: any[] = await api.liveNudges(user.id, 90);
        if (stopped || nudgeRef.current || !Array.isArray(rows)) return;
        // Oldest → newest so the most recent unseen ends up showing.
        for (const n of rows.slice().reverse()) {
          if (!n?.id || shownIds.current.has(n.id) || !NUDGE_TYPES.has(n.type)) continue;
          if (n.type === "flutter" && pathname === "/") { shownIds.current.add(n.id); continue; }
          const route = routeFor(n);
          if (route.startsWith("/dm/") && pathname.startsWith(route.split("?")[0])) {
            shownIds.current.add(n.id); continue;
          }
          if (n.type === "dm" || n.type === "dm_request") {
            const conv = n?.payload?.dm_id || n?.payload?.conv_id || "";
            const msgId = n?.payload?.msg_id || n?.id || "";
            if (conv && seenRecently(`${conv}:${msgId}`)) { shownIds.current.add(n.id); continue; }
          }
          shownIds.current.add(n.id);
          setNudge({
            key: n.id,
            ntype: n.type,
            title: cleanText(n.title || "") || (
              n.type === "flutter" ? "New Flutter"
              : n.type === "game_invite" ? "New game invite"
              : n.type === "friend_request" ? "New friend request"
              : n.type === "table_invite" ? "Table invite"
              : n.type === "welcome" ? "Someone welcomed you 👋"
              : n.type === "birthday_wish" ? "You got birthday wishes 🎂"
              : "New message"
            ),
            body: cleanText(n.body || ""),
            route,
            payload: n.payload || {},
          });
          break; // one nudge per tick
        }
      } catch { /* silent — socket is primary, poll is best-effort */ }
    };
    const id = setInterval(tick, 9000);
    // Prime quickly on mount/return so a just-missed event surfaces fast.
    const warm = setTimeout(tick, 1500);
    return () => { stopped = true; clearInterval(id); clearTimeout(warm); };
  }, [user?.id, pathname, seenRecently]);

  // Keep the poll's view of "is a nudge visible" fresh.
  useEffect(() => { nudgeRef.current = nudge; }, [nudge]);

  // Animate in + arm auto-hide whenever a new nudge is set.
  useEffect(() => {
    if (!nudge) return;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    // iter211 (Garry, Oct 2026 — POLISH #6): only chime when the member
    // has FriendPlace sounds on. Deliberate TTS playback is untouched
    // (that uses its own control path).
    if (prefs.friendPlaceSounds !== false) {
      try { chime.seekTo(0); chime.play(); } catch { /* noop */ }
    }
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    // Action nudges (game invite / friend request) must NOT auto-dismiss —
    // they stay until the member chooses Play now / Snooze / dismiss (or
    // View request / Later). Only passive nudges (DMs, flutters) self-hide.
    const persistent = nudge.ntype === "game_invite" || nudge.ntype === "friend_request" || nudge.ntype === "table_invite";
    if (!persistent) {
      hideTimer.current = setTimeout(hide, VISIBLE_MS);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [nudge, anim, hide, chime]);

  if (!nudge) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] });
  const isGameInvite = nudge.ntype === "game_invite";
  const isFriendRequest = nudge.ntype === "friend_request";
  const isTableInvite = nudge.ntype === "table_invite";
  const hasActions = isGameInvite || isFriendRequest || isTableInvite;
  const primaryLabel = isTableInvite ? "Join table" : isFriendRequest ? "View request" : "Play now";
  const secondaryLabel = isTableInvite ? "Maybe later" : isFriendRequest ? "Later" : "Snooze";

  const open = () => {
    const target = nudge.route;
    hide();
    // Navigate on the next tick so the hide animation isn't cut short.
    setTimeout(() => { try { router.push(target as any); } catch { /* noop */ } }, 40);
  };

  // Friend-request inline actions. Accept confirms immediately, Decline
  // rejects, Later just dismisses (leaves the request pending in the list).
  const requestId = nudge.payload?.request_id;
  const acceptFriend = async () => {
    if (actionBusy) return;
    if (!requestId) { open(); return; }
    setActionBusy(true);
    try {
      await api.acceptReq(requestId);
      show("You're now friends 🎉");
      hide();
    } catch {
      show("Couldn't accept — opening your requests");
      open();
    } finally { setActionBusy(false); }
  };
  const declineFriend = async () => {
    if (actionBusy) return;
    if (!requestId) { hide(); return; }
    setActionBusy(true);
    try {
      await api.declineReq(requestId);
      show("Request declined");
    } catch { /* silent — still dismiss */ }
    finally { setActionBusy(false); hide(); }
  };

  // Table invite "Maybe later" — record a soft decline so the host's
  // invitee roster shows the member as declined (never blocks joining
  // later). Fire-and-forget; the dismiss is instant regardless.
  const dismissTableInvite = () => {
    const tableId = nudge?.payload?.table_id;
    if (tableId && user?.id) {
      api.declineTable(String(tableId), user.id).catch(() => {});
    }
    hide();
  };

  // iter210 (Garry, Oct 2026 — RED #8): Snooze on a game invite now
  // actually tells the sender the recipient isn't ready, instead of
  // leaving them on an endless "Waiting for X to accept".
  //
  // iter225 (Garry, Oct 2026 — RED #1): the previous version was
  // fire-and-forget with ``.catch(() => {})``. A silent snooze failure
  // (403, offline, server blip) hid the nudge but left the SENDER's
  // session as "invited" forever — so A could never invite C. We now
  // await the call and surface any failure as a toast, matching the
  // Decline cleanup contract. On success the backend sets the session
  // to ``declined`` and emits ``game_end`` to the host; the Play menu
  // reacts to that globally (see /games/play/index.tsx) to flush any
  // stale opponent/session state on the sender's side.
  const snoozeGameInvite = async () => {
    const sid = nudge?.payload?.session_id;
    if (!sid) { hide(); return; }
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await api.playSnooze(String(sid));
      hide();
    } catch (e: any) {
      show(e?.message || "Couldn't snooze that invite — try again in a moment");
      hide();
    } finally { setActionBusy(false); }
  };

  return (
    /*
     * Root-level absolute overlay — NOT wrapped in a React Native <Modal>.
     * WHY (Garry, real-device round Sep 2026): iOS presents only ONE modal
     * at a time. When the underlying screen already had a sheet/modal open
     * (FP Café action sheet, a game screen, etc.) a second <Modal> for the
     * nudge silently failed to present, so game/DM/table invites only
     * surfaced AFTER navigating away (which dismissed the blocking modal).
     * Rendering as a plain absolute/fixed View at the app root makes the
     * nudge paint immediately over any regular screen with no navigation,
     * refresh, or leave-and-return required. CompanionNudge is the last
     * child in app/_layout so this View sits above the navigator content.
     */
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8, opacity: anim, transform: [{ translateY }] }]}
    >
        <View style={[styles.card, { backgroundColor: tint.bg, borderColor: tint.border, shadowColor: "#0D2A57" }]}>
          <View style={styles.row}>
            <GeorgeButterflyMark size={34} />
            {/* Chats: the whole row taps through to the conversation.
                Game invites: tapping the text is a no-op — the explicit
                Play now / Snooze buttons below drive the choice. */}
            <Pressable
              testID="companion-nudge"
              accessibilityRole="button"
              accessibilityLabel={hasActions ? nudge.title : `${nudge.title}. Tap to open.`}
              onPress={hasActions ? undefined : open}
              disabled={hasActions}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Text style={[styles.name, { color: tint.accent, fontSize: 11 * scale }]}>{companionName.toUpperCase()}</Text>
              <Text numberOfLines={2} style={[styles.title, { color: "#0D2A57", fontSize: 14.5 * scale }]}>
                {nudge.title}
              </Text>
              {nudge.body ? (
                <Text numberOfLines={1} style={[styles.body, { color: "#33507D", fontSize: 12.5 * scale }]}>
                  {nudge.body}
                </Text>
              ) : null}
            </Pressable>
            {!hasActions && (
              <Pressable
                testID="companion-nudge-dismiss"
                onPress={hide}
                hitSlop={10}
                accessibilityLabel="Dismiss"
                style={styles.close}
              >
                <Text style={{ color: c.muted, fontSize: 20 * scale, fontWeight: "700" }}>×</Text>
              </Pressable>
            )}
          </View>

          {hasActions && (
            isFriendRequest ? (
              <View style={styles.btnRow}>
                <Pressable
                  testID="companion-nudge-accept"
                  onPress={acceptFriend}
                  disabled={actionBusy}
                  accessibilityLabel="Accept friend request"
                  style={[styles.btnPrimary, { backgroundColor: tint.accent, flex: 1.2, opacity: actionBusy ? 0.7 : 1 }]}
                >
                  <Text style={styles.btnPrimaryTxt}>Accept</Text>
                </Pressable>
                <Pressable
                  testID="companion-nudge-decline"
                  onPress={declineFriend}
                  disabled={actionBusy}
                  accessibilityLabel="Decline friend request"
                  style={[styles.btnSnooze, { borderColor: tint.border, opacity: actionBusy ? 0.7 : 1 }]}
                >
                  <Text style={[styles.btnSnoozeTxt, { color: tint.accent }]}>Decline</Text>
                </Pressable>
                <Pressable
                  testID="companion-nudge-later"
                  onPress={hide}
                  disabled={actionBusy}
                  accessibilityLabel="Decide later"
                  style={[styles.btnSnooze, { borderColor: tint.border, opacity: actionBusy ? 0.7 : 1 }]}
                >
                  <Text style={[styles.btnSnoozeTxt, { color: tint.accent }]}>Later</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.btnRow}>
                <Pressable
                  testID="companion-nudge-play"
                  onPress={open}
                  accessibilityLabel={primaryLabel}
                  style={[styles.btnPrimary, { backgroundColor: tint.accent }]}
                >
                  <Text style={styles.btnPrimaryTxt}>{primaryLabel}</Text>
                </Pressable>
                <Pressable
                  testID="companion-nudge-snooze"
                  onPress={isTableInvite ? dismissTableInvite : isGameInvite ? snoozeGameInvite : hide}
                  accessibilityLabel={secondaryLabel}
                  style={[styles.btnSnooze, { borderColor: tint.border }]}
                >
                  <Text style={[styles.btnSnoozeTxt, { color: tint.accent }]}>{secondaryLabel}</Text>
                </Pressable>
              </View>
            )
          )}
        </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    ...Platform.select({ web: { position: "fixed" as any }, default: {} }),
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontWeight: "900", letterSpacing: 0.8, marginBottom: 1 },
  title: { fontWeight: "800", lineHeight: 19 },
  body: { fontWeight: "600", lineHeight: 16, marginTop: 1 },
  close: { padding: 4, marginLeft: 2 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  btnPrimary: { flex: 1, minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  btnSnooze: { flex: 1, minHeight: 44, borderRadius: 999, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" },
  btnSnoozeTxt: { fontWeight: "800", fontSize: 15 },
});
