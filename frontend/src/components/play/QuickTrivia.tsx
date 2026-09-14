import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/lib/theme";

type Q = { id: string; q: string; choices: string[]; answer?: number };
type Props = {
  session: any;
  me: string;
  busy: boolean;
  onMove: (body: { answers: number[] }) => void;
};

export default function QuickTrivia({ session, me, busy, onMove }: Props) {
  const { c, scale } = useTheme();
  const questions: Q[] = session?.content?.questions || [];
  const mePlayer = (session.players || []).find((p: any) => p.id === me);
  const other = (session.players || []).find((p: any) => p.id !== me);
  const finished = session.status === "finished";
  const done = !!mePlayer?.done;

  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState<Record<number, number>>({});

  const current = questions[idx];
  const allAnswered = questions.length > 0 && Object.keys(picks).length === questions.length;

  const choose = (ci: number) => {
    if (busy) return;
    setPicks((s) => ({ ...s, [idx]: ci }));
    setTimeout(() => setIdx((i) => Math.min(i + 1, questions.length - 1)), 180);
  };

  const submit = () => {
    if (!allAnswered || busy) return;
    onMove({ answers: questions.map((_, i) => picks[i]) });
  };

  if (finished) {
    const winnerId = session.winner_id;
    const myScore = mePlayer?.score ?? 0;
    const otherScore = other?.score ?? 0;
    const iWon = winnerId === me;
    const tie = !winnerId;
    return (
      <View style={{ gap: 14 }}>
        <View style={[styles.scoreCard, { backgroundColor: iWon ? c.brand : tie ? c.accent : c.surfaceSecondary, borderWidth: iWon || !tie ? 0 : 1, borderColor: c.border }]}>
          <Text style={{ fontSize: 44 }}>{tie ? "🤝" : iWon ? "🏆" : "🎉"}</Text>
          <Text style={[styles.scoreLabel, { color: iWon || tie ? "#FFF" : c.onSurface }]}>
            {tie ? "It's a tie!" : iWon ? "You won!" : `${other?.name || "Your friend"} won this round`}
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <View style={[styles.tallyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.tallyName, { color: c.muted, fontSize: 13 * scale }]}>You</Text>
            <Text style={[styles.tallyNum, { color: c.brand }]}>{myScore}</Text>
          </View>
          <View style={[styles.tallyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.tallyName, { color: c.muted, fontSize: 13 * scale }]}>{other?.name || "Friend"}</Text>
            <Text style={[styles.tallyNum, { color: c.onSurface }]}>{otherScore}</Text>
          </View>
        </View>
        <Text style={[styles.reviewHead, { color: c.muted, fontSize: 13 * scale }]}>YOUR ANSWERS</Text>
        {questions.map((q, i) => {
          const mine = session?.content?.answers?.[me]?.[i];
          const correct = mine === q.answer;
          return (
            <View key={q.id} style={[styles.reviewRow, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Text style={{ fontSize: 18 }}>{correct ? "✅" : "❌"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reviewQ, { color: c.onSurface, fontSize: 14.5 * scale }]}>{q.q}</Text>
                {!correct && q.answer != null && (
                  <Text style={[styles.reviewA, { color: c.brand, fontSize: 13.5 * scale }]}>
                    Answer: {q.choices[q.answer]}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.waitBox}>
        <Text style={{ fontSize: 40 }}>⏳</Text>
        <Text style={[styles.waitTxt, { color: c.onSurface, fontSize: 17 * scale }]}>All answered!</Text>
        <Text style={[styles.waitSub, { color: c.muted, fontSize: 14 * scale }]}>
          Waiting for {other?.name || "your friend"} to finish…
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.progressRow}>
        {questions.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: picks[i] != null ? c.brand : i === idx ? c.accent : c.surfaceTertiary }]}
          />
        ))}
      </View>
      <Text style={[styles.qCount, { color: c.muted, fontSize: 13 * scale }]}>
        Question {idx + 1} of {questions.length}
      </Text>
      {current && (
        <>
          <Text style={[styles.question, { color: c.onSurface, fontSize: 20 * scale }]}>{current.q}</Text>
          <View style={{ gap: 10 }}>
            {current.choices.map((ch, ci) => {
              const chosen = picks[idx] === ci;
              return (
                <Pressable
                  key={ci}
                  testID={`trivia-q${idx}-c${ci}`}
                  onPress={() => choose(ci)}
                  style={[styles.choice, { borderColor: chosen ? c.brand : c.border, backgroundColor: chosen ? c.brandTertiary : c.surface }]}
                >
                  <Text style={[styles.choiceTxt, { color: c.onSurface, fontSize: 16 * scale }]}>{ch}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <View style={styles.navRow}>
        <Pressable disabled={idx === 0} onPress={() => setIdx((i) => Math.max(0, i - 1))} style={[styles.navBtn, { borderColor: c.border, opacity: idx === 0 ? 0.4 : 1 }]}>
          <Text style={{ color: c.onSurface, fontWeight: "700" }}>Back</Text>
        </Pressable>
        {idx < questions.length - 1 ? (
          <Pressable disabled={picks[idx] == null} onPress={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} style={[styles.navBtn, { borderColor: c.border, opacity: picks[idx] == null ? 0.4 : 1 }]}>
            <Text style={{ color: c.onSurface, fontWeight: "700" }}>Next</Text>
          </Pressable>
        ) : (
          <Pressable testID="trivia-submit" disabled={!allAnswered || busy} onPress={submit} style={[styles.submit, { backgroundColor: allAnswered ? c.brand : c.surfaceTertiary, opacity: busy ? 0.6 : 1 }]}>
            <Text style={[styles.submitTxt, { color: allAnswered ? "#FFF" : c.muted }]}>{allAnswered ? "Submit" : "Answer all"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: "row", gap: 6, justifyContent: "center" },
  dot: { width: 22, height: 6, borderRadius: 3 },
  qCount: { fontWeight: "700", textAlign: "center" },
  question: { fontWeight: "800", textAlign: "center", lineHeight: 27 },
  choice: { minHeight: 56, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  choiceTxt: { fontWeight: "600", textAlign: "center" },
  navRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  navBtn: { flex: 1, minHeight: 50, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  submit: { flex: 1, minHeight: 50, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  submitTxt: { fontWeight: "800", fontSize: 16 },
  waitBox: { alignItems: "center", gap: 8, paddingVertical: 36 },
  waitTxt: { fontWeight: "800" },
  waitSub: { fontWeight: "600", textAlign: "center" },
  scoreCard: { borderRadius: 20, alignItems: "center", paddingVertical: 22, gap: 6 },
  scoreLabel: { fontWeight: "800", fontSize: 18 },
  scoreRow: { flexDirection: "row", gap: 12 },
  tallyCard: { flex: 1, borderRadius: 16, borderWidth: 1, alignItems: "center", paddingVertical: 14, gap: 2 },
  tallyName: { fontWeight: "700" },
  tallyNum: { fontWeight: "900", fontSize: 30 },
  reviewHead: { fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
  reviewRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12 },
  reviewQ: { fontWeight: "600" },
  reviewA: { fontWeight: "700", marginTop: 2 },
});
