import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import ShareYouBelong from "@/src/components/ShareYouBelong";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderBadge from "@/src/components/FounderBadge";
import FounderMark from "@/src/components/FounderMark";

const ALL_BADGES = [
  "Friendly Member", "Helpful Neighbour", "Social Star", "Community Builder",
  // Invite-milestone badges — unlocked at 1, 3, 10, 25, 50 successful invites.
  "First Invite", "Connector", "Ambassador", "Founder Friend",
  // Onboarding wizard badges
  "Welcome Aboard", "Community Joiner",
];
const STATUS_OPTIONS: { key: string; emoji: string; label: string }[] = [
  { key: "looking_to_chat",  emoji: "🟢", label: "Looking to chat" },
  { key: "in_coffee_lounge", emoji: "☕", label: "In the Coffee Lounge" },
  { key: "happy_to_connect", emoji: "😊", label: "Happy to connect" },
  { key: "busy",             emoji: "🟡", label: "Busy right now" },
  { key: "offline",          emoji: "⚫", label: "Offline" },
];

export default function Profile() {
  const { c, scale } = useTheme();
  const { user, refresh, logout } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<any[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertAudience, setAlertAudience] = useState<"friends" | "nearby" | "selected">("friends");
  const [alertMsg, setAlertMsg] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertSelected, setAlertSelected] = useState<string[]>([]);
  const [nearbyOptedIn, setNearbyOptedIn] = useState<boolean>(((user as any)?.preferences?.nearby_chat_alerts) ?? false);
  const [inviteCount, setInviteCount] = useState<number>(0);
  // Recent invitees — used to render the "Your invites" panel further down
  // so the host can see the avatars/first names of friends who joined
  // through their link, plus send each one a quick hello flutter.
  const [recentInvites, setRecentInvites] = useState<any[]>([]);
  // Per-invitee busy state so the "Send hello" buttons disable while a
  // flutter is in-flight — keeps users from double-firing welcomes.
  const [helloBusy, setHelloBusy] = useState<Record<string, boolean>>({});
  // Who invited me here? Shown as a friendly "You joined because Garry
  // invited you" card under the hero. null means nobody (organic signup).
  const [inviter, setInviter] = useState<any | null>(null);

  useFocusEffect(useCallback(() => {
    // Focus effect is intentionally lightweight — we skip the network
    // refresh on subsequent tab visits so the profile screen doesn't
    // flicker every time the user taps the Profile tab. Fresh data
    // arrives on pull-to-refresh or explicit actions. The initial load
    // still runs because `friends` starts empty.
    let cancelled = false;
    (async () => {
      // Best-effort refresh (silent) — never trips loading UI now.
      refresh().catch(() => {});
      if (cancelled) return;
      if (user?.friends?.length) {
        const arr = await Promise.all(user.friends.map((id) => api.getUser(id).catch(() => null)));
        if (!cancelled) setFriends(arr.filter(Boolean));
      } else if (!cancelled) {
        setFriends([]);
      }
      if (user?.id && !cancelled) {
        try {
          const s: any = await api.inviteStats(user.id);
          if (!cancelled) {
            setInviteCount(s?.count || 0);
            setRecentInvites(Array.isArray(s?.recent) ? s.recent : []);
          }
        } catch {}
        try {
          const r: any = await api.inviter(user.id);
          setInviter(r?.inviter || null);
        } catch {}
      }
    })();
  }, [user?.id]));

  async function sendHello(invitee: any) {
    if (!user?.id || !invitee?.id) return;
    setHelloBusy((m) => ({ ...m, [invitee.id]: true }));
    try {
      await api.sendFlutter({
        from_id: user.id,
        to_id: invitee.id,
        message: `Welcome to YouBelong, ${invitee.first_name || ""}! So glad you joined 🦋`,
      });
      show(`Said hi to ${invitee.first_name || invitee.username || "your friend"} 🦋`);
    } catch (e: any) {
      show(e?.message || "Couldn't send the hello flutter");
    } finally {
      setHelloBusy((m) => ({ ...m, [invitee.id]: false }));
    }
  }

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, backgroundColor: c.surface, paddingBottom: 100 }]}>
      <View style={[styles.hero, { backgroundColor: c.brandTertiary }]}>
        <View style={[styles.avatar, { backgroundColor: c.surfaceSecondary, overflow: "hidden" }]}><AvatarBubble value={user.avatar} size={user.avatar && /^https?:\/\//i.test(user.avatar) ? 110 : 110} textSize={88} fallback="🙂" /></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
          <Text style={[styles.name, { color: c.onSurface, fontSize: 30 * scale }]} testID="profile-name">{user.first_name}</Text>
          <FounderMark user={user as any} size={22} testID="profile-name-founder" />
        </View>
        <Text style={[styles.user, { color: c.muted, fontSize: 16 * scale }]}>@{user.username} · 📍 {user.suburb || "—"}</Text>
        {/* Founding Member crest — renders nothing for non-founders. */}
        <View style={{ marginTop: 8 }}>
          <FounderBadge user={user as any} variant="chip" />
        </View>
        {!!user.bio && <Text style={[styles.bio, { color: c.onSurface, fontSize: 16 * scale }]}>{user.bio}</Text>}
      </View>

      {/* "You joined because X invited you" card — only shown when this user
          arrived via someone's share link. Tappable so they can drop into
          DMs with their inviter and say thanks. */}
      {inviter && (
        <Pressable
          testID="profile-inviter-card"
          onPress={() => router.push(`/user/${inviter.id}` as any)}
          style={({ pressed }) => [styles.inviterCard, {
            backgroundColor: c.surfaceSecondary,
            borderColor: c.border,
            opacity: pressed ? 0.85 : 1,
          }]}
        >
          <Text style={{ fontSize: 28 }}>🦋</Text>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View>
              <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700", letterSpacing: 0.5 }}>YOU JOINED BECAUSE</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                {inviter.avatar ? <AvatarBubble value={inviter.avatar} size={20} /> : null}
                <Text style={{ color: c.onSurface, fontSize: 16 * scale, fontWeight: "800" }}>
                  {inviter.first_name || inviter.username} invited you
                </Text>
              </View>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={c.muted} />
        </Pressable>
      )}

      <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{user.points}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Butterfly Points</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{friends.length}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Friends</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{user.badges?.length || 0}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Badges</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.statBox} testID="profile-invites-stat">
          <Text style={[styles.statNum, { color: c.brand, fontSize: 32 * scale }]}>{inviteCount}</Text>
          <Text style={[styles.statLab, { color: c.muted, fontSize: 14 * scale }]}>Invites</Text>
        </View>
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>🦋 Badges</Text>
      <View style={styles.badgeWrap}>
        {ALL_BADGES.map((b) => {
          const earned = user.badges?.includes(b);
          return (
            <View key={b} style={[styles.badgeCard, { backgroundColor: earned ? c.brandTertiary : c.surfaceTertiary, borderColor: earned ? c.brand : c.border }]}>
              <Text style={{ fontSize: 30 }}>{earned ? "🏆" : "🔒"}</Text>
              <Text style={{ color: earned ? c.onBrandTertiary : c.muted, fontWeight: "700", marginTop: 6, fontSize: 14 * scale, textAlign: "center" }}>{b}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>🌿 Interests</Text>
      <View style={styles.row}>
        {(user.interests || []).length === 0 && <Text style={{ color: c.muted, fontSize: 15 * scale }}>No interests yet</Text>}
        {(user.interests || []).map((i) => (
          <View key={i} style={[styles.chip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>{i}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>👯 Friends</Text>
      {friends.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 15 * scale }}>No friends yet — head to "Find Friends" to say hi!</Text>
      ) : (
        <View style={styles.row}>
          {friends.map((f) => (
            <Pressable key={f.id} onPress={() => router.push(`/user/${f.id}` as any)} style={[styles.friendDot, { backgroundColor: c.brandTertiary }]}>
              <AvatarBubble value={f.avatar} size={28} fallback="🙂" />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 }}>
                <Text style={{ color: c.onBrandTertiary, fontWeight: "700", fontSize: 13 * scale }}>{f.first_name}</Text>
                <FounderMark user={f} size={12} />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ height: 24 }} />
      <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>💬 My status</Text>
      <Text style={{ color: c.muted, fontSize: 13 * scale, marginBottom: 6 }}>Let neighbours know how you&apos;re feeling today.</Text>
      <View style={styles.row}>
        {STATUS_OPTIONS.map((s) => {
          const active = (user as any).status === s.key;
          return (
            <Pressable
              key={s.key}
              testID={`status-${s.key}`}
              onPress={async () => {
                try {
                  await api.setStatus(user.id, active ? null : s.key);
                  await refresh();
                } catch {}
              }}
              style={[styles.chip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}
            >
              <Text style={{ color: active ? c.onBrandPrimary : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{s.emoji} {s.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ height: 10 }} />
      <Pressable
        testID="open-chat-alert"
        onPress={() => setAlertOpen(true)}
        style={[styles.chip, { backgroundColor: c.brand, borderColor: c.brand, alignSelf: "flex-start" }]}
      >
        <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 14 * scale }}>🦋 Send a &ldquo;Looking to chat&rdquo; alert</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
        <Pressable
          testID="toggle-nearby-opt-in"
          onPress={async () => {
            const next = !nearbyOptedIn;
            setNearbyOptedIn(next);
            try { await api.updatePreferences(user.id, { nearby_chat_alerts: next }); show(next ? "You'll get chat alerts from neighbours" : "Nearby alerts off"); } catch { setNearbyOptedIn(!next); }
          }}
          style={{ width: 22, height: 22, borderWidth: 2, borderRadius: 6, borderColor: c.brand, backgroundColor: nearbyOptedIn ? c.brand : "transparent", alignItems: "center", justifyContent: "center" }}
        >
          {nearbyOptedIn && <Ionicons name="checkmark" size={14} color="#FFF" />}
        </Pressable>
        <Text style={{ color: c.muted, fontSize: 13 * scale, flex: 1 }}>Let nearby neighbours send me chat alerts</Text>
      </View>
      <View style={{ height: 12 }} />
      <Button label="Friend Requests" onPress={() => router.push("/friends/inbox")} testID="profile-friend-requests" />
      <View style={{ height: 8 }} />
      <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale, marginTop: 4 }]}>🛡️ Privacy</Text>
      <View style={styles.row}>
        {(["everyone", "friends", "invisible"] as const).map((p) => {
          const active = (user.privacy || "everyone") === p;
          const label = p === "everyone" ? "Everyone" : p === "friends" ? "Friends only" : "Invisible";
          return (
            <Pressable key={p} testID={`privacy-${p}`} onPress={async () => { await api.setPrivacy(user.id, p); await refresh(); }} style={[styles.chip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
              <Text style={{ color: active ? c.onBrandPrimary : c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ height: 16 }} />
      <Button label="Edit Profile" variant="outline" onPress={() => router.push("/edit-profile")} testID="profile-edit" />
      <View style={{ height: 8 }} />
      {/* Founders Wall entry — visible to everyone. For founders this is
          their crest celebration; for everyone else it's a tap into the
          Founder Info / opt-in flow where they can claim their badge. */}
      <Pressable
        testID="profile-founders-wall"
        onPress={() => router.push((user as any).is_founder ? "/founders" : "/founders/info")}
        accessibilityLabel={(user as any).is_founder ? "View the Founders Wall" : "Learn about Founding Members"}
        style={({ pressed }) => [
          styles.founderRow,
          {
            backgroundColor: "#FEF3C7",
            borderColor: "#D4A017",
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={{ fontSize: 26 }}>🦋</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>
            FOUNDERS WALL
          </Text>
          <Text numberOfLines={2} style={{ color: "#3C2A06", fontWeight: "800", fontSize: 15 * scale, marginTop: 2 }}>
            {(user as any).is_founder
              ? `See yourself — you're Founding Member #${(user as any).founder_number ?? ""}`
              : "Join free as a Founding Member"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#7C5300" />
      </Pressable>
      <View style={{ height: 12 }} />
      <ShareYouBelong variant="ghost" testID="profile-share" />

      {/* Your invites panel — shows recent friends who joined through this
          user's invite link with a quick "Say hi" flutter button. Hidden
          when no invitees yet so the section never feels empty/depressing
          for users who haven't invited anyone. */}
      {recentInvites.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Text style={[styles.sectionLabel, { color: c.muted, fontSize: 13 * scale }]}>
            FRIENDS YOU&apos;VE BROUGHT IN ({inviteCount})
          </Text>
          <View style={{ gap: 8 }}>
            {recentInvites.slice(0, 6).map((it) => (
              <View
                key={it.id}
                testID={`invitee-${it.id}`}
                style={[styles.inviteeRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
              >
                <Pressable
                  onPress={() => router.push(`/user/${it.id}` as any)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}
                  accessibilityLabel={`Open ${it.first_name || it.username}'s profile`}
                >
                  <View style={[styles.inviteeAvatar, { backgroundColor: c.brandTertiary }]}>
                    <AvatarBubble value={it.avatar} size={40} textSize={26} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }} numberOfLines={1}>
                      {it.first_name || it.username}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 12 * scale }}>
                      Joined {formatRelative(it.created_at)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  testID={`invitee-hello-${it.id}`}
                  disabled={!!helloBusy[it.id]}
                  onPress={() => sendHello(it)}
                  style={({ pressed }) => [
                    styles.helloBtn,
                    {
                      backgroundColor: "#8B5CF6",
                      opacity: helloBusy[it.id] ? 0.5 : (pressed ? 0.85 : 1),
                    },
                  ]}
                  accessibilityLabel={`Send hello flutter to ${it.first_name || it.username}`}
                >
                  <Ionicons name="paper-plane" size={14} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13 * scale }}>
                    {helloBusy[it.id] ? "Sent…" : "Say hi"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ height: 12 }} />
      <Button label="Help & Support" variant="outline" onPress={() => router.push("/help")} testID="profile-help" />
      <View style={{ height: 12 }} />
      <Button label="Accessibility Settings" variant="outline" onPress={() => router.push("/settings/accessibility")} testID="profile-accessibility" />
      <View style={{ height: 12 }} />
      <Button label="Settings" variant="ghost" onPress={() => router.push("/settings")} testID="profile-settings" />
      {(user as any)?.is_admin && (
        <>
          <View style={{ height: 12 }} />
          <Button label="🛡  Admin tools" variant="outline" onPress={() => router.push("/admin")} testID="profile-admin" />
        </>
      )}
      <View style={{ height: 12 }} />
      <Button testID="logout" label="Log Out" variant="ghost" onPress={async () => { await logout(); router.replace("/"); }} />

      {/* Looking-to-chat alert modal */}
      <Modal visible={alertOpen} animationType="slide" transparent onRequestClose={() => setAlertOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: c.surface, padding: 18, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, flex: 1 }}>🦋 Send a chat alert</Text>
              <Pressable testID="close-alert" onPress={() => setAlertOpen(false)} hitSlop={10}><Ionicons name="close" size={24} color={c.muted} /></Pressable>
            </View>
            <Text style={{ color: c.muted, fontSize: 13 * scale }}>Choose who hears that you&apos;d like a chat right now.</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {(["friends", "nearby", "selected"] as const).map((a) => {
                const on = alertAudience === a;
                const label = a === "friends" ? "My friends" : a === "nearby" ? "Nearby opt-ins" : "Choose people";
                return (
                  <Pressable
                    key={a}
                    testID={`audience-${a}`}
                    onPress={() => setAlertAudience(a)}
                    style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}
                  >
                    <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "800", fontSize: 14 * scale }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {alertAudience === "selected" && (
              <View>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale, marginBottom: 6 }}>Pick from your friends ({alertSelected.length}/20)</Text>
                {friends.length === 0 ? (
                  <Text style={{ color: c.muted, fontSize: 13 * scale }}>No friends to choose from yet.</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {friends.map((f: any) => {
                      const on = alertSelected.includes(f.id);
                      return (
                        <Pressable
                          key={f.id}
                          testID={`pick-${f.id}`}
                          onPress={() => setAlertSelected((prev) => on ? prev.filter((x) => x !== f.id) : (prev.length < 20 ? [...prev, f.id] : prev))}
                          style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSecondary, borderColor: on ? c.brand : c.border }]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <AvatarBubble value={f.avatar} size={16} />
                            <Text style={{ color: on ? c.onBrandPrimary : c.onSurface, fontWeight: "700", fontSize: 13 * scale }}>{f.first_name}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
            <TextInput
              testID="alert-message"
              value={alertMsg}
              onChangeText={setAlertMsg}
              placeholder="Add a short message (optional)"
              placeholderTextColor={c.muted}
              multiline
              maxLength={280}
              style={{ color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 70, textAlignVertical: "top", fontSize: 14 * scale }}
            />
            <Text style={{ color: c.muted, fontSize: 11 * scale }}>Alerts go to friends, nearby opt-ins, or the people you choose — never the whole community.</Text>
            <Pressable
              testID="send-alert"
              disabled={alertBusy || (alertAudience === "selected" && alertSelected.length === 0)}
              onPress={async () => {
                setAlertBusy(true);
                try {
                  const res: any = await api.sendChatAlert({
                    user_id: user.id,
                    audience: alertAudience,
                    message: alertMsg.trim() || undefined,
                    recipient_ids: alertAudience === "selected" ? alertSelected : undefined,
                    radius_km: alertAudience === "nearby" ? 10 : undefined,
                  });
                  show(res.delivered_to ? `Sent to ${res.delivered_to} ${res.delivered_to === 1 ? "neighbour" : "neighbours"}` : (res.message || "Nobody to send to"));
                  setAlertOpen(false);
                  setAlertMsg("");
                  setAlertSelected([]);
                } catch (e: any) {
                  show(e?.message || "Could not send alert");
                } finally { setAlertBusy(false); }
              }}
              style={{ backgroundColor: c.brand, paddingVertical: 14, borderRadius: 14, alignItems: "center", opacity: alertBusy ? 0.6 : 1 }}
            >
              {alertBusy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 15 * scale }}>Send alert</Text>}
            </Pressable>
            <View style={{ height: insets.bottom }} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  hero: { alignItems: "center", padding: 20, borderRadius: 24, gap: 8 },
  inviterCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1, marginTop: 12,
  },
  avatar: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "900", marginTop: 8 },
  user: { fontWeight: "600" },
  bio: { textAlign: "center", marginTop: 6 },
  statsCard: { borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: "row", justifyContent: "space-around", alignItems: "center" },
  statBox: { alignItems: "center", flex: 1 },
  statNum: { fontWeight: "900" },
  statLab: { fontWeight: "600", marginTop: 2, textAlign: "center" },
  divider: { width: 1, height: "70%" },
  section: { fontWeight: "800", marginTop: 8 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badgeCard: { width: "47%", minHeight: 110, borderRadius: 18, borderWidth: 2, padding: 10, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  friendDot: { width: 80, height: 88, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 6 },
  sectionLabel: { fontWeight: "900", letterSpacing: 0.6, marginTop: 4, marginBottom: 8 },
  founderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  inviteeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  inviteeAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  helloBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    minHeight: 36,
  },
});

// Friendly relative-time string for the "Joined …" line on invitee rows.
// Keeps the panel scanning-friendly without exposing exact timestamps.
function formatRelative(iso?: string): string {
  if (!iso) return "recently";
  const t = Date.parse(iso);
  if (!isFinite(t)) return "recently";
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / (60 * 1000))} min ago`;
  if (diff < day) return `${Math.round(diff / (60 * 60 * 1000))} hr ago`;
  if (diff < 7 * day) return `${Math.round(diff / day)} day${Math.round(diff / day) === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString();
}
