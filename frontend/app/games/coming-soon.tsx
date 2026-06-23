import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";

export default function ComingSoon() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  const { c, scale } = useTheme();
  const router = useRouter();
  const title = typeof name === "string" ? name : "This game";
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title={title} />
      <View style={styles.wrap}>
        <Ionicons name="sparkles" size={48} color={c.brand} />
        <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, textAlign: "center", marginTop: 12 }}>{title} is coming soon</Text>
        <Text style={{ color: c.muted, fontSize: 15 * scale, textAlign: "center", marginTop: 6 }}>
          We&apos;re building it with care — large text, easy controls, full accessibility support.
        </Text>
        <View style={{ height: 16 }} />
        <Button label="Back to Games Hub" onPress={() => router.replace("/games")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
