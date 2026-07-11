import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { emitFlutter } from "@/src/lib/flutter-fx";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";
import ReportSheet from "@/src/components/ReportSheet";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

export default function UserView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show, confirm } = useToast();
  const router = useRouter();
  const [u, setU] = useState<any>(null);
  const [reporting, setReporting] = useState(false);
  const [unblocking, setUnblocking] = useState(false);

  useEffect(() => { if (id) api.getUser(id).then(setU).catch(() => {}); }, [id]);

  // Is the profile I'm viewing on my personal block list? Reads from the
  // signed-in user's `blocked_users` (kept fresh via AuthProvider.refresh).
  // Truthy → hide social actions and show the block-state card + Unblock.
  const isBlockedByMe = useMemo(() => {
    if (!user || !u) return false;
    const list: string[] = ((user as any).blocked_users || []) as string[];
    return Array.isArray(list) && list.includes(u.id);
  }, [user, u]);

  if (!u) return <View style={{ flex: 1, backgroundColor: c.surface }}><Header title="Profile" /></View>;

  const send = async () => {
    if (!user) return;
    try {
      await api.sendFriendReq(user.id, u.id);
      show("Friend request sent 🦋");
      await refresh();
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("Already friends")) show(`You're already friends with ${u.first_name}`);
      else if (msg.includes("already") || msg.includes("Already")) show(`Friend request already sent to ${u.first_name}`);
      else show("Couldn't send friend request — please try again");
    }
  };
  const flutter = async () => {
    if (!user) return;
    try {
      await api.sendFlutter({ from_id: user.id, to_id: u.id });
      // Signature single-butterfly celebration. Default landing target
      // (upper-right glide) reads nicely against the profile header.
      emitFlutter();
      show(`🦋 Flutter sent to ${u.first_name}!`);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("rate") || msg.includes("recent")) show("You've sent a Flutter recently — try again in a bit");
      else show("Couldn't send Flutter — please try again");
    }
  };
  const message = async () => {
    if (!user) return;
    try {
      const conv = await api.startDm(user.id, u.id);
      router.push(`/dm/${conv.id}?other_id=${u.id}` as any);
    } catch {
      show("Couldn't start the conversation — please try again");
    }
  };
  const block = async () => {
    if (!user) return;
    const ok = await confirm({ title: `Block ${u.first_name}?`, message: "You won't see their posts and they can't message you.", confirmLabel: "Block", destructive: true });
    if (!ok) return;
    try {
      await api.blockUser(user.id, u.id);
      show(`${u.first_name} blocked`);
      await refresh();
    } catch { show("Couldn't block — please try again"); }
  };
  const unblock = async () => {
    if (!user || unblocking) return;
    const ok = await confirm({
      title: `Unblock ${u.first_name}?`,
      message: `You'll see ${u.first_name}'s posts again and they'll be able to send you flutters and messages.`,
      confirmLabel: "Unblock",
    });
    if (!ok) return;
    try {
      setUnblocking(true);
      await api.unblockUser(user.id, u.id);
      await refresh();
      show(`${u.first_name} unblocked`);
    } catch {
      show("Couldn't unblock — please try again");
    } finally {
      setUnblocking(false);
    }
  };
  const report = () => { if (!user) return; setReporting(true); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={u.first_name} titleAccessory={<FounderMark user={u} size={16} testID="user-profile-founder" />} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={[styles.hero, { backgroundColor: c.brandTertiary }]}>
          <View style={[styles.av, { backgroundColor: c.surfaceSecondary, overflow: "hidden" }]}><AvatarBubble value={u.avatar} size={u.avatar && /^https?:\/\//i.test(u.avatar) ? 110 : 110} textSize={88} fallback="🙂" /></View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Text style={[styles.name, { color: c.onSurface, fontSize: 28 * scale }]}>{u.first_name}</Text>
            <FounderMark user={u} size={20} testID="user-profile-name-founder" />
          </View>
          <Text style={{ color: c.muted, fontSize: 16 * scale }}>@{u.username} · 📍 {u.suburb || "—"}</Text>
          {!isBlockedByMe && !!u.status && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: c.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
              <Text style={{ fontSize: 14 }}>{u.status === "looking_to_chat" ? "🟢" : u.status === "in_coffee_lounge" ? "☕" : u.status === "happy_to_connect" ? "😊" : u.status === "busy" ? "🟡" : "⚫"}</Text>
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>
                {u.status === "looking_to_chat" ? "Looking to chat" : u.status === "in_coffee_lounge" ? "In the Coffee Lounge" : u.status === "happy_to_connect" ? "Happy to connect" : u.status === "busy" ? "Busy right now" : "Offline"}
              </Text>
            </View>
          )}
          {!isBlockedByMe && !!u.bio && <Text style={{ color: c.onBrandTertiary, fontSize: 16 * scale, marginTop: 8, textAlign: "center" }}>{u.bio}</Text>}
        </View>

        {/* Block-state banner. When the signed-in user has blocked this
            person we hide the friend / flutter / message actions and
            show a clear "You have blocked this user" card with a single
            prominent Unblock CTA — no accidental interactions, no
            hidden state, and a one-tap escape hatch. */}
        {isBlockedByMe ? (
          <View
            testID="blocked-state-card"
            style={[styles.blockedCard, { backgroundColor: c.surfaceSecondary, borderColor: c.error }]}
          >
            <View style={[styles.blockedIcon, { backgroundColor: c.error }]}>
              <Ionicons name="ban" size={22} color="#FFFFFF" />
            </View>
            <Text style={[styles.blockedTitle, { color: c.onSurface, fontSize: 18 * scale }]}>You have blocked this user</Text>
            <Text style={[styles.blockedBody, { color: c.muted, fontSize: 14 * scale }]}>
              {u.first_name} won&apos;t see your posts and can&apos;t send you flutters or messages. Their posts stay hidden from you until you unblock.
            </Text>
            <Pressable
              testID="user-unblock"
              onPress={unblock}
              disabled={unblocking}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${u.first_name}`}
              style={({ pressed }) => [styles.unblockBtn, { backgroundColor: c.brand, opacity: (pressed || unblocking) ? 0.85 : 1 }]}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 * scale }}>
                {unblocking ? "Unblocking…" : `Unblock ${u.first_name}`}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.actions}>
              <Button testID="user-add" label="Add Friend" onPress={send} />
              <Button testID="user-flutter" label="🦋 Flutter" variant="outline" onPress={flutter} />
              <Button testID="user-message" label="Message" variant="secondary" onPress={message} />
            </View>
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.h, { color: c.onSurface, fontSize: 18 * scale }]}>🏅 {u.points} Butterfly Points</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {(u.badges || []).map((b: string) => <Text key={b} style={{ color: c.brand, borderColor: c.brand, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontWeight: "700", fontSize: 13 * scale }}>{b}</Text>)}
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.h, { color: c.onSurface, fontSize: 18 * scale }]}>🌿 Interests</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {(u.interests || []).map((i: string) => <Text key={i} style={{ backgroundColor: c.brandTertiary, color: c.brand, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, fontWeight: "700", fontSize: 13 * scale }}>{i}</Text>)}
              </View>
            </View>
            <Pressable testID="user-report" onPress={report} style={[styles.danger, { borderColor: c.warning }]}><Ionicons name="flag" size={18} color={c.warning} /><Text style={{ color: c.warning, fontWeight: "700", fontSize: 16 * scale }}>Report user</Text></Pressable>
            <Pressable testID="user-block" onPress={block} style={[styles.danger, { borderColor: c.error }]}><Ionicons name="ban" size={18} color={c.error} /><Text style={{ color: c.error, fontWeight: "700", fontSize: 16 * scale }}>Block user</Text></Pressable>
          </>
        )}
      </ScrollView>
      {reporting && (
        <ReportSheet visible={reporting} onClose={() => setReporting(false)} target_type="user" target_user_id={u.id} target_user_name={u.first_name} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, borderRadius: 22, alignItems: "center", gap: 8 },
  av: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "900", marginTop: 6, textAlign: "center" },
  // Action pill row — wraps to next line on narrow devices so buttons
  // never overflow the visible screen area. Older layout was a flat
  // flexDirection: row that pushed the last pill off-screen on iPhone.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  card: { borderRadius: 18, padding: 14, borderWidth: 1 },
  h: { fontWeight: "800" },
  danger: { padding: 16, borderRadius: 14, borderWidth: 2, flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  // Blocked-state card
  blockedCard: {
    borderRadius: 18,
    borderWidth: 2,
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  blockedIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  blockedTitle: { fontWeight: "900", textAlign: "center" },
  blockedBody: { textAlign: "center", lineHeight: 20 },
  unblockBtn: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 999,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
  },
});
