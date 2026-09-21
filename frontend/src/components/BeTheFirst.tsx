import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

export type FirstIdea = { label: string; emoji?: string; onPress: () => void };

/**
 * BeTheFirst — a warm empty-state (iter191 Wave 2). Instead of a blank area,
 * it invites the member to start something with a few tappable ideas that jump
 * straight into the relevant create flow (pre-filled where it makes sense).
 */
export default function BeTheFirst({
  icon = "sparkles-outline",
  title,
  subtitle,
  ideas,
}: {
  icon?: any;
  title: string;
  subtitle?: string;
  ideas: FirstIdea[];
}) {
  const { c, scale } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: c.brandTertiary }]}>
        <Ionicons name={icon} size={28} color={c.brand} />
      </View>
      <Text style={[styles.title, { color: c.onSurface, fontSize: 18 * scale }]}>{title}</Text>
      {!!subtitle && <Text style={[styles.sub, { color: c.muted, fontSize: 14 * scale }]}>{subtitle}</Text>}
      <View style={styles.chips}>
        {ideas.map((idea) => (
          <Pressable
            key={idea.label}
            testID={`first-idea-${idea.label}`}
            onPress={idea.onPress}
            style={({ pressed }) => [styles.chip, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            {!!idea.emoji && <Text style={{ fontSize: 15 * scale }}>{idea.emoji}</Text>}
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13.5 * scale }}>{idea.label}</Text>
            <Ionicons name="add" size={16} color={c.brand} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 48, paddingHorizontal: 20, alignItems: "center" },
  badge: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { fontWeight: "900", textAlign: "center" },
  sub: { textAlign: "center", marginTop: 6, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 18 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
});
