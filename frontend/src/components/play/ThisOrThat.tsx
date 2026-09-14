import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/lib/theme";

type Prompt = { id: string; a: string; b: string };
type Props = {
  session: any;
  me: string;
  busy: boolean;
  onMove: (body: { answers: number[] }) => void;
};

export default function ThisOrThat({ session, me, busy, onMove }: Props) {
  const { c, scale } = useTheme();
  const prompts: Prompt[] = session?.content?.prompts || [];
  const mePlayer = (session.players || []).find((p: any) => p.id === me);
  const other = (session.players || []).find((p: any) => p.id !== me);
  const [picks, setPicks] = useState<Record<number, number>>({});

  const done = !!mePlayer?.done;
  const finished = session.status === "finished";
  const allPicked = prompts.length > 0 && Object.keys(picks).length === prompts.length;

  const myAnswers: number[] | null = session?.content?.answers?.[me] || null;
  const otherAnswers: number[] | null = finished ? session?.content?.answers?.[other?.id] : null;
  const matches = session?.content?.matches ?? 0;

  const submit = () => {
    if (!allPicked || busy) return;
    onMove({ answers: prompts.map((_, i) => picks[i]) });
  };

  const optionStyle = (chosen: boolean) => [
    styles.opt,
    { borderColor: chosen ? c.brand : c.border, backgroundColor: chosen ? c.brandTertiary : c.surface },
  ];

  const resultRows = useMemo(() => {
    if (!finished || !myAnswers) return null;
    return prompts.map((p, i) => {
      const mine = myAnswers[i];
      const theirs = otherAnswers ? otherAnswers[i] : null;
      const match = theirs != null && mine === theirs;
      return (
        <View key={p.id} style={[styles.resRow, { borderColor: c.border, backgroundColor: c.surface }]}>
          <Text style={{ fontSize: 20 }}>{match ? "💛" : "↔️"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.resTxt, { color: c.onSurface, fontSize: 15 * scale }]}>
              You: {mine === 0 ? p.a : p.b}
            </Text>
            {theirs != null && (
              <Text style={[styles.resTxt, { color: c.muted, fontSize: 14 * scale }]}>
                {other?.name || "Friend"}: {theirs === 0 ? p.a : p.b}
              </Text>
            )}
          </View>
        </View>
      );
    });
  }, [finished, myAnswers, otherAnswers, prompts, c, scale, other]);

  if (finished) {
    return (
      <View style={{ gap: 12 }}>
        <View style={[styles.scoreCard, { backgroundColor: c.brand }]}>
          <Text style={[styles.bigNum, { color: "#FFF" }]}>{matches} / {prompts.length}</Text>
          <Text style={[styles.scoreLabel, { color: "#FFF" }]}>
            {matches >= 4 ? "You two are in sync! 💫" : matches >= 2 ? "Nice — a few things in common!" : "Opposites attract! 😄"}
          </Text>
        </View>
        {resultRows}
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.waitBox}>
        <Text style={{ fontSize: 40 }}>⏳</Text>
        <Text style={[styles.waitTxt, { color: c.onSurface, fontSize: 17 * scale }]}>
          Answers locked in!
        </Text>
        <Text style={[styles.waitSub, { color: c.muted, fontSize: 14 * scale }]}>
          Waiting for {other?.name || "your friend"} to finish…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Text style={[styles.intro, { color: c.muted, fontSize: 14 * scale }]}>
        Tap your pick for each — then see how many you match on!
      </Text>
      {prompts.map((p, i) => (
        <View key={p.id} style={{ gap: 8 }}>
          <View style={styles.row}>
            <Pressable testID={`tot-${i}-a`} onPress={() => setPicks((s) => ({ ...s, [i]: 0 }))} style={optionStyle(picks[i] === 0)}>
              <Text style={[styles.optTxt, { color: c.onSurface, fontSize: 16 * scale }]}>{p.a}</Text>
            </Pressable>
            <View style={[styles.vs, { backgroundColor: c.surfaceTertiary }]}>
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 }}>or</Text>
            </View>
            <Pressable testID={`tot-${i}-b`} onPress={() => setPicks((s) => ({ ...s, [i]: 1 }))} style={optionStyle(picks[i] === 1)}>
              <Text style={[styles.optTxt, { color: c.onSurface, fontSize: 16 * scale }]}>{p.b}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Pressable
        testID="tot-submit"
        onPress={submit}
        disabled={!allPicked || busy}
        style={[styles.submit, { backgroundColor: allPicked ? c.brand : c.surfaceTertiary, opacity: busy ? 0.6 : 1 }]}
      >
        <Text style={[styles.submitTxt, { color: allPicked ? "#FFF" : c.muted }]}>
          {allPicked ? "Lock in my answers" : `Pick all ${prompts.length}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontWeight: "600", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  opt: { flex: 1, minHeight: 60, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  optTxt: { fontWeight: "700", textAlign: "center" },
  vs: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  submit: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", marginTop: 6 },
  submitTxt: { fontWeight: "800", fontSize: 16 },
  waitBox: { alignItems: "center", gap: 8, paddingVertical: 36 },
  waitTxt: { fontWeight: "800" },
  waitSub: { fontWeight: "600", textAlign: "center" },
  scoreCard: { borderRadius: 20, alignItems: "center", paddingVertical: 24, gap: 4 },
  bigNum: { fontWeight: "900", fontSize: 40 },
  scoreLabel: { fontWeight: "700", fontSize: 15 },
  resRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  resTxt: { fontWeight: "600" },
});
