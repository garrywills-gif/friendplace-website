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
import { Animated, Modal, Pressable, StyleSheet, Text, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useAudioPlayer } from "expo-audio";
import { useInboxEvent } from "@/src/lib/user-socket";
import { useGeorgeVoice, VOICE_LABELS } from "@/src/lib/george-voice";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";
import { useTheme } from "@/src/lib/theme";

// Notification types we nudge for: private messages, Flutters, and
// Play Together invites — all things a member wants to see right away.
const NUDGE_TYPES = new Set(["dm", "dm_request", "flutter", "game_invite"]);

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
};

export default function CompanionNudge() {
  const { c, scale } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname() || "";
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
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // dm / dm_request → open the exact conversation when we have it.
    const convId = payload.dm_id || payload.conv_id;
    const fromId = payload.from_id;
    if (convId) return `/dm/${convId}${fromId ? `?other_id=${fromId}` : ""}`;
    return "/messages";
  };

  useInboxEvent("notification", (evt: any) => {
    const n = evt?.notification;
    if (!n || !NUDGE_TYPES.has(n.type)) return;
    // Stay quiet on auth/onboarding/welcome, and if already viewing the
    // exact target conversation (nothing to nudge about).
    if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/") return;
    const route = routeFor(n);
    if (route.startsWith("/dm/") && pathname.startsWith(route.split("?")[0])) return;
    setNudge({
      key: n.id || String(Date.now()),
      ntype: n.type,
      title: cleanText(n.title || "") || (n.type === "flutter" ? "New Flutter" : "New message"),
      body: cleanText(n.body || ""),
      route,
    });
  });

  // Animate in + arm auto-hide whenever a new nudge is set.
  useEffect(() => {
    if (!nudge) return;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    try { chime.seekTo(0); chime.play(); } catch { /* noop */ }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, VISIBLE_MS);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [nudge, anim, hide, chime]);

  if (!nudge) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] });
  const isGameInvite = nudge.ntype === "game_invite";

  const open = () => {
    const target = nudge.route;
    hide();
    // Navigate on the next tick so the hide animation isn't cut short.
    setTimeout(() => { try { router.push(target as any); } catch { /* noop */ } }, 40);
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={hide}
    >
      {/* box-none lets taps outside the card fall through to whatever
          screen (or other Modal) is underneath — the nudge is a passive
          overlay, not a blocking sheet. Wrapping in a Modal is what lets
          it float ABOVE native Modals (e.g. FP Café action sheets), so
          the invite/message alert is visible over any active screen. */}
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
              accessibilityLabel={isGameInvite ? nudge.title : `${nudge.title}. Tap to open.`}
              onPress={isGameInvite ? undefined : open}
              disabled={isGameInvite}
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
            {!isGameInvite && (
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

          {isGameInvite && (
            <View style={styles.btnRow}>
              <Pressable
                testID="companion-nudge-play"
                onPress={open}
                accessibilityLabel="Play now"
                style={[styles.btnPrimary, { backgroundColor: tint.accent }]}
              >
                <Text style={styles.btnPrimaryTxt}>Play now</Text>
              </Pressable>
              <Pressable
                testID="companion-nudge-snooze"
                onPress={hide}
                accessibilityLabel="Snooze this invite"
                style={[styles.btnSnooze, { borderColor: tint.border }]}
              >
                <Text style={[styles.btnSnoozeTxt, { color: tint.accent }]}>Snooze</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
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
