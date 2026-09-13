import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, ScrollView, Modal, Platform, Linking, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { emitFlutter } from "@/src/lib/flutter-fx";
import * as Location from "expo-location";
import AvatarWithBadge from "@/src/components/status/AvatarWithBadge";
import FounderMark from "@/src/components/FounderMark";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

// Primary FriendPlace butterfly logo — surfaces in every header so the
// brand mark is present even on tabs that don't render the full lockup.
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v5.png");

const RADIUS_OPTIONS = [5, 10, 25, 50] as const;

export default function Friends() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  // Locally-tracked "request sent" state per row so the button flips to
  // "Request Sent ✓" the moment the API call succeeds — Garry, 2 Aug
  // 2026: prevents repeat taps and gives obvious feedback that the
  // request actually went through. Hydrated on focus from
  // `friendsInbox().outgoing` so the pill sticks across screen visits.
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number; suburb?: string } | null>(null);
  const [radius, setRadius] = useState<number>(25);
  const [askingLoc, setAskingLoc] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [showDeniedHelp, setShowDeniedHelp] = useState(false);
  // Persistent flag: TRUE once the user has declined location, permission
  // check has failed, or the geo lookup has errored. Drives the friendly
  // inline banner that tells the user to use the suburb input instead —
  // more discoverable than the transient toast we used to show, which
  // disappeared after a couple of seconds and left older users unsure
  // how to proceed.
  const [locationDeclined, setLocationDeclined] = useState(false);
  // Per-row avatar refs — used by the "send flutter" animation so
  // the butterfly lands directly on the recipient's avatar instead
  // of the button next to it. Cleared on unmount by the ref callback.
  const avatarRefs = useRef<Map<string, View | null>>(new Map());

  const load = async () => {
    try {
      const params: any = { q, viewer_id: user?.id };
      if (nearMe) {
        params.near_lat = nearMe.lat;
        params.near_lng = nearMe.lng;
        params.radius_km = radius;
      }
      const list = await api.listUsers(params);
      setUsers((list as any[]).filter((u) => u.id !== user?.id));
    } catch (e: any) {
      // TestFlight round-2 (Garry, 28 July 2026 polish): a transient
      // 401 during hydrate would show a red "Failed to load" toast to
      // members who simply had no friends yet — misleading. Only
      // surface a real network error; swallow the 401 quietly since
      // useFocusEffect will re-try once the token is set.
      const status = (e?.status ?? e?.response?.status);
      const isAuth = status === 401 || status === 403;
      if (!isAuth) show("Failed to load");
      // Ensure the list falls back to an empty state cleanly.
      setUsers([]);
    }
  };
  useFocusEffect(useCallback(() => { load(); }, [q, user?.id, nearMe?.lat, nearMe?.lng, radius]));

  // Batch B iter157 (Garry, Aug 2026 — P0 #1): re-fetch the members
  // list whenever the user toggles Near Me on/off OR changes the radius
  // WHILE staying on this screen. `useFocusEffect` alone only re-runs
  // its effect on focus events, so tapping 5 → 10 → 25 km did nothing
  // until the tab was left and re-entered. This effect keeps the list
  // in sync with the selected radius in real time.
  React.useEffect(() => {
    if (!user?.id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearMe?.lat, nearMe?.lng, radius]);

  // Hydrate the outbound-request set so previously-sent requests still
  // show "Request Sent ✓" after coming back to this tab. Best-effort —
  // we don't block the row render on it, and a failure just leaves the
  // button in its default "Add" state.
  const friendCount = (user as any)?.friends?.length ?? 0;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!user?.id) return;
        try {
          const inbox: any = await api.friendsInbox(user.id);
          if (cancelled) return;
          const outIds: string[] = (inbox?.outgoing || [])
            .map((r: any) => r?.other?.id || r?.to_id)
            .filter(Boolean);
          setSentIds(new Set(outIds));
          const fr: string[] = (user as any)?.friends || [];
          setFriendIds(new Set(fr));
        } catch { /* non-fatal */ }
      })();
      return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, friendCount])
  );

  // Hydrate the "Fluttered ✓" set so previously-sent flutters still
  // show as sent after coming back to this tab. Same pattern as the
  // friend-request hydrate above — best-effort, non-blocking.
  //
  // Launch-readiness fix (Garry, TestFlight iter141): without this,
  // navigating away and back reset the button to a tappable "Flutter"
  // even though the server would 409 a re-send. The UX regressed for
  // one round-trip and read as inconsistent. Now the state matches
  // the server on every mount.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!user?.id) return;
        try {
          const res = await api.myOutboundActiveFlutters(user.id);
          if (cancelled) return;
          const ids: string[] = (res?.active || [])
            .map((r) => r?.to_id)
            .filter(Boolean) as string[];
          setFlutteredIds(new Set(ids));
        } catch { /* non-fatal */ }
      })();
      return () => { cancelled = true; };
    }, [user?.id])
  );

  const requestNearMe = async () => {
    // Batch B iter159 (Garry, Aug 2026 — real-iPhone Bug 3 RCA)
    // ────────────────────────────────────────────────────────────
    // iter158 already added the `getCurrentPositionAsync` timeout,
    // but the flow could still stall silently BEFORE ever reaching
    // that call because:
    //   • `Location.hasServicesEnabledAsync()` — no timeout, some
    //     iOS builds hang for 10+ s on cold boot.
    //   • `Location.getForegroundPermissionsAsync()` — no timeout,
    //     seen to hang when Screen Time / MDM restrictions are on.
    //   • `Location.requestForegroundPermissionsAsync()` — hangs
    //     until user taps, but if the OS dialog fails to present
    //     (bug seen when a Modal is still animating out on iOS),
    //     it never resolves.
    //
    // Every silent hang killed the "Use my location" flow with no
    // visible feedback — user tapped, modal closed, then nothing.
    //
    // Fix: wrap EVERY expo-location call in an explicit
    // `withTimeout(...)` promise race, and add a single top-level
    // 20 s watchdog that ALWAYS resets `askingLoc` and surfaces a
    // clear toast. Location accuracy also dropped from Balanced →
    // Low (~1 km, more than enough for suburb matching) which
    // typically returns in 1-3 s on iOS instead of the 8-15 s
    // Balanced sometimes needs on a device that's been indoors.
    const N = (stage: string, extra?: any) => {
      try { // eslint-disable-next-line no-console
        console.log(`[friends/near-me] ${stage}`, extra ?? "");
      } catch { /* noop */ }
    };
    // Race any promise against a hard timeout. Rejects with the
    // given label so we can identify which stage timed out.
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
      ]);

    N("tap");
    setShowRationale(false);
    // iOS animation-frame gap so the rationale modal's underlying
    // UIViewController isn't still on-screen when the OS permission
    // alert or Location Services call is made. Empirically 350 ms
    // is enough on iPhone 16 across iOS 18/19.
    if (Platform.OS === "ios") {
      await new Promise((r) => setTimeout(r, 350));
    }
    setAskingLoc(true);

    // Top-level watchdog: if we haven't returned in 20 s for ANY
    // reason (silent expo-location hang, backend suburbs endpoint
    // stalling, weird ANR-like state), force the loading flag off
    // and drop a toast so the button is tappable again and the
    // user knows what happened. This runs INDEPENDENT of the inner
    // Promise.race timeouts.
    let handledByFinally = false;
    const globalWatchdog = setTimeout(() => {
      if (handledByFinally) return;
      N("watchdog:fired");
      setAskingLoc(false);
      setLocationDeclined(true);
      show("Location took too long. Please try again or type a suburb above.");
    }, 20_000);

    try {
      N("services:check");
      let servicesOn = true;
      try {
        servicesOn = await withTimeout(
          Location.hasServicesEnabledAsync(),
          3_000,
          "hasServicesEnabled",
        );
      } catch (e: any) {
        // Not fatal — most devices have services on; if the check
        // hangs, we proceed and let the permission prompt clarify.
        N("services:timeout", { message: e?.message });
      }
      N("services:result", { servicesOn });
      if (!servicesOn) {
        setLocationDeclined(true);
        show("Location Services are turned off on this device. Turn them on in Settings to use Near Me, or type a suburb above.");
        return;
      }

      N("perm:check");
      let current: any;
      try {
        current = await withTimeout(
          Location.getForegroundPermissionsAsync(),
          3_000,
          "getForegroundPermissions",
        );
      } catch (e: any) {
        // If the permission-state check itself hangs, fall through
        // to a fresh request — the OS will always answer the ASK
        // path even when the QUERY path is stalling.
        N("perm:checkTimeout", { message: e?.message });
        current = { granted: false, canAskAgain: true, status: "undetermined" };
      }
      N("perm:current", { granted: current.granted, canAskAgain: current.canAskAgain, status: current.status });
      if (!current.granted) {
        if (!current.canAskAgain) {
          N("perm:blocked");
          setShowDeniedHelp(true);
          setLocationDeclined(true);
          return;
        }
        N("perm:request");
        let req: any;
        try {
          req = await withTimeout(
            Location.requestForegroundPermissionsAsync(),
            60_000,       // wait up to 60s for user to tap Allow/Deny
            "requestForegroundPermissions",
          );
        } catch (e: any) {
          N("perm:requestTimeout", { message: e?.message });
          setLocationDeclined(true);
          show("The Location permission prompt didn't appear. Please close and reopen the app.");
          return;
        }
        N("perm:requestResult", { granted: req.granted, canAskAgain: req.canAskAgain, status: req.status });
        if (!req.granted) {
          if (!req.canAskAgain) setShowDeniedHelp(true);
          setLocationDeclined(true);
          show("Location permission is needed for Near Me. You can still find friends by typing a suburb.");
          return;
        }
      }

      // Fast path: cached last-known position.
      N("lastKnown:start");
      let coords: { latitude: number; longitude: number } | null = null;
      try {
        const last = await withTimeout(
          Location.getLastKnownPositionAsync({
            maxAge: 5 * 60_000,
            requiredAccuracy: 500,
          }),
          3_000,
          "getLastKnown",
        );
        if (last?.coords) {
          coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
          N("lastKnown:hit", { lat: coords.latitude.toFixed(3), lng: coords.longitude.toFixed(3) });
        } else {
          N("lastKnown:miss");
        }
      } catch (e: any) {
        N("lastKnown:error", { message: e?.message });
      }

      if (!coords) {
        N("current:start");
        // Use `Accuracy.Low` (~1 km) — plenty precise for suburb
        // matching, and typically returns in 1-3 s on iOS instead
        // of the 8-15 s Balanced can take indoors. Hard 12 s cap.
        try {
          const pos: any = await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            12_000,
            "getCurrentPosition",
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          N("current:done", { lat: coords.latitude.toFixed(3), lng: coords.longitude.toFixed(3) });
        } catch (e: any) {
          N("current:error", { message: e?.message });
          setLocationDeclined(true);
          if (String(e?.message || "").startsWith("timeout:")) {
            show("Couldn't get your location in time. Try again outdoors, or type a suburb above.");
          } else {
            show("Couldn't read your location. You can still find friends by typing a suburb.");
          }
          return;
        }
      }

      // Reverse-lookup to nearest known suburb. Non-fatal — if it
      // fails or times out, we fall back to raw coords which
      // /users?near_lat=&near_lng=&radius_km= handles fine.
      N("suburb:lookup");
      let matchedSuburb: { name: string; lat: number; lng: number } | null = null;
      try {
        const nearest: any = await withTimeout(
          api.suburbsNearest(coords.latitude, coords.longitude),
          5_000,
          "suburbsNearest",
        );
        const n = nearest?.nearest;
        if (n?.lat && n?.lng) matchedSuburb = { name: n.name, lat: n.lat, lng: n.lng };
        N("suburb:result", { name: matchedSuburb?.name });
      } catch (e: any) {
        N("suburb:error", { message: e?.message });
        // fall through — raw coords work fine for radius filtering.
      }

      if (matchedSuburb) {
        setNearMe({ lat: matchedSuburb.lat, lng: matchedSuburb.lng, suburb: matchedSuburb.name });
        setLocationDeclined(false);
        show(`Showing members near ${matchedSuburb.name}`);
      } else {
        setNearMe({ lat: coords.latitude, lng: coords.longitude });
        setLocationDeclined(false);
        show("Showing members near you");
      }
      N("done");
    } catch (e: any) {
      N("fatal", { message: e?.message, name: e?.name });
      setLocationDeclined(true);
      show(e?.message || "Couldn't turn on Near Me — please try again.");
    } finally {
      handledByFinally = true;
      clearTimeout(globalWatchdog);
      setAskingLoc(false);
    }
  };

  const clearNearMe = () => setNearMe(null);

  const sendReq = async (other: any) => {
    if (!user) return;
    // Optimistic UI: flip the button to "Request Sent ✓" the moment
    // the tap fires so double-taps don't fire duplicate requests.
    setSentIds((s) => new Set([...Array.from(s), other.id]));
    try {
      await api.sendFriendReq(user.id, other.id);
      show(`Friend request sent to ${other.first_name} 🦋`);
      // Refresh the local nearby-members list only — do NOT touch the
      // auth `refresh()` here. Calling it caused a transient user
      // re-fetch which occasionally bounced the tab to /home when the
      // API round-trip was slow or momentarily 401'd.
      await load();
    } catch {
      // Roll back the optimistic flip so the button becomes tappable
      // again (unless it was already tracked — probably "already sent").
      show("Already sent or error");
    }
  };

  // Track "already fluttered them in this session" so the button flips
  // to "Fluttered ✓" and blocks repeat taps until the backend clears
  // the flag (recipient reads / responds).
  const [flutteredIds, setFlutteredIds] = useState<Set<string>>(new Set());

  const sendFlutter = async (other: any, tap?: { pageX: number; pageY: number }) => {
    if (!user) return;
    if (flutteredIds.has(other.id)) {
      show(`You've already fluttered ${other.first_name} — waiting for a reply.`);
      return;
    }
    // Optimistically flip the button so double-taps are absorbed even if
    // the network round-trip is slow.
    setFlutteredIds((s) => new Set([...Array.from(s), other.id]));
    try {
      await api.sendFlutter({ from_id: user.id, to_id: other.id });
      // Signature single-butterfly celebration. Prefer to land on the
      // recipient's *avatar* (via ref) so the animation clearly ties
      // the flutter to *them*; fall back to the tap coords when the
      // avatar can't be measured.
      const avatarRef = avatarRefs.current.get(other.id) || null;
      emitFlutter({
        targetRef: avatarRef as any,
        targetX: tap?.pageX,
        targetY: tap?.pageY,
        onLand: () => show(`🦋 Flutter sent to ${other.first_name}!`),
      });
      await load();
    } catch (e: any) {
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("409") || msg.includes("flutter_already_active")) {
        // Server confirms there's already an active flutter to this
        // person. Leave the button flipped so the UI matches truth.
        show(`You've already fluttered ${other.first_name} — waiting for a reply.`);
      } else {
        // Roll back the local flip so retry is possible.
        setFlutteredIds((s) => { const n = new Set(s); n.delete(other.id); return n; });
        show("Could not send flutter");
      }
    }
  };

  const startDm = async (other: any) => {
    if (!user) return;
    try {
      const conv = await api.startDm(user.id, other.id);
      router.push(`/dm/${conv.id}?other_id=${other.id}` as any);
    } catch { show("Could not start chat"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headRow}>
          <Pressable
            testID="friends-back"
            onPress={() => {
              // Friends is a top-level tab, so "back" means Home.
              // router.replace silently no-ops on iPad Safari for tab
              // destinations — force a hard nav on web so the button is
              // always deterministic and never appears to do nothing.
              if (Platform.OS === "web") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).location.assign("/home");
              } else {
                router.replace("/home" as any);
              }
            }}
            hitSlop={12}
            accessibilityLabel="Back to Home"
            style={({ pressed }) => [styles.backBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chevron-back" size={26} color={c.onSurface} />
          </Pressable>
          <Text style={[styles.title, { color: c.onSurface, fontSize: 28 * scale }]}>Find Friends</Text>
          <View style={{ flex: 1 }} />
          <Image source={BUTTERFLY_LOGO} style={styles.brandMark} resizeMode="contain" accessibilityLabel="FriendPlace" />
        </View>
        <View style={[styles.searchRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Ionicons name="search" size={22} color={c.muted} />
          <TextInput
            testID="friends-search"
            placeholder="Search by name, interest or suburb"
            value={q}
            onChangeText={setQ}
            placeholderTextColor={c.muted}
            style={{ flex: 1, marginLeft: 8, color: c.onSurface, fontSize: 16 * scale, paddingVertical: 12 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Pressable
            testID="near-me"
            onPress={() => (nearMe ? clearNearMe() : setShowRationale(true))}
            style={[styles.chip, { backgroundColor: nearMe ? c.brand : c.surfaceSecondary, borderColor: nearMe ? c.brand : c.border, flexDirection: "row", alignItems: "center", gap: 6 }]}
          >
            <Ionicons name={nearMe ? "navigate" : "navigate-outline"} size={16} color={nearMe ? "#FFF" : c.onSurface} />
            <Text style={{ color: nearMe ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{nearMe ? (nearMe.suburb ? `Near ${nearMe.suburb}` : "Near Me") : "Near Me"}</Text>
            {nearMe && <Ionicons name="close-circle" size={16} color="#FFFFFFCC" />}
          </Pressable>
          {nearMe && RADIUS_OPTIONS.map((r) => (
            <Pressable key={r} testID={`radius-${r}`} onPress={() => setRadius(r)} style={[styles.chip, { backgroundColor: radius === r ? c.brand : c.surfaceSecondary, borderColor: radius === r ? c.brand : c.border }]}>
              <Text style={{ color: radius === r ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>{r} km</Text>
            </Pressable>
          ))}
          {!nearMe && (
            <Text style={{ color: c.muted, fontSize: 13 * scale, alignSelf: "center", marginLeft: 8 }}>or type a suburb above</Text>
          )}
        </ScrollView>
        {/* Persistent hint banner: shown after a denied/failed location
            lookup so older users don't feel stuck. Highlights the suburb
            search input right above with a big arrow icon. Replaces the
            fleeting "Location not used" toast we used to show. */}
        {locationDeclined && !nearMe && (
          <View style={[styles.locHint, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
            <Ionicons name="arrow-up" size={22} color={c.brand} />
            <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale, flex: 1 }}>
              No worries — you can still find friends by typing a suburb name in the search box above.
            </Text>
            <Pressable
              onPress={() => setLocationDeclined(false)}
              hitSlop={8}
              accessibilityLabel="Dismiss hint"
            >
              <Ionicons name="close" size={20} color={c.brand} />
            </Pressable>
          </View>
        )}
      </View>
      <Pressable testID="messages-btn" onPress={() => router.push("/messages")} style={[styles.inboxRow, { backgroundColor: c.brandTertiary }]}>
        <Ionicons name="chatbubbles" size={22} color={c.brand} />
        <Text style={[styles.inboxText, { color: c.brand, fontSize: 16 * scale }]}>My Messages</Text>
        <Ionicons name="chevron-forward" size={20} color={c.brand} />
      </Pressable>

      {/* Pre-permission rationale (per FriendPlace permission contract) */}
      <Modal visible={showRationale} animationType="fade" transparent onRequestClose={() => setShowRationale(false)}>
        <View style={modalStyles.bg}>
          <View style={[modalStyles.card, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 40 }}>📍</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginTop: 6 }}>Find neighbours near you</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center", lineHeight: 22 }}>
              We&apos;ll use your location once to find your suburb. We <Text style={{ fontWeight: "800" }}>never share your exact location</Text> — only your suburb name is shown to other members.
            </Text>
            <Pressable testID="loc-allow" onPress={requestNearMe} disabled={askingLoc} style={[modalStyles.primary, { backgroundColor: c.brand, opacity: askingLoc ? 0.6 : 1 }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Use my location</Text>
            </Pressable>
            <Pressable testID="loc-cancel" onPress={() => setShowRationale(false)} style={[modalStyles.secondary, { borderColor: c.border }]}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Permission denied / blocked — Open Settings */}
      <Modal visible={showDeniedHelp} animationType="fade" transparent onRequestClose={() => setShowDeniedHelp(false)}>
        <View style={modalStyles.bg}>
          <View style={[modalStyles.card, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 40 }}>🔒</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginTop: 6 }}>Location is turned off</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 8, textAlign: "center", lineHeight: 22 }}>
              To use Near Me, open Settings and allow FriendPlace to use your location. You can still search by suburb above.
            </Text>
            <Pressable testID="loc-open-settings" onPress={() => Linking.openSettings()} style={[modalStyles.primary, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>Open Settings</Text>
            </Pressable>
            <Pressable testID="loc-deny-close" onPress={() => setShowDeniedHelp(false)} style={[modalStyles.secondary, { borderColor: c.border }]}>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10 }}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Pressable onPress={() => router.push(`/user/${item.id}` as any)} style={styles.userRow}>
              <View
                ref={(node) => {
                  if (node) avatarRefs.current.set(item.id, node);
                  else avatarRefs.current.delete(item.id);
                }}
                collapsable={false}
                style={[styles.avatar, { backgroundColor: c.brandTertiary }]}
              >
                <AvatarWithBadge value={item.avatar} userId={item.id} size={28} fallback="🙂" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={[styles.name, { color: c.onSurface, fontSize: 20 * scale }]}>{item.first_name}</Text>
                  <FounderMark user={item} size={14} testID={`friend-founder-${item.id}`} />
                </View>
                <Text style={[styles.metaText, { color: c.muted, fontSize: 14 * scale }]}>📍 {item.suburb || "—"}{item.distance_km != null ? ` · ${item.distance_km} km away` : ""}</Text>
                <Text style={[styles.metaText, { color: c.muted, fontSize: 13 * scale }]} numberOfLines={1}>{(item.interests || []).join(" · ") || "No interests yet"}</Text>
              </View>
            </Pressable>
            <View style={styles.actionRow}>
              {(() => {
                const isFriend = friendIds.has(item.id);
                const isSent = sentIds.has(item.id);
                if (isFriend) {
                  return (
                    <View style={[styles.actionBtn, { backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border }]}>
                      <Ionicons name="checkmark-circle" size={18} color={c.brand} />
                      <Text style={[styles.actionText, { color: c.onSurface }]}>Friends</Text>
                    </View>
                  );
                }
                if (isSent) {
                  return (
                    <View
                      testID={`add-friend-sent-${item.id}`}
                      style={[styles.actionBtn, { backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border }]}
                    >
                      <Ionicons name="checkmark" size={16} color={c.brand} />
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={[styles.actionText, { color: c.onSurface }]}
                      >
                        Sent
                      </Text>
                    </View>
                  );
                }
                return (
                  <Pressable testID={`add-friend-${item.id}`} onPress={() => sendReq(item)} style={[styles.actionBtn, { backgroundColor: c.brand }]}>
                    <Ionicons name="person-add" size={16} color="#FFF" />
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionText]}>Add</Text>
                  </Pressable>
                );
              })()}
              <Pressable
                testID={`flutter-${item.id}`}
                onPress={(e) => sendFlutter(item, { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY })}
                disabled={flutteredIds.has(item.id)}
                style={[
                  styles.actionBtn,
                  flutteredIds.has(item.id)
                    ? { backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border }
                    : { backgroundColor: "#8B5CF6" },
                ]}
              >
                {flutteredIds.has(item.id) ? (
                  <>
                    {/* Batch C follow-up (Garry, Aug 2026): keep the
                        Flutter completed state as "Fluttered ✓" — it
                        has a different meaning to a friend request.
                        Tightened spacing + adjustsFontSizeToFit lets
                        the longer word sit on one line on 375-wide
                        iPhones without wrapping. */}
                    <Ionicons name="checkmark" size={14} color={c.brand} />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={[styles.actionText, { color: c.onSurface, fontSize: 13 }]}
                    >
                      Fluttered
                    </Text>
                  </>
                ) : (
                  <>
                    <GeorgeButterflyMark size={16} />
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionText]}>Flutter</Text>
                  </>
                )}
              </Pressable>
              <Pressable testID={`msg-${item.id}`} onPress={() => startDm(item)} style={[styles.actionBtn, { backgroundColor: c.brandSecondary }]}>
                <Ionicons name="chatbubble-ellipses" size={16} color="#FFF" />
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.actionText]}>Msg</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={{ textAlign: "center", color: c.muted, marginTop: 30, fontSize: 16 * scale }}>No friends found yet. Try a different search.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  brandMark: { width: 40, height: 40, borderRadius: 10 },
  title: { fontWeight: "900" },
  searchRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, paddingHorizontal: 14, borderWidth: 1, minHeight: 52 },
  chipRow: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40, justifyContent: "center" },
  // Persistent inline banner shown after a declined/failed location
  // lookup. Uses the brandTertiary/brand palette so it reads as helpful
  // guidance rather than an error.
  locHint: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  inboxRow: { marginHorizontal: 16, padding: 14, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  inboxText: { flex: 1, fontWeight: "700" },
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 10 },
  userRow: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800" },
  metaText: { marginTop: 2, fontWeight: "500" },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 8, minWidth: 0 },
  actionText: { color: "#FFF", fontWeight: "700", fontSize: 14, flexShrink: 1 },
});

const modalStyles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  card: { width: "100%", maxWidth: 440, borderRadius: 20, padding: 24, alignItems: "center" },
  primary: { paddingVertical: 14, borderRadius: 999, alignItems: "center", marginTop: 18, width: "100%" },
  secondary: { paddingVertical: 12, borderRadius: 999, alignItems: "center", marginTop: 10, width: "100%", borderWidth: 1 },
});
