import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/src/lib/theme";

type ChainItem = { player_id: string; word: string };
type Props = {
  session: any;
  me: string;
  busy: boolean;
  onMove: (body: { word?: string; give_up?: boolean }) => void;
};

export default function WordChain({ session, me, busy, onMove }: Props) {
  const { c, scale } = useTheme();
  const content = session?.content || {};
  const chain: ChainItem[] = content.chain || [];
  const required: string = content.required_letter || "";
  const category: string = content.category || "";
  const mePlayer = (session.players || []).find((p: any) => p.id === me);
  const other = (session.players || []).find((p: any) => p.id !== me);
  const finished = session.status === "finished";
  const myTurn = session.turn === me && !finished;
  const [word, setWord] = useState("");

  const nameFor = (pid: string) =>
    (session.players || []).find((p: any) => p.id === pid)?.name || "Friend";

  const send = () => {
    const w = word.trim();
    if (!w || busy) return;
    onMove({ word: w });
    setWord("");
  };

  if (finished) {
    const winnerId = session.winner_id;
    const iWon = winnerId === me;
    const shared = !winnerId;
    return (
      <View style={{ gap: 14 }}>
        <View style={[styles.scoreCard, { backgroundColor: shared ? c.accent : iWon ? c.brand : c.surfaceSecondary, borderWidth: shared || iWon ? 0 : 1, borderColor: c.border }]}>
          <Text style={{ fontSize: 44 }}>{shared ? "🤝" : iWon ? "🏆" : "👏"}</Text>
          <Text style={[styles.scoreLabel, { color: shared || iWon ? "#FFF" : c.onSurface }]}>
            {shared ? "You reached the target together!" : iWon ? "You win!" : `${other?.name || "Your friend"} wins!`}
          </Text>
          <Text style={[styles.scoreSub, { color: shared || iWon ? "#FFF" : c.muted }]}>
            {chain.length} words · you {mePlayer?.score ?? 0} · {other?.name || "friend"} {other?.score ?? 0}
          </Text>
        </View>
        <View style={styles.chainWrap}>
          {chain.map((it, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: it.player_id === me ? c.brandTertiary : c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.chipTxt, { color: c.onSurface, fontSize: 14 * scale }]}>{it.word}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.catCard, { backgroundColor: c.brand }]}>
        <Text style={[styles.catLabel, { color: "#FFF" }]}>CATEGORY</Text>
        <Text style={[styles.catName, { color: "#FFF" }]}>{category}</Text>
        <Text style={[styles.catRule, { color: "#FFF" }]}>
          Say a word starting with{"  "}
          <Text style={{ fontWeight: "900", fontSize: 22 * scale }}>{required}</Text>
        </Text>
      </View>

      {chain.length > 0 && (
        <View style={styles.chainWrap}>
          {chain.map((it, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: it.player_id === me ? c.brandTertiary : c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={[styles.chipTxt, { color: c.onSurface, fontSize: 14 * scale }]}>{it.word}</Text>
            </View>
          ))}
        </View>
      )}

      {myTurn ? (
        <View style={{ gap: 10 }}>
          <TextInput
            testID="wc-input"
            value={word}
            onChangeText={setWord}
            placeholder={`A word starting with ${required}…`}
            placeholderTextColor={c.muted}
            autoCapitalize="words"
            autoCorrect={false}
            onSubmitEditing={send}
            returnKeyType="send"
            style={[styles.input, { borderColor: c.border, color: c.onSurface, backgroundColor: c.surface, fontSize: 17 * scale }]}
          />
          <Pressable testID="wc-send" onPress={send} disabled={!word.trim() || busy} style={[styles.submit, { backgroundColor: word.trim() ? c.brand : c.surfaceTertiary, opacity: busy ? 0.6 : 1 }]}>
            <Text style={[styles.submitTxt, { color: word.trim() ? "#FFF" : c.muted }]}>Play word</Text>
          </Pressable>
          <Pressable testID="wc-pass" onPress={() => onMove({ give_up: true })} disabled={busy} style={[styles.pass, { borderColor: c.border }]}>
            <Text style={{ color: c.muted, fontWeight: "700" }}>I can't think of one — pass</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.waitBox}>
          <Text style={{ fontSize: 40 }}>💭</Text>
          <Text style={[styles.waitTxt, { color: c.onSurface, fontSize: 16 * scale }]}>
            {nameFor(session.turn)}'s turn…
          </Text>
          <Text style={[styles.waitSub, { color: c.muted, fontSize: 13.5 * scale }]}>
            First to reach 12 words together wins the round.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  catCard: { borderRadius: 18, alignItems: "center", paddingVertical: 18, gap: 4 },
  catLabel: { fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  catName: { fontWeight: "900", fontSize: 26 },
  catRule: { fontWeight: "600", fontSize: 15, marginTop: 4 },
  chainWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipTxt: { fontWeight: "700" },
  input: { minHeight: 56, borderRadius: 16, borderWidth: 2, paddingHorizontal: 16, fontWeight: "600" },
  submit: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  submitTxt: { fontWeight: "800", fontSize: 16 },
  pass: { minHeight: 48, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  waitBox: { alignItems: "center", gap: 8, paddingVertical: 30 },
  waitTxt: { fontWeight: "800" },
  waitSub: { fontWeight: "600", textAlign: "center" },
  scoreCard: { borderRadius: 20, alignItems: "center", paddingVertical: 22, gap: 6 },
  scoreLabel: { fontWeight: "800", fontSize: 18, textAlign: "center", paddingHorizontal: 12 },
  scoreSub: { fontWeight: "600", fontSize: 13 },
});
