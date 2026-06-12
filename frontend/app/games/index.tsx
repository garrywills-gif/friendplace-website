import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const GAMES = [
  { key: "bingo", title: "Bingo", emoji: "🎱", color: "#0F766E", route: "/games/bingo" },
  { key: "trivia", title: "Trivia", emoji: "🎯", color: "#0369A1", route: "/games/trivia" },
  { key: "wordsearch", title: "Word Search", emoji: "🔠", color: "#0EA5E9", route: "/games/wordsearch" },
  { key: "jigsaw", title: "Jigsaw", emoji: "🧩", color: "#14B8A6", route: "/games/jigsaw" },
  { key: "quiz", title: "Daily Quiz", emoji: "🌟", color: "#8B5CF6", route: "/games/quiz" },
];

export default function Games() {
  const router = useRouter();
  const { c, scale } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Games" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ color: c.muted, fontSize: 16 * scale, fontWeight: "600", textAlign: "center", marginBottom: 8 }}>Have fun & earn Butterfly Points 🦋</Text>
        <View style={styles.grid}>
          {GAMES.map((g) => (
            <Pressable
              key={g.key}
              testID={`game-${g.key}`}
              onPress={() => router.push(g.route as any)}
              style={({ pressed }) => [styles.tile, { backgroundColor: g.color, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={{ fontSize: 56 }}>{g.emoji}</Text>
              <Text style={[styles.title, { fontSize: 22 * scale }]}>{g.title}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "48%", borderRadius: 20, padding: 20, alignItems: "center", minHeight: 170, justifyContent: "center", gap: 10 },
  title: { color: "#FFF", fontWeight: "800" },
});
