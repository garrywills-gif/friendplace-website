import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const POOL = [
  { q: "How many minutes are there in a day?", opts: ["1,260", "1,440", "1,560", "1,260"], a: 1 },
  { q: "Which Australian state has the Great Barrier Reef?", opts: ["NSW", "Queensland", "Victoria", "WA"], a: 1 },
  { q: "What's the capital of New Zealand?", opts: ["Auckland", "Christchurch", "Wellington", "Hamilton"], a: 2 },
  { q: "Which planet is closest to the Sun?", opts: ["Venus", "Mars", "Mercury", "Earth"], a: 2 },
  { q: "Who painted the Mona Lisa?", opts: ["Van Gogh", "Picasso", "Da Vinci", "Monet"], a: 2 },
  { q: "Which year did the Sydney Opera House open?", opts: ["1959", "1973", "1985", "1990"], a: 1 },
  { q: "How many strings does a violin have?", opts: ["3", "4", "5", "6"], a: 1 },
  { q: "The Australian $50 note features whom?", opts: ["Mary Reibey", "David Unaipon", "John Flynn", "Catherine Helen Spence"], a: 1 },
  { q: "Which spice is the world's most expensive by weight?", opts: ["Vanilla", "Saffron", "Cardamom", "Cinnamon"], a: 1 },
  { q: "What is the largest ocean on Earth?", opts: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
];

function pickFive(seed: number): typeof POOL {
  // Daily quiz: 5 questions, deterministic per day
  const arr = POOL.slice();
  // simple Fisher-Yates with seeded prng
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 5);
}

export default function DailyQuiz() {
  const { c, scale } = useTheme();
  const today = new Date();
  const daySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const questions = useMemo(() => pickFive(daySeed), [daySeed]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const done = i >= questions.length;
  const dateLabel = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const choose = (idx: number) => {
    if (picked !== null) return;
    setPicked(idx);
    if (idx === questions[i].a) setScore((s) => s + 1);
  };
  const next = () => { setI(i + 1); setPicked(null); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Daily Quiz" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={[styles.banner, { backgroundColor: "#F5F3FF", borderColor: "#8B5CF6" }]}>
          <Text style={{ fontSize: 36 }}>🌟</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: "#6D28D9", fontWeight: "900", fontSize: 18 * scale }}>Today's Quiz</Text>
            <Text style={{ color: "#475569", fontSize: 14 * scale }}>{dateLabel}</Text>
          </View>
        </View>
        {done ? (
          <View style={[styles.result, { backgroundColor: c.brandTertiary }]}>
            <Text style={{ fontSize: 80 }}>🏆</Text>
            <Text testID="quiz-result" style={{ color: c.brand, fontSize: 32 * scale, fontWeight: "900" }}>{score} / {questions.length}</Text>
            <Text style={{ color: c.onBrandTertiary, fontSize: 18 * scale, marginTop: 6, textAlign: "center" }}>Lovely effort! Come back tomorrow for a fresh quiz.</Text>
          </View>
        ) : (
          <>
            <Text style={{ color: c.muted, fontSize: 14 * scale, fontWeight: "700" }}>Question {i + 1} of {questions.length} · Score: {score}</Text>
            <View style={[styles.qBox, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={{ color: c.onSurface, fontSize: 20 * scale, fontWeight: "700", lineHeight: 28 }}>{questions[i].q}</Text>
            </View>
            {questions[i].opts.map((o, idx) => {
              const isCorrect = picked !== null && idx === questions[i].a;
              const isWrong = picked === idx && idx !== questions[i].a;
              return (
                <Pressable
                  key={idx}
                  testID={`quiz-opt-${idx}`}
                  onPress={() => choose(idx)}
                  style={[styles.opt, {
                    backgroundColor: isCorrect ? c.success : isWrong ? c.error : c.surfaceSecondary,
                    borderColor: isCorrect ? c.success : isWrong ? c.error : c.border,
                  }]}
                >
                  <Text style={{ color: isCorrect || isWrong ? "#FFF" : c.onSurface, fontWeight: "700", fontSize: 17 * scale }}>{o}</Text>
                </Pressable>
              );
            })}
            {picked !== null && <Button testID="quiz-next" label={i === questions.length - 1 ? "See result" : "Next"} onPress={next} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 2 },
  qBox: { padding: 18, borderRadius: 18, borderWidth: 1 },
  opt: { padding: 18, borderRadius: 16, borderWidth: 2, minHeight: 60, justifyContent: "center" },
  result: { padding: 28, borderRadius: 24, alignItems: "center", gap: 8 },
});
