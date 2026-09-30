import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Header from "@/src/components/Header";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useInboxEvent } from "@/src/lib/user-socket";
import { api } from "@/src/lib/api";
import ThisOrThat from "@/src/components/play/ThisOrThat";
import QuickTrivia from "@/src/components/play/QuickTrivia";
import WordChain from "@/src/components/play/WordChain";

const LABELS: Record<string, string> = {
  this_or_that: "This or That",
  quick_trivia: "Quick Trivia",
  word_chain: "Word Chain",
};

export default function PlayRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [friendReqSent, setFriendReqSent] = useState(false);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showErr = useCallback((m: string) => {
    setErr(m);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setErr(null), 3200);
  }, []);

  const refetch = useCallback(async () => {
    if (!id) return;
    try {
      const s = await api.playGet(String(id));
      setSession(s);
      setFatal(null);
    } catch (e: any) {
      setFatal(e?.message || "Couldn't load this game.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refetch(); }, [refetch]);

  // Rematch hygiene: whenever the session id changes (Play again →
  // fresh session), drop any stale finished-game state so the new
  // invite/game starts clean. Guarantees unlimited consecutive rematches
  // never render or act on the previous session's board.
  useEffect(() => {
    setSession(null);
    setLoading(true);
    setErr(null);
    setFatal(null);
    setFriendReqSent(false);
  }, [id]);

  // Light poll while the game is live — reconciles anything the socket missed.
  useEffect(() => {
    const st = session?.status;
    if (st !== "invited" && st !== "active") return;
    const t = setInterval(refetch, 2500);
    return () => clearInterval(t);
  }, [session?.status, refetch]);

  // Realtime nudge: refetch immediately on any game event for this session.
  useInboxEvent("notification", (evt: any) => {
    const n = evt?.notification;
    if (!n || !String(n.type || "").startsWith("game_")) return;
    if (n?.payload?.session_id && n.payload.session_id !== String(id)) return;
    refetch();
  });

  const act = useCallback(async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await fn();
      if (s && s.id) setSession(s);
    } catch (e: any) {
      showErr(e?.message || "That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, showErr]);

  const me = user?.id || "";
  const game = session?.game;
  const status = session?.status;
  const mePlayer = (session?.players || []).find((p: any) => p.id === me);
  const other = (session?.players || []).find((p: any) => p.id !== me);
  const iAmHost = session?.host_id === me;
  // Non-friends who just played (matchmaking, or simply not yet friends) get
  // the option to send a normal friend request — we NEVER auto-friend.
  const isNonFriend = !!other && !(user?.friends || []).includes(other.id);

  const onMove = (body: any) => act(() => api.playMove(String(id), body));

  const renderGame = () => {
    if (game === "this_or_that") return <ThisOrThat session={session} me={me} busy={busy} onMove={onMove} />;
    if (game === "quick_trivia") return <QuickTrivia session={session} me={me} busy={busy} onMove={onMove} />;
    if (game === "word_chain") return <WordChain session={session} me={me} busy={busy} onMove={onMove} />;
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* #2 (Garry, Sep 2026): during RANDOM matchmaking the session is
          pre-seeded with a candidate opponent, but their name must NOT be
          shown until they've actually accepted — otherwise the header reads
          "with Ash" while the body still says "Waiting for a player…". Only
          reveal the opponent once the game is no longer in the pending
          "invited" state for a matchmaking session. */}
      <Header
        title={game ? LABELS[game] : "Play Together"}
        subtitle={other && !(status === "invited" && session?.origin === "matchmaking") ? `with ${other.name}` : undefined}
        onBack={() => router.back()}
      />
      {err && (
        <View style={[styles.errBar, { backgroundColor: c.error }]}>
          <Text style={styles.errTxt}>{err}</Text>
        </View>
      )}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={c.brand} /></View>
          ) : fatal ? (
            <View style={styles.centre}>
              <Text style={{ fontSize: 44 }}>🎲</Text>
              <Text style={[styles.big, { color: c.onSurface, fontSize: 18 * scale }]}>{fatal}</Text>
              <Pressable onPress={() => router.replace("/games/play")} style={[styles.primary, { backgroundColor: c.brand }]}>
                <Text style={styles.primaryTxt}>Back to Play Together</Text>
              </Pressable>
            </View>
          ) : status === "declined" ? (
            <View style={styles.centre}>
              <Text style={{ fontSize: 44 }}>🤗</Text>
              <Text style={[styles.big, { color: c.onSurface, fontSize: 18 * scale }]}>
                {other?.name || "Your friend"} can't play right now
              </Text>
              <Text style={[styles.sub, { color: c.muted, fontSize: 14 * scale }]}>No worries — plenty of others would love a game.</Text>
              <Pressable testID="play-invite-someone-else" onPress={() => router.replace("/games/play")} style={[styles.primary, { backgroundColor: c.brand }]}>
                <Text style={styles.primaryTxt}>Invite someone else</Text>
              </Pressable>
              <Pressable onPress={() => router.replace("/games/play")} style={[styles.secondary, { borderColor: c.border }]}>
                <Text style={[styles.secondaryTxt, { color: c.muted }]}>Back to Play Together</Text>
              </Pressable>
            </View>
          ) : status === "invited" && !iAmHost ? (
            <View style={styles.centre}>
              <Text style={{ fontSize: 48 }}>🎉</Text>
              <Text style={[styles.big, { color: c.onSurface, fontSize: 20 * scale }]}>
                {other?.name || "A friend"} invited you to play {game ? LABELS[game] : "a game"}!
              </Text>
              <Pressable testID="play-accept" onPress={() => act(() => api.playAccept(String(id)))} style={[styles.primary, { backgroundColor: c.brand }]}>
                <Text style={styles.primaryTxt}>Accept & Play</Text>
              </Pressable>
              <Pressable testID="play-decline" onPress={() => act(() => api.playDecline(String(id)))} style={[styles.secondary, { borderColor: c.border }]}>
                <Text style={[styles.secondaryTxt, { color: c.muted }]}>Maybe later</Text>
              </Pressable>
            </View>
          ) : status === "invited" && iAmHost ? (
            <View style={styles.centre}>
              <ActivityIndicator color={c.brand} />
              <Text style={[styles.big, { color: c.onSurface, fontSize: 18 * scale }]}>
                {session?.origin === "matchmaking"
                  ? "Waiting for a player…"
                  : `Waiting for ${other?.name || "your friend"} to accept…`}
              </Text>
              <Text style={[styles.sub, { color: c.muted, fontSize: 14 * scale }]}>
                {session?.origin === "matchmaking"
                  ? `We're finding someone to play ${game ? LABELS[game] : ""} with you.`
                  : `We'll let them know you'd like to play ${game ? LABELS[game] : ""}.`}
              </Text>
              <Pressable
                testID="play-cancel"
                onPress={() => act(async () => {
                  await api.playCancel(String(id));
                  router.replace("/games/play");
                  return null;
                })}
                disabled={busy}
                style={[styles.primary, { backgroundColor: c.error, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={styles.primaryTxt}>Cancel invite</Text>
              </Pressable>
              <Pressable onPress={() => router.replace("/games/play")} style={[styles.secondary, { borderColor: c.border }]}>
                <Text style={[styles.secondaryTxt, { color: c.muted }]}>Back to Play Together</Text>
              </Pressable>
            </View>
          ) : status === "cancelled" ? (
            <View style={styles.centre}>
              <Text style={{ fontSize: 44 }}>🌼</Text>
              <Text style={[styles.big, { color: c.onSurface, fontSize: 18 * scale }]}>
                This game invite was cancelled
              </Text>
              <Text style={[styles.sub, { color: c.muted, fontSize: 14 * scale }]}>
                {other?.name || "Your friend"} withdrew the invite — maybe another time.
              </Text>
              <Pressable onPress={() => router.replace("/games/play")} style={[styles.primary, { backgroundColor: c.brand }]}>
                <Text style={styles.primaryTxt}>Back to Play Together</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {renderGame()}
              {status === "finished" && (
                <View style={{ gap: 10, marginTop: 4 }}>
                  {isNonFriend ? (
                    friendReqSent ? (
                      <View style={[styles.sentPill, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                        <Text style={{ color: c.muted, fontWeight: "800", fontSize: 15 }}>✓ Friend request sent to {other?.name}</Text>
                      </View>
                    ) : (
                      <Pressable testID="play-add-friend" disabled={busy} onPress={() => act(async () => {
                        await api.sendFriendReq(me, other.id);
                        setFriendReqSent(true);
                        return null;
                      })} style={[styles.primary, { backgroundColor: c.brand, opacity: busy ? 0.7 : 1 }]}>
                        <Text style={styles.primaryTxt}>Send friend request</Text>
                      </Pressable>
                    )
                  ) : null}
                  <Pressable testID="play-again" onPress={() => act(async () => {
                    const s = await api.playRematch(String(id));
                    if (s?.id) {
                      setFriendReqSent(false);
                      // Object-form replace reliably swaps the [id] param for
                      // an unlimited chain of rematches (a bare string path
                      // could keep the stale finished session mounted after a
                      // couple of hops). The reset effect below clears state.
                      router.replace({ pathname: "/games/play/[id]", params: { id: s.id } });
                    }
                    return null;
                  })} style={[
                    isNonFriend ? styles.secondary : styles.primary,
                    isNonFriend ? { borderColor: c.border } : { backgroundColor: c.brand },
                  ]}>
                    <Text style={isNonFriend ? [styles.secondaryTxt, { color: c.onSurface }] : styles.primaryTxt}>Play again</Text>
                  </Pressable>
                  <Pressable onPress={() => router.replace("/games/play")} style={[styles.secondary, { borderColor: c.border }]}>
                    <Text style={[styles.secondaryTxt, { color: c.muted }]}>{isNonFriend ? "Not now" : "Back to Play Together"}</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  errBar: { paddingVertical: 10, paddingHorizontal: 16 },
  errTxt: { color: "#FFF", fontWeight: "700", textAlign: "center" },
  centre: { alignItems: "center", gap: 12, paddingVertical: 30 },
  big: { fontWeight: "800", textAlign: "center", lineHeight: 27 },
  sub: { fontWeight: "600", textAlign: "center" },
  primary: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, marginTop: 6, alignSelf: "stretch" },
  primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 16 },
  secondary: { minHeight: 50, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, alignSelf: "stretch" },
  secondaryTxt: { fontWeight: "700", fontSize: 15 },
  sentPill: { minHeight: 50, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, alignSelf: "stretch" },
});
