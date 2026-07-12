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
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

// Primary FriendPlace butterfly logo — surfaces in every header so the
// brand mark is present even on tabs that don't render the full lockup.
const BUTTERFLY_LOGO = require("../../assets/brand/friendplace-app-icon-v4.png");

const RADIUS_OPTIONS = [5, 10, 25, 50] as const;

export default function Friends() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number; suburb?: string } | null>(null);
  const [radius, setRadius] = useState<number>(25);
  const [askingLoc, setAskingLoc] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [showDeniedHelp, setShowDeniedHelp] = useState(false);
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
    } catch { show("Failed to load"); }
  };
  useFocusEffect(useCallback(() => { load(); }, [q, user?.id, nearMe?.lat, nearMe?.lng, radius]));

  const requestNearMe = async () => {
    setShowRationale(false);
    setAskingLoc(true);
    try {
      // Check permission state first — respect handle_permissions_contract
      const current = await Location.getForegroundPermissionsAsync();
      if (!current.granted) {
        if (!current.canAskAgain) {
          setShowDeniedHelp(true);
          return;
        }
        const req = await Location.requestForegroundPermissionsAsync();
        if (!req.granted) {
          if (!req.canAskAgain) setShowDeniedHelp(true);
          else show("Location not used — you can still search by suburb name");
          return;
        }
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
      // Reverse-lookup to nearest known suburb (we never store the device coords)
      const nearest: any = await api.suburbsNearest(pos.coords.latitude, pos.coords.longitude);
      const n = nearest?.nearest;
      if (n) {
        setNearMe({ lat: n.lat, lng: n.lng, suburb: n.name });
        show(`Showing members near ${n.name}`);
      } else {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        show("Showing members near you");
      }
    } catch (e: any) {
      show("Couldn't get your location — you can still search by suburb");
    } finally {
      setAskingLoc(false);
    }
  };

  const clearNearMe = () => setNearMe(null);

  const sendReq = async (other: any) => {
    if (!user) return;
    try {
      await api.sendFriendReq(user.id, other.id);
      show(`Friend request sent to ${other.first_name} 🦋`);
      // Refresh the local nearby-members list only — do NOT touch the
      // auth `refresh()` here. Calling it caused a transient user
      // re-fetch which occasionally bounced the tab to /home when the
      // API round-trip was slow or momentarily 401'd.
      await load();
    } catch { show("Already sent or error"); }
  };

  const sendFlutter = async (other: any, tap?: { pageX: number; pageY: number }) => {
    if (!user) return;
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
    } catch { show("Could not send flutter"); }
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
                <AvatarBubble value={item.avatar} size={28} fallback="🙂" />
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
              <Pressable testID={`add-friend-${item.id}`} onPress={() => sendReq(item)} style={[styles.actionBtn, { backgroundColor: c.brand }]}>
                <Ionicons name="person-add" size={18} color="#FFF" />
                <Text style={[styles.actionText]}>Add</Text>
              </Pressable>
              <Pressable testID={`flutter-${item.id}`} onPress={(e) => sendFlutter(item, { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY })} style={[styles.actionBtn, { backgroundColor: "#8B5CF6" }]}>
                <Text style={{ fontSize: 16 }}>🦋</Text>
                <Text style={[styles.actionText]}>Flutter</Text>
              </Pressable>
              <Pressable testID={`msg-${item.id}`} onPress={() => startDm(item)} style={[styles.actionBtn, { backgroundColor: c.brandSecondary }]}>
                <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                <Text style={[styles.actionText]}>Msg</Text>
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
  inboxRow: { marginHorizontal: 16, padding: 14, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  inboxText: { flex: 1, fontWeight: "700" },
  card: { borderRadius: 18, padding: 14, borderWidth: 1, gap: 10 },
  userRow: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800" },
  metaText: { marginTop: 2, fontWeight: "500" },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  actionText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});

const modalStyles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  card: { width: "100%", maxWidth: 440, borderRadius: 20, padding: 24, alignItems: "center" },
  primary: { paddingVertical: 14, borderRadius: 999, alignItems: "center", marginTop: 18, width: "100%" },
  secondary: { paddingVertical: 12, borderRadius: 999, alignItems: "center", marginTop: 10, width: "100%", borderWidth: 1 },
});
