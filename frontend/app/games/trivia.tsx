import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

const QUESTIONS = [
  { q: "Which Australian city is known as the Harbour City?", opts: ["Melbourne", "Sydney", "Brisbane", "Perth"], a: 1 },
  { q: "What animal lays eggs and has a duck's bill?", opts: ["Echidna", "Wombat", "Platypus", "Quoll"], a: 2 },
  { q: "Which year did Australia federate?", opts: ["1788", "1901", "1945", "1967"], a: 1 },
  { q: "Who wrote 'Cloudstreet'?", opts: ["Tim Winton", "Peter Carey", "Helen Garner", "David Malouf"], a: 0 },
  { q: "Australia's national flower?", opts: ["Waratah", "Banksia", "Golden Wattle", "Eucalyptus"], a: 2 },
  { q: "What does 'Strewth!' mean?", opts: ["Yes", "Hello", "An exclamation of surprise", "Goodbye"], a: 2 },
];

export default function Trivia() {
  const { c, scale } = useTheme();
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const done = i >= QUESTIONS.length;

  const choose = (idx: number) => {
    if (picked !== null) return;
    setPicked(idx);
    if (idx === QUESTIONS[i].a) setScore((s) => s + 1);
  };

  const next = () => { setI(i + 1); setPicked(null); };
  const reset = () => { setI(0); setScore(0); setPicked(null); };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Trivia" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {done ? (
          <View style={[styles.result, { backgroundColor: c.brandTertiary }]}>
            <Text style={{ fontSize: 80 }}>🏆</Text>
            <Text testID="trivia-result" style={{ color: c.brand, fontSize: 32 * scale, fontWeight: "900" }}>{score} / {QUESTIONS.length}</Text>
            <Text style={{ color: c.onBrandTertiary, fontSize: 18 * scale, marginTop: 6 }}>Nicely done!</Text>
            <View style={{ marginTop: 16, width: "100%" }}>
              <Button testID="trivia-restart" label="Play again" onPress={reset} />
            </View>
          </View>
        ) : (
          <>
            <Text style={{ color: c.muted, fontSize: 14 * scale, fontWeight: "700" }}>Question {i + 1} of {QUESTIONS.length}  ·  Score: {score}</Text>
            <View style={[styles.qBox, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Text style={{ color: c.onSurface, fontSize: 20 * scale, fontWeight: "700", lineHeight: 28 }}>{QUESTIONS[i].q}</Text>
            </View>
            {QUESTIONS[i].opts.map((o, idx) => {
              const isCorrect = picked !== null && idx === QUESTIONS[i].a;
              const isWrong = picked === idx && idx !== QUESTIONS[i].a;
              return (
                <Pressable
                  key={idx}
                  testID={`trivia-opt-${idx}`}
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
            {picked !== null && <Button testID="trivia-next" label={i === QUESTIONS.length - 1 ? "See result" : "Next"} onPress={next} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  qBox: { padding: 18, borderRadius: 18, borderWidth: 1 },
  opt: { padding: 18, borderRadius: 16, borderWidth: 2, minHeight: 60, justifyContent: "center" },
  result: { padding: 28, borderRadius: 24, alignItems: "center", gap: 8 },
});
