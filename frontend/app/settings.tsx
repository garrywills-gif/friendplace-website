import React from "react";
import { View, Text, StyleSheet, ScrollView, Switch } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const GUIDELINES = [
  "Be kind. Treat others as you'd like to be treated.",
  "No harassment, discrimination, or hate speech.",
  "Respect privacy — don't share personal information.",
  "Report anything that makes you uncomfortable.",
  "This is a friendship community — NOT a dating app.",
];

export default function Settings() {
  const { c, scale, prefs, setPref } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>Accessibility</Text>
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Large text</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Increase font size across the app</Text>
          </View>
          <Switch testID="toggle-large-text" value={prefs.largeText} onValueChange={(v) => setPref("largeText", v)} trackColor={{ true: c.brand, false: c.border }} />
        </View>
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>High contrast</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Stronger colour contrast for easier reading</Text>
          </View>
          <Switch testID="toggle-high-contrast" value={prefs.highContrast} onValueChange={(v) => setPref("highContrast", v)} trackColor={{ true: c.brand, false: c.border }} />
        </View>
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Voice-to-text</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Use your device's built-in microphone button on the keyboard to dictate messages anywhere in the app.</Text>
          </View>
        </View>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>Community Guidelines</Text>
        <View style={[styles.cardBig, { backgroundColor: c.brandTertiary }]}>
          {GUIDELINES.map((g, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale }}>•</Text>
              <Text style={{ color: c.onBrandTertiary, flex: 1, fontSize: 16 * scale, lineHeight: 22 }}>{g}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>Safety</Text>
        <Text style={{ color: c.muted, fontSize: 15 * scale, lineHeight: 22 }}>
          You can report or block any user from their profile page. Reports go to our moderator dashboard so we can keep YouBelong a warm and welcoming space for everyone. 🦋
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontWeight: "800", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  cardBig: { padding: 16, borderRadius: 16 },
});
