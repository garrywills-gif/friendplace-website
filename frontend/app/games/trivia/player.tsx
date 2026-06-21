import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import SpeakButton from "@/src/components/SpeakButton";
import Button from "@/src/components/Button";

type Question = { id: string; category: string; difficulty: string; q: string; choices: string[] };
type Session = {
  id: string;
  category: string;
  difficulty: string;
  question_ids: string[];
  questions: Question[];
  answers: any[];
  current_index: number;
  lifelines: { fifty_used: boolean; skip_used: boolean };
  score: number;
  completed: boolean;
  is_daily?: boolean;
};

export default function TriviaPlayer() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ sid?: string }>();
  const sid = String(params.sid || "");
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; correct_answer: number; explain?: string } | null>(null);
  const [hiddenChoices, setHiddenChoices] = useState<number[]>([]);
  const [completion, setCompletion] = useState<any>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; cta: string; onConfirm: () => void }>(null);

  const load = useCallback(async () => {
    if (!user || !sid) return;
    try {
      const s: any = await api.triviaGetSession(user.id, sid);
      setSession(s);
    } catch (e) {
      console.warn("trivia load failed", e);
    } finally { setLoading(false); }
  }, [user?.id, sid]);

  useEffect(() => { load(); }, [load]);

  const question = useMemo<Question | null>(() => {
    if (!session || !session.questions || session.completed) return null;
    return session.questions[session.current_index] || session.questions[session.questions.length - 1];
  }, [session]);

  // Clear local UI state when moving to a different question
  useEffect(() => {
    setPicked(null);
    setFeedback(null);
    setHiddenChoices([]);
  }, [question?.id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Trivia" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={c.brand} />
        </View>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Trivia" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Ionicons name="alert-circle" size={42} color={c.muted} />
          <Text style={{ color: c.onSurface, fontSize: 18 * scale, marginTop: 12 }}>Session not found.</Text>
          <Button label="Back to Trivia" onPress={() => router.replace("/games/trivia")} style={{ marginTop: 16 }} />
        </View>
      </View>
    );
  }

  // ---- Completed / results view ----
  if (completion || session.completed) {
    const score = completion?.score ?? session.score;
    const total = completion?.total ?? session.question_ids.length;
    const pts = completion?.points_earned ?? 0;
    const granted: string[] = completion?.granted || [];
    const pct = total ? Math.round((score / total) * 100) : 0;
    const tone = pct >= 80 ? "#16A34A" : pct >= 60 ? c.brand : pct >= 40 ? "#B45309" : "#7C3AED";
    const summary = `You scored ${score} out of ${total}. That's ${pct}%. You earned ${pts} Belong Points.`;
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Trivia" />
        <ScrollView contentContainerStyle={{ padding: 18, gap: 14, alignItems: "center" }}>
          <Text style={{ fontSize: 80 }}>{pct >= 60 ? "\uD83C\uDFC6" : "\uD83C\uDF40"}</Text>
          <Text testID="trivia-result" style={{ color: tone, fontWeight: "900", fontSize: 42 * scale }}>{score} / {total}</Text>
          <Text style={{ color: c.onSurface, fontSize: 18 * scale }}>{pct}% correct</Text>
          <View style={[styles.resultCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 13 * scale, letterSpacing: 0.4 }}>SUMMARY</Text>
              <SpeakButton text={summary} color={c.brand} size={20} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 16 * scale, marginTop: 6 }}>
              You earned <Text style={{ fontWeight: "900", color: c.brand }}>+{pts}</Text> Belong Points.
            </Text>
            {granted.length > 0 && (
              <View style={{ marginTop: 10, gap: 4 }}>
                {granted.map((g) => (
                  <Text key={g} style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale }}>
                    {"\u2728"} New achievement: {prettyAch(g)}
                  </Text>
                ))}
              </View>
            )}
          </View>
          {/* Per-question recap */}
          <View style={{ width: "100%", marginTop: 8 }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale, marginBottom: 8 }}>Review answers</Text>
            <View style={{ gap: 8 }}>
              {session.questions.map((q, idx) => {
                const ans = (session.answers || []).find((a: any) => a.qid === q.id);
                const correct = ans?.correct;
                const skipped = ans?.skipped;
                return (
                  <View key={q.id} style={[styles.reviewRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <View style={[styles.reviewIcon, { backgroundColor: correct ? "#16A34A22" : skipped ? "#B4530922" : "#DC262622" }]}>
                      <Ionicons name={correct ? "checkmark" : skipped ? "play-skip-forward" : "close"} size={18} color={correct ? "#16A34A" : skipped ? "#B45309" : "#DC2626"} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 14 * scale }} numberOfLines={2}>
                        {idx + 1}. {q.q}
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }}>
                        Answer: {q.choices[ans?.correct_answer ?? -1] || "—"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          <View style={{ width: "100%", gap: 10, marginTop: 18 }}>
            <Button label="Play another" onPress={() => router.replace("/games/trivia")} />
            <Button label="Back to Games Hub" variant="outline" onPress={() => router.replace("/games")} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // ---- Playing view ----
  if (!question) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <Header title="Trivia" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={c.brand} />
        </View>
      </View>
    );
  }

  const total = session.question_ids.length;
  const qIndex = session.current_index;
  const isLast = qIndex >= total - 1;

  const submitAnswer = async (idx: number) => {
    if (picked !== null || submitting) return;
    setSubmitting(true);
    setPicked(idx);
    try {
      const res: any = await api.triviaAnswer(user!.id, sid, { qid: question.id, picked: idx, advance: false });
      setFeedback({ correct: !!res.correct, correct_answer: res.correct_answer, explain: res.explain });
      setSession((s) => s ? { ...s, score: res.score, answers: [...(s.answers || []).filter((a: any) => a.qid !== question.id), { qid: question.id, picked: idx, correct: res.correct, correct_answer: res.correct_answer, explain: res.explain }] } : s);
    } catch (e) {
      console.warn("answer failed", e);
      setPicked(null);
    } finally { setSubmitting(false); }
  };

  const handleNext = async () => {
    if (submitting) return;
    if (isLast) {
      // finalise
      setSubmitting(true);
      try {
        const res: any = await api.triviaComplete(user!.id, sid);
        setCompletion(res);
        setSession((s) => s ? { ...s, completed: true } : s);
      } catch (e) {
        console.warn("complete failed", e);
      } finally { setSubmitting(false); }
      return;
    }
    // Advance via answer endpoint (no-op picked) — simpler: just refetch with new index
    try {
      setSubmitting(true);
      // Re-send answer with advance=true to update current_index on server.
      await api.triviaAnswer(user!.id, sid, { qid: question.id, picked: picked ?? -1, advance: true });
      const s: any = await api.triviaGetSession(user!.id, sid);
      setSession(s);
    } catch (e) { console.warn("advance failed", e); }
    finally { setSubmitting(false); }
  };

  const useFifty = () => {
    if (session.lifelines.fifty_used || picked !== null) return;
    setConfirm({
      title: "Use 50/50?",
      body: "This will remove two wrong answers. You can use it once per game.",
      cta: "Use",
      onConfirm: async () => {
        setConfirm(null);
        try {
          const res: any = await api.triviaAnswer(user!.id, sid, { qid: question.id, picked: -1, advance: false, lifelines: { fifty_used: true } });
          const ans: number = res.correct_answer;
          const all = question.choices.map((_, i) => i).filter((i) => i !== ans);
          for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
          }
          setHiddenChoices(all.slice(0, 2));
          setSession((s) => s ? {
            ...s,
            lifelines: { ...s.lifelines, fifty_used: true },
            answers: (s.answers || []).filter((a: any) => a.qid !== question.id),
            score: s.score,
          } : s);
        } catch (e) { console.warn("50/50 failed", e); }
      },
    });
  };

  const useSkip = () => {
    if (session.lifelines.skip_used || picked !== null || submitting) return;
    setConfirm({
      title: "Skip this question?",
      body: "You'll move to the next question. Skip can be used once per game.",
      cta: "Skip",
      onConfirm: async () => {
        setConfirm(null);
        setSubmitting(true);
        try {
          await api.triviaAnswer(user!.id, sid, { qid: question.id, picked: -1, advance: true, lifelines: { skip_used: true } });
          const s: any = await api.triviaGetSession(user!.id, sid);
          setSession(s);
        } catch (e) { console.warn("skip failed", e); }
        finally { setSubmitting(false); }
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Trivia" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}>
        {/* Progress + score */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.muted, fontSize: 14 * scale, fontWeight: "800" }}>
            Question {qIndex + 1} of {total}
          </Text>
          <Text style={{ color: c.brand, fontSize: 14 * scale, fontWeight: "900" }}>
            Score: {session.score}
          </Text>
        </View>
        <View style={[styles.progressBar, { backgroundColor: c.surfaceTertiary }]}>
          <View style={[styles.progressFill, { backgroundColor: c.brand, width: `${Math.round(((qIndex + (picked !== null ? 1 : 0)) / total) * 100)}%` }]} />
        </View>

        {/* Category badge */}
        <View style={[styles.catBadge, { backgroundColor: c.brandTertiary }]}>
          <Ionicons name="pricetag" size={14} color={c.brand} />
          <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.4 }}>
            {question.category.toUpperCase()} · {question.difficulty.toUpperCase()}
          </Text>
        </View>

        {/* Question card */}
        <View style={[styles.qBox, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Text style={{ color: c.onSurface, fontSize: 22 * scale, fontWeight: "800", lineHeight: 30, flex: 1, marginRight: 10 }}>
              {question.q}
            </Text>
            <SpeakButton
              text={`Question ${qIndex + 1} of ${total}. ${question.q}. Your options are: ${question.choices.map((ch, i) => `${String.fromCharCode(65 + i)}. ${ch}`).join(". ")}.`}
              color={c.brand}
              size={22}
              testID="trivia-speak-question"
            />
          </View>
        </View>

        {/* Answers */}
        <View style={{ gap: 10 }}>
          {question.choices.map((opt, idx) => {
            const isHidden = hiddenChoices.includes(idx);
            if (isHidden) {
              return (
                <View key={idx} style={[styles.opt, { backgroundColor: c.surfaceTertiary, borderColor: c.border, opacity: 0.4 }]}>
                  <Text style={{ color: c.muted, fontStyle: "italic", fontSize: 16 * scale }}>Removed by 50/50</Text>
                </View>
              );
            }
            let bg = c.surfaceSecondary;
            let bd = c.border;
            let fg = c.onSurface;
            if (feedback && idx === feedback.correct_answer) { bg = "#16A34A"; bd = "#16A34A"; fg = "#FFF"; }
            else if (picked === idx && feedback && !feedback.correct) { bg = "#DC2626"; bd = "#DC2626"; fg = "#FFF"; }
            return (
              <Pressable
                key={idx}
                testID={`trivia-opt-${idx}`}
                onPress={() => submitAnswer(idx)}
                disabled={picked !== null}
                style={[styles.opt, { backgroundColor: bg, borderColor: bd }]}
              >
                <View style={[styles.optLetter, { backgroundColor: feedback && idx === feedback.correct_answer ? "#FFFFFF33" : c.brandTertiary }]}>
                  <Text style={{ color: feedback && idx === feedback.correct_answer ? "#FFF" : c.brand, fontWeight: "900", fontSize: 15 * scale }}>{String.fromCharCode(65 + idx)}</Text>
                </View>
                <Text style={{ color: fg, fontWeight: "700", fontSize: 18 * scale, flex: 1, marginLeft: 12 }}>{opt}</Text>
                {feedback && idx === feedback.correct_answer && <Ionicons name="checkmark-circle" size={24} color="#FFF" />}
                {picked === idx && feedback && !feedback.correct && <Ionicons name="close-circle" size={24} color="#FFF" />}
              </Pressable>
            );
          })}
        </View>

        {/* Explain feedback */}
        {feedback && !!feedback.explain && (
          <View style={[styles.explain, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.4 }}>{feedback.correct ? "WELL DONE" : "GOOD TRY"}</Text>
              <SpeakButton text={feedback.explain} color={c.brand} size={20} />
            </View>
            <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>{feedback.explain}</Text>
          </View>
        )}

        {/* Lifelines */}
        {picked === null && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              testID="trivia-fifty"
              onPress={useFifty}
              disabled={session.lifelines.fifty_used}
              style={[styles.lifeline, { borderColor: session.lifelines.fifty_used ? c.border : c.brand, opacity: session.lifelines.fifty_used ? 0.45 : 1 }]}
            >
              <Ionicons name="git-branch" size={18} color={c.brand} />
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale }}>50 / 50</Text>
            </Pressable>
            <Pressable
              testID="trivia-skip"
              onPress={useSkip}
              disabled={session.lifelines.skip_used}
              style={[styles.lifeline, { borderColor: session.lifelines.skip_used ? c.border : c.brand, opacity: session.lifelines.skip_used ? 0.45 : 1 }]}
            >
              <Ionicons name="play-skip-forward" size={18} color={c.brand} />
              <Text style={{ color: c.brand, fontWeight: "900", fontSize: 14 * scale }}>Skip</Text>
            </Pressable>
          </View>
        )}

        {/* Next / Finish */}
        {picked !== null && (
          <Button
            testID="trivia-next"
            label={isLast ? "See results" : "Next question"}
            onPress={handleNext}
            loading={submitting}
          />
        )}
      </ScrollView>

      {/* Cross-platform confirm modal (Alert.alert is silent on react-native-web) */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setConfirm(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginBottom: 6 }}>{confirm?.title}</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, lineHeight: 22, marginBottom: 14 }}>{confirm?.body}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable testID="trivia-confirm-cancel" onPress={() => setConfirm(null)} style={[styles.modalBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
              </Pressable>
              <Pressable testID="trivia-confirm-ok" onPress={confirm?.onConfirm} style={[styles.modalBtn, { backgroundColor: c.brand, borderColor: c.brand }]}>
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>{confirm?.cta || "OK"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function prettyAch(key: string) {
  switch (key) {
    case "first_game": return "First step!";
    case "hard": return "Hard Challenge!";
    case "nightmare": return "Nightmare Champion!";
    case "daily_challenge": return "Daily Challenge Done";
    case "streak_7": return "7-Day Streak";
    case "streak_30": return "30-Day Streak";
    case "century": return "100 Games Completed";
    default: return key;
  }
}

const styles = StyleSheet.create({
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8 },
  catBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  qBox: { padding: 18, borderRadius: 18, borderWidth: 1 },
  opt: { padding: 16, borderRadius: 16, borderWidth: 2, minHeight: 64, flexDirection: "row", alignItems: "center" },
  optLetter: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  explain: { padding: 14, borderRadius: 14, borderWidth: 1.5 },
  lifeline: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 999, borderWidth: 2 },
  resultCard: { width: "100%", padding: 14, borderRadius: 16, borderWidth: 1 },
  reviewRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  reviewIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, padding: 18, borderRadius: 18, borderWidth: 1 },
  modalBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 999, borderWidth: 1.5 },
});
