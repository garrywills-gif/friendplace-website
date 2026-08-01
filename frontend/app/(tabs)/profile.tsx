import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import Button from "@/src/components/Button";
import ShareFriendPlace from "@/src/components/ShareFriendPlace";
import { api } from "@/src/lib/api";
import { emitFlutter } from "@/src/lib/flutter-fx";
import AvatarBubble from "@/src/components/AvatarBubble";
import AvatarWithBadge from "@/src/components/status/AvatarWithBadge";
import FounderBadge from "@/src/components/FounderBadge";
import FounderMark from "@/src/components/FounderMark";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

const ALL_BADGES = [
  "Friendly Member", "Helpful Neighbour", "Social Star", "Community Builder",
  // Invite-milestone badges — unlocked at 1, 3, 10, 25, 50 successful invites.
  "First Invite", "Connector", "Ambassador", "Founder Friend",
  // Onboarding wizard badges
  "Welcome Aboard", "Community Joiner",
];
// Presence & Status v2: the old `STATUS_OPTIONS` list + audience picker
// that used to power the Profile "Send a chat alert" flow are now
// retired. Setting status happens on the Home "My Status" card and
// the audience list is implied by scope=nearby on the café banner.
// See /app/memory/design-presence-and-status.md §5.3.

export default function Profile() {
  const { c, scale } = useTheme();
  const { user, refresh, logout } = useAuth();
  const { show } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<any[]>([]);
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
  // Founder cohort snapshot — powers the "Become a Founding Member"
  // upgrade card that non-founders see. `null` means we haven't fetched
  // yet (card stays hidden so it doesn't flash in and out).
  const [founderCap, setFounderCap] = useState<number | null>(null);
  const [founderRemaining, setFounderRemaining] = useState<number | null>(null);

  // "No guilt. Ever." — the gentle profile invitation.
  // We stopped showing the old "Complete your profile" card as a
  // permanent nag with a checklist of missing fields. Now it's a
  // single soft one-liner that quietly disappears forever after the
  // member has dismissed it twice. Members can always add a photo /
  // suburb / bio from the Edit Profile screen whenever they're ready.
  // Storage key is namespaced per user so a shared device doesn't
  // hide the invite from a second member.
  const inviteStorageKey = user?.id ? `profile_gentle_invite_dismisses_v1:${user.id}` : null;
  const [inviteDismisses, setInviteDismisses] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!inviteStorageKey) return;
      try {
        const raw = await AsyncStorage.getItem(inviteStorageKey);
        const n = raw ? parseInt(raw, 10) : 0;
        if (!cancelled) setInviteDismisses(Number.isFinite(n) ? n : 0);
      } catch {
        if (!cancelled) setInviteDismisses(0);
      }
    })();
    return () => { cancelled = true; };
  }, [inviteStorageKey]);
  async function dismissGentleInvite() {
    if (!inviteStorageKey) return;
    const next = (inviteDismisses || 0) + 1;
    setInviteDismisses(next);
    try { await AsyncStorage.setItem(inviteStorageKey, String(next)); } catch {}
  }

  useFocusEffect(useCallback(() => {
    // Focus effect is intentionally lightweight — we skip the network
    // refresh on subsequent tab visits so the profile screen doesn't
    // flicker every time the user taps the Profile tab. Fresh data
    // arrives on pull-to-refresh or explicit actions. The initial load
    // still runs because `friends` starts empty.
    let cancelled = false;
    (async () => {
      // Bug fix (Garry, 24 Jun 2026): the previous flow fired
      // `refresh()` and then read `user.friends` from the closure's
      // stale value on the very same tick, which meant a member
      // whose friend request had just been accepted would still see
      // "No friends yet" and a 0 count until the app was cold-
      // started. `refresh()` now RETURNS the fresh user, so we
      // hydrate the derived friends list from THAT rather than
      // from the stale closure snapshot.
      const fresh = await refresh().catch(() => null);
      if (cancelled) return;
      const src = fresh || user;
      if (src?.friends?.length) {
        const arr = await Promise.all(src.friends.map((id) => api.getUser(id).catch(() => null)));
        if (!cancelled) setFriends(arr.filter(Boolean));
      } else if (!cancelled) {
        setFriends([]);
      }
      if (src?.id && !cancelled) {
        try {
          const s: any = await api.inviteStats(src.id);
          if (!cancelled) {
            setInviteCount(s?.count || 0);
            setRecentInvites(Array.isArray(s?.recent) ? s.recent : []);
          }
        } catch {}
        try {
          const r: any = await api.inviter(src.id);
          setInviter(r?.inviter || null);
        } catch {}
        // Founder cohort status — used to render the upgrade card (or
        // hide it entirely once the cohort is full). Silently ignored on
        // failure so profile still renders offline / when the endpoint
        // isn't available.
        if (!(src as any)?.is_founder) {
          try {
            const s: any = await api.founderStatus();
            if (!cancelled && s) {
              setFounderCap(typeof s.cap === "number" ? s.cap : null);
              if (typeof s.remaining === "number") setFounderRemaining(s.remaining);
            }
          } catch {}
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]));

  async function sendHello(invitee: any, tap?: { pageX: number; pageY: number }) {
    if (!user?.id || !invitee?.id) return;
    setHelloBusy((m) => ({ ...m, [invitee.id]: true }));
    try {
      await api.sendFlutter({
        from_id: user.id,
        to_id: invitee.id,
        message: `Welcome to FriendPlace, ${invitee.first_name || ""}! So glad you joined 🦋`,
      });
      // Signature single-butterfly celebration — lands on the pressed
      // row. Toast is deferred until landing (via onLand) so it
      // arrives with the butterfly.
      emitFlutter({
        targetX: tap?.pageX,
        targetY: tap?.pageY,
        onLand: () => show(`Said hi to ${invitee.first_name || invitee.username || "your friend"} 🦋`),
      });
    } catch (e: any) {
      show(e?.message || "Couldn't send the hello flutter");
    } finally {
      setHelloBusy((m) => ({ ...m, [invitee.id]: false }));
    }
  }

  if (!user) return <View style={{ flex: 1, backgroundColor: c.surface }} />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.surface }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, backgroundColor: c.surface, paddingBottom: 100 }]}
    >
      <View style={[styles.hero, { backgroundColor: c.brandTertiary }]}>
        <View style={[styles.avatar, { backgroundColor: c.surfaceSecondary, overflow: "hidden" }]}><AvatarBubble value={user.avatar} size={user.avatar && /^https?:\/\//i.test(user.avatar) ? 110 : 110} textSize={88} fallback="🙂" zoomable /></View>
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
          <GeorgeButterflyMark size={28} />
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

      {/* Gentle profile invitation — "No guilt. Ever." principle.
          Instead of nagging with a checklist of missing fields, we
          show a single soft one-liner when a member could still add
          a bit more to their profile. It stays warm ("whenever you're
          ready"), it's dismissible, and after two dismissals it
          quietly disappears forever. Members can always visit Edit
          Profile from the actions above.

          Copy is chosen based on the most visible thing missing so
          the invitation feels personal (photo first, then suburb,
          then bio, then interests). If none of those are missing,
          the card renders nothing. */}
      {(() => {
        // Wait for the dismissal counter to hydrate — avoids flashing
        // the card and then hiding it a tick later.
        if (inviteDismisses === null) return null;
        if (inviteDismisses >= 2) return null;

        const av = (user as any).avatar || "";
        // Treat blank / default emoji as "no photo yet".
        const missingAvatar = !av || av === "🧑";
        const missingSuburb = !(user as any).suburb;
        const missingBio = !(user as any).bio;
        const missingInterests = !(user as any).interests || (user as any).interests.length === 0;
        if (!missingAvatar && !missingSuburb && !missingBio && !missingInterests) return null;

        let message = "Add a profile photo whenever you're ready.";
        if (!missingAvatar && missingSuburb) message = "Share your suburb whenever you're ready.";
        else if (!missingAvatar && !missingSuburb && missingBio) message = "Add a short bio whenever you're ready.";
        else if (!missingAvatar && !missingSuburb && !missingBio && missingInterests) message = "Add a few interests whenever you're ready.";

        return (
          <View
            testID="profile-complete-card"
            style={[styles.gentleInvite, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <Pressable
              onPress={() => router.push("/edit-profile" as any)}
              accessibilityRole="button"
              accessibilityLabel={message}
              style={({ pressed }) => [styles.gentleInviteMain, { opacity: pressed ? 0.7 : 1 }]}
              hitSlop={8}
            >
              <Text style={{ fontSize: 18 }}>✨</Text>
              <Text
                style={{ color: c.onSurface, flex: 1, fontSize: 14 * scale, lineHeight: 20 }}
                numberOfLines={2}
              >
                {message}
              </Text>
            </Pressable>
            <Pressable
              onPress={dismissGentleInvite}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={10}
              style={({ pressed }) => [styles.gentleInviteClose, { opacity: pressed ? 0.5 : 0.7 }]}
              testID="profile-complete-dismiss"
            >
              <Ionicons name="close" size={18} color={c.muted} />
            </Pressable>
          </View>
        );
      })()}

      {(() => {
        // Shrink the stat number's font size for 3+ digit values so
        // "731 Butterfly Points" doesn't squash / wrap into the tiny
        // stat-box column. The steps are chosen empirically against the
        // narrowest iPhone width (~92pt per stat cell):
        //   1-2 digits  → 32pt  (default)
        //   3   digits  → 26pt
        //   4+  digits  → 22pt
        const digitFs = (n: number): number => {
          const len = String(Math.max(0, n | 0)).length;
          if (len >= 4) return 22;
          if (len === 3) return 26;
          return 32;
        };
        const numStyle = (n: number) => [styles.statNum, {
          color: c.brand,
          fontSize: digitFs(n) * scale,
          // Line-height matched to the smallest font so the four cells
          // stay vertically aligned regardless of which one shrinks.
          lineHeight: 34 * scale,
          // adjustsFontSizeToFit as a belt-and-braces for wildly high
          // numbers (e.g., 10k+).
        }];
        return (
          <View style={[styles.statsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={styles.statBox}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={numStyle(user.points || 0)}
              >
                {user.points}
              </Text>
              <Text style={[styles.statLab, { color: c.muted, fontSize: 13 * scale }]}>🦋 Points</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.statBox}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={numStyle(friends.length)}>{friends.length}</Text>
              <Text style={[styles.statLab, { color: c.muted, fontSize: 13 * scale }]}>Friends</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.statBox}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={numStyle(user.badges?.length || 0)}>{user.badges?.length || 0}</Text>
              <Text style={[styles.statLab, { color: c.muted, fontSize: 13 * scale }]}>Badges</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.statBox} testID="profile-invites-stat">
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={numStyle(inviteCount)}>{inviteCount}</Text>
              <Text style={[styles.statLab, { color: c.muted, fontSize: 13 * scale }]}>Invites</Text>
            </View>
          </View>
        );
      })()}

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
        <Text style={{ color: c.muted, fontSize: 15 * scale }}>No friends yet — head to &quot;Find Friends&quot; to say hi!</Text>
      ) : (
        <View style={styles.row}>
          {friends.map((f) => (
            <Pressable key={f.id} onPress={() => router.push(`/user/${f.id}` as any)} style={[styles.friendDot, { backgroundColor: c.brandTertiary }]}>
              {/* Presence & Status v2 (bug fix, Garry 24 Jun 2026):
                  the Profile friends list previously used a plain
                  AvatarBubble, so Garry could never see a status
                  glyph next to his friends. Swapped to AvatarWithBadge
                  so the corner badge renders per the LOCKED precedence
                  spec (Offline > Looking > In Café > Busy > Happy >
                  Online). Pure additive — layout unchanged. */}
              <AvatarWithBadge value={f.avatar} userId={f.id} size={28} fallback="🙂" />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 }}>
                <Text style={{ color: c.onBrandTertiary, fontWeight: "700", fontSize: 13 * scale }}>{f.first_name}</Text>
                <FounderMark user={f} size={12} />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ height: 24 }} />
      {/*
        Presence & Status v2 — the "My Status" chips + "Send a chat
        alert" flow that used to live here have moved to the Home
        screen (see /src/components/status/MyStatusCard.tsx). Profile
        now keeps ONLY the "Nearby Opt-In" preference — that's a
        separate notification setting, not a live status. Design ref:
        §5.3 in /app/memory/design-presence-and-status.md.
      */}
      <Text style={[styles.section, { color: c.onSurface, fontSize: 18 * scale }]}>🔔 Nearby chats</Text>
      <Text style={{ color: c.muted, fontSize: 13 * scale, marginBottom: 6 }}>Let neighbours nearby say hi to you.</Text>
      {/* TestFlight round-7 (Garry, Feb 2026 #18): the whole row is now
          tappable — previously only the tiny 22×22 checkbox itself was
          a Pressable, so members tapping the (much larger) label text
          got no response. Meets 44 pt iOS minimum touch target. */}
      <Pressable
        testID="toggle-nearby-opt-in"
        onPress={async () => {
          const next = !nearbyOptedIn;
          setNearbyOptedIn(next);
          try { await api.updatePreferences(user.id, { nearby_chat_alerts: next }); show(next ? "You'll get chat alerts from neighbours" : "Nearby alerts off"); } catch { setNearbyOptedIn(!next); }
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: nearbyOptedIn }}
        accessibilityLabel="Let nearby neighbours send me chat alerts"
        hitSlop={8}
        style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 10, minHeight: 44, paddingVertical: 4 }}
      >
        <View style={{ width: 22, height: 22, borderWidth: 2, borderRadius: 6, borderColor: c.brand, backgroundColor: nearbyOptedIn ? c.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
          {nearbyOptedIn && <Ionicons name="checkmark" size={14} color="#FFF" />}
        </View>
        <Text style={{ color: c.muted, fontSize: 13 * scale, flex: 1 }}>Let nearby neighbours send me chat alerts</Text>
      </Pressable>
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
      {/* Founders Wall entry — behaviour differs by member state:
          - Founder: warm crest celebration + link to the Wall.
          - Non-founder with slots left: prominent "Become a Founding
            Member" upgrade card with live remaining-places counter.
          - Non-founder + cohort full: "Founding Members Full" info card
            (no CTA, but still a warm explanation so nobody feels shut
            out). */}
      {(user as any).is_founder ? (
        <Pressable
          testID="profile-founders-wall"
          onPress={() => router.push("/founders")}
          accessibilityLabel="View the Founders Wall"
          style={({ pressed }) => [
            styles.founderRow,
            { backgroundColor: "#FEF3C7", borderColor: "#D4A017", opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <GeorgeButterflyMark size={26} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>
              FOUNDERS WALL
            </Text>
            <Text numberOfLines={2} style={{ color: "#3C2A06", fontWeight: "800", fontSize: 15 * scale, marginTop: 2 }}>
              See yourself — you&apos;re Founding Member #{(user as any).founder_number ?? ""}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#7C5300" />
        </Pressable>
      ) : founderRemaining != null && founderRemaining === 0 ? (
        <View style={[styles.founderRow, { backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" }]}>
          <GeorgeButterflyMark size={26} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: "#334155", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>
              FOUNDING MEMBERS FULL
            </Text>
            <Text numberOfLines={2} style={{ color: "#475569", fontWeight: "700", fontSize: 13 * scale, marginTop: 2 }}>
              All {founderCap?.toLocaleString() ?? 500} places are taken — thank you for being here!
            </Text>
          </View>
        </View>
      ) : (
        <Pressable
          testID="profile-become-founder"
          onPress={() => router.push("/founders/info")}
          accessibilityLabel="Become a Founding Member"
          style={({ pressed }) => [
            styles.upgradeFounderCard,
            { opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <View style={styles.upgradeFounderRow}>
            <GeorgeButterflyMark size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: "#FDE68A", fontWeight: "900", fontSize: 11 * scale, letterSpacing: 0.8 }}>
                LIMITED SPOTS · JOIN FREE
              </Text>
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 * scale, marginTop: 3, lineHeight: 21 }}>
                Become a Founding Member
              </Text>
              {founderRemaining != null ? (
                <Text style={{ color: "#FDE68A", fontWeight: "800", fontSize: 13 * scale, marginTop: 4 }}>
                  {founderRemaining.toLocaleString()} of {founderCap?.toLocaleString() ?? 500} places remaining
                </Text>
              ) : (
                <Text style={{ color: "#CBD5E1", fontWeight: "700", fontSize: 13 * scale, marginTop: 4 }}>
                  Claim your place in FriendPlace history
                </Text>
              )}
            </View>
          </View>
          <View style={styles.upgradeFounderCta}>
            <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 14 * scale, letterSpacing: 0.3 }}>
              Become a Founding Member
            </Text>
            <Ionicons name="arrow-forward-circle" size={22} color="#7C5300" />
          </View>
        </Pressable>
      )}
      <View style={{ height: 12 }} />
      <ShareFriendPlace variant="ghost" testID="profile-share" />

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
                  onPress={(e) => sendHello(it, { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY })}
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
      <Button label="Accessibility Settings" variant="outline" onPress={() => router.push("/settings?anchor=accessibility")} testID="profile-accessibility" />
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
  completeCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowColor: "#0D2A57",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  gentleInvite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  gentleInviteMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  gentleInviteClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  missingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
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
  upgradeFounderCard: {
    backgroundColor: "#1E3A7F",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#D4A017",
    padding: 16,
    gap: 14,
    shadowColor: "#0D2A57",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  upgradeFounderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  upgradeFounderCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FDE68A",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
