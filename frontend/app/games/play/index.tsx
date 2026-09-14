import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Header from "@/src/components/Header";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";

type GameDef = { key: string; title: string; blurb: string; emoji: string; players: string; tint: string };

const GAMES: GameDef[] = [
  { key: "this_or_that", title: "This or That", blurb: "Quick either/or picks — then see how many you match on.", emoji: "⚖️", players: "2 players", tint: "#EAF2FF" },
  { key: "quick_trivia", title: "Quick Trivia", blurb: "Five short questions, friendly scoring, clear winner.", emoji: "❓", players: "2 players", tint: "#FDECF3" },
  { key: "word_chain", title: "Word Chain", blurb: "Take turns — each word starts with the last letter.", emoji: "🔗", players: "2 players", tint: "#E7F6F1" },
];

const LABELS: Record<string, string> = {
  this_or_that: "This or That", quick_trivia: "Quick Trivia", word_chain: "Word Chain",
};

export default function PlayTogetherHub() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { friend, name } = useLocalSearchParams<{ friend?: string; name?: string }>();

  const [mine, setMine] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [preFriend, setPreFriend] = useState<{ id: string; name: string } | null>(null);
  const [inviting, setInviting] = useState(false);

  const PICK_FRIEND = "__pick_friend__";
  const activeFriend = useMemo(
    () => (friend ? { id: String(friend), name: String(name || "your friend") } : preFriend),
    [friend, name, preFriend],
  );

  const loadMine = useCallback(async () => {
    try {
      const r = await api.playMine();
      setMine(r?.sessions || []);
    } catch { /* ignore */ } finally { setLoadingMine(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadMine(); }, [loadMine]));

  const ensureFriends = useCallback(async () => {
    if (!friends.length && user?.id) {
      try { const r = await api.myFriends(user.id); setFriends(r?.friends || []); } catch { /* ignore */ }
    }
  }, [friends.length, user?.id]);

  const invite = useCallback(async (game: string, friendId: string) => {
    if (inviting) return;
    setInviting(true);
    try {
      const s = await api.playInvite(game, friendId);
      setPickerFor(null);
      router.push(`/games/play/${s.id}` as any);
    } catch (e: any) {
      setPickerFor(null);
      // surface via console; room/hub stays usable
      console.warn("invite failed", e?.message);
    } finally { setInviting(false); }
  }, [inviting, router]);

  const openInvitePicker = useCallback(async () => {
    await ensureFriends();
    setPickerFor(PICK_FRIEND);
  }, [ensureFriends]);

  const onGamePress = useCallback(async (game: string) => {
    if (activeFriend) { invite(game, activeFriend.id); return; }
    await ensureFriends();
    setPickerFor(game);
  }, [activeFriend, ensureFriends, invite]);

  const incoming = mine.filter((s) => s.status === "invited" && s.guest_id === user?.id);
  const ongoing = mine.filter((s) => s.status === "active" || (s.status === "invited" && s.host_id === user?.id));

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Play Together" subtitle="Something easy to do with a friend" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
        {incoming.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: c.muted }]}>INVITES FOR YOU</Text>
            {incoming.map((s) => {
              const host = (s.players || []).find((p: any) => p.id === s.host_id);
              return (
                <Pressable key={s.id} onPress={() => router.push(`/games/play/${s.id}` as any)} style={[styles.resumeRow, { backgroundColor: c.brand }]}>
                  <Text style={{ fontSize: 22 }}>🎉</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resumeTitle, { color: "#FFF" }]}>{host?.name || "A friend"} invited you</Text>
                    <Text style={[styles.resumeSub, { color: "#FFF" }]}>{LABELS[s.game]} · tap to accept</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#FFF" />
                </Pressable>
              );
            })}
          </View>
        )}

        {ongoing.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: c.muted }]}>YOUR GAMES</Text>
            {ongoing.map((s) => {
              const opp = (s.players || []).find((p: any) => p.id !== user?.id);
              const waiting = s.status === "invited";
              return (
                <Pressable key={s.id} onPress={() => router.push(`/games/play/${s.id}` as any)} style={[styles.resumeRow, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }]}>
                  <Text style={{ fontSize: 22 }}>{waiting ? "⏳" : "🎮"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resumeTitle, { color: c.onSurface }]}>{LABELS[s.game]}</Text>
                    <Text style={[styles.resumeSub, { color: c.muted }]}>
                      with {opp?.name || "friend"} · {waiting ? "waiting to accept" : "in progress"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={c.muted} />
                </Pressable>
              );
            })}
          </View>
        )}

        {loadingMine && <ActivityIndicator color={c.brand} style={{ marginVertical: 4 }} />}

        {activeFriend ? (
          <View style={[styles.banner, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
            <Ionicons name="person-circle" size={24} color={c.brand} />
            <Text style={[styles.bannerTxt, { color: c.onSurface, fontSize: 15 * scale }]}>
              Inviting <Text style={{ fontWeight: "900" }}>{activeFriend.name}</Text> — pick a game below
            </Text>
            {!friend && (
              <Pressable onPress={() => setPreFriend(null)} hitSlop={8} accessibilityLabel="Choose a different friend">
                <Ionicons name="close-circle" size={22} color={c.muted} />
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            testID="invite-friend-cta"
            onPress={openInvitePicker}
            style={({ pressed }) => [styles.inviteCta, { backgroundColor: c.brand, opacity: pressed ? 0.94 : 1 }]}
          >
            <View style={styles.inviteCtaIcon}>
              <Ionicons name="person-add" size={24} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.inviteCtaTitle, { fontSize: 19 * scale }]}>Invite a Friend to Play</Text>
              <Text style={[styles.inviteCtaSub, { fontSize: 13.5 * scale }]}>
                Break the ice with a quick game — earn Butterfly Points just for playing.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#FFF" />
          </Pressable>
        )}

        <Text style={[styles.sectionLabel, { color: c.muted, marginTop: 4 }]}>CHOOSE A GAME</Text>
        {GAMES.map((g) => (
          <Pressable
            key={g.key}
            testID={`play-game-${g.key}`}
            onPress={() => onGamePress(g.key)}
            style={({ pressed }) => [styles.gameCard, { backgroundColor: g.tint, opacity: pressed ? 0.94 : 1 }]}
          >
            <View style={[styles.gameEmoji, { backgroundColor: "rgba(255,255,255,0.7)" }]}>
              <Text style={{ fontSize: 26 }}>{g.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.gameTitle, { color: "#0D2A57", fontSize: 17 * scale }]}>{g.title}</Text>
              <Text style={[styles.gameBlurb, { color: "#33507D", fontSize: 13.5 * scale }]}>{g.blurb}</Text>
              <Text style={[styles.gamePlayers, { color: "#5B739B" }]}>{g.players}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#5B739B" />
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!pickerFor} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <Pressable style={styles.sheetBg} onPress={() => setPickerFor(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.surface }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: c.onSurface, fontSize: 18 * scale }]}>
              {pickerFor === PICK_FRIEND
                ? "Choose a friend to play with"
                : `Invite a friend to play ${pickerFor ? LABELS[pickerFor] : ""}`}
            </Text>
            {friends.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                <Text style={{ fontSize: 36 }}>👋</Text>
                <Text style={[styles.emptyTxt, { color: c.muted, fontSize: 14.5 * scale }]}>
                  Add a friend first, then invite them to play.
                </Text>
                <Pressable onPress={() => { setPickerFor(null); router.push("/friends" as any); }} style={[styles.findBtn, { backgroundColor: c.brand }]}>
                  <Text style={{ color: "#FFF", fontWeight: "800" }}>Find Friends</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={friends}
                keyExtractor={(f) => f.id}
                style={{ maxHeight: 380 }}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <Pressable
                    testID={`play-pick-${item.id}`}
                    disabled={inviting}
                    onPress={() => {
                      if (!pickerFor) return;
                      if (pickerFor === PICK_FRIEND) {
                        setPreFriend({ id: item.id, name: item.first_name });
                        setPickerFor(null);
                      } else {
                        invite(pickerFor, item.id);
                      }
                    }}
                    style={[styles.friendRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                  >
                    <View style={[styles.friendAvatar, { backgroundColor: c.brandTertiary }]}>
                      <Text style={{ fontSize: 20 }}>{item.avatar || "🙂"}</Text>
                    </View>
                    <Text style={[styles.friendName, { color: c.onSurface, fontSize: 16 * scale }]}>{item.first_name}</Text>
                    <View style={[styles.playPill, { backgroundColor: c.brand }]}>
                      <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 }}>{pickerFor === PICK_FRIEND ? "Choose" : "Play"}</Text>
                    </View>
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontWeight: "600", lineHeight: 21 },
  inviteCta: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 20, padding: 18 },
  inviteCtaIcon: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)" },
  inviteCtaTitle: { color: "#FFF", fontWeight: "900" },
  inviteCtaSub: { color: "#FFF", fontWeight: "600", marginTop: 3, lineHeight: 18, opacity: 0.95 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  bannerTxt: { fontWeight: "600", flex: 1 },
  sectionLabel: { fontWeight: "800", letterSpacing: 0.6, fontSize: 12 },
  resumeRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14 },
  resumeTitle: { fontWeight: "800", fontSize: 15.5 },
  resumeSub: { fontWeight: "600", fontSize: 13, marginTop: 1 },
  gameCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, padding: 16 },
  gameEmoji: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  gameTitle: { fontWeight: "900" },
  gameBlurb: { fontWeight: "600", marginTop: 2, lineHeight: 18 },
  gamePlayers: { fontWeight: "700", fontSize: 12, marginTop: 4 },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, gap: 12 },
  sheetHandle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.15)", marginBottom: 4 },
  sheetTitle: { fontWeight: "800", textAlign: "center" },
  friendRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  friendAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  friendName: { fontWeight: "700", flex: 1 },
  playPill: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  emptyTxt: { fontWeight: "600", textAlign: "center", paddingHorizontal: 20 },
  findBtn: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 4 },
});
