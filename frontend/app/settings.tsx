/**
 * Settings — accessibility prefs, community guidelines, legal pages,
 * sign out, and the (Apple/Google-mandated) in-app account deletion flow.
 *
 * Delete Account flow (intentionally short — Apple/Google only require
 * an in-app deletion path with explicit user confirmation, not typed
 * friction):
 *   1. User taps "Delete Account" → red confirmation modal:
 *        "Are you sure? This action cannot be undone."
 *   2. Side-by-side [Cancel] [Delete Account] buttons.
 *   3. On confirm, we call `api.deleteAccount(token)` (DELETE
 *      /api/users/me). On 200, we clear the local session and route to
 *      the welcome screen.
 *
 * This satisfies App Store Review Guideline 5.1.1(v) and Google Play's
 * 2024+ "in-app account deletion" requirement.
 */
import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Switch, Pressable, Modal, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
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
  const { user, token, logout } = useAuth();
  const router = useRouter();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!token) {
      Alert.alert("Please sign in again", "Your session has expired.");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteAccount(token);
      // Clear local session and bounce to the welcome screen. We don't
      // show a success toast — the user signed away from the app, so we
      // respect that and just let them go.
      await logout();
      setDeleteOpen(false);
      router.replace("/");
    } catch (e: any) {
      // Admins can't self-delete via this endpoint — surface that.
      const msg = (e?.message || "").includes("400")
        ? "Admin accounts can't be deleted from here. Please contact support."
        : "Sorry, we couldn't delete your account just now. Please try again.";
      Alert.alert("Couldn't delete account", msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Settings" emoji="⚙️" subtitle="Preferences · Account · Accessibility" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
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
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Use your device&apos;s built-in microphone button on the keyboard to dictate messages anywhere in the app.</Text>
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
          You can report or block any user from their profile page. Reports go to our moderator dashboard so we can keep FriendPlace a warm and welcoming space for everyone. 🦋
        </Text>

        <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}>Legal</Text>
        <Pressable
          testID="settings-privacy"
          onPress={() => router.push("/legal/privacy")}
          style={[styles.linkRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
        >
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 17 * scale }}>Privacy Policy</Text>
          <Text style={{ color: c.muted, fontSize: 18 * scale }}>›</Text>
        </Pressable>
        <Pressable
          testID="settings-terms"
          onPress={() => router.push("/legal/terms")}
          style={[styles.linkRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
        >
          <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 17 * scale }}>Terms of Use</Text>
          <Text style={{ color: c.muted, fontSize: 18 * scale }}>›</Text>
        </Pressable>

        {/* ─── Account deletion — store-mandated, kept separate from the
            normal Sign Out so it can't be tapped by accident. Red border +
            red label + a single-step confirm modal. ────────────────── */}
        {user ? (
          <>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale, marginTop: 8 }]}>Account</Text>
            <Pressable
              testID="settings-delete-account"
              onPress={() => setDeleteOpen(true)}
              style={[styles.dangerRow, { borderColor: "#DC2626" }]}
              accessibilityRole="button"
              accessibilityLabel="Delete Account"
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#DC2626", fontWeight: "900", fontSize: 17 * scale }}>Delete Account</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                  Permanently removes your profile, messages, posts and friend connections.
                </Text>
              </View>
              <Text style={{ color: "#DC2626", fontSize: 18 * scale, fontWeight: "900" }}>›</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {/* Single-step Delete Account confirmation modal — Cancel | Delete Account.
          Short, clear, and matches Apple/Google's "explicit confirmation"
          guidance without typed-friction overkill. */}
      <Modal visible={deleteOpen} animationType="fade" transparent onRequestClose={() => !deleting && setDeleteOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !deleting && setDeleteOpen(false)}>
          <Pressable
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[styles.sheet, { backgroundColor: c.surface }]}
          >
            <Text style={{ fontSize: 44 }}>⚠️</Text>
            <Text style={[styles.modalTitle, { color: c.onSurface, fontSize: 22 * scale }]}>Are you sure?</Text>
            <Text style={[styles.modalBody, { color: c.onSurface, fontSize: 16 * scale, textAlign: "center" }]}>
              This action cannot be undone. We&apos;ll permanently remove your profile, messages, posts and friend connections.
            </Text>
            <View style={styles.btnRow}>
              <Pressable
                testID="delete-cancel-btn"
                disabled={deleting}
                onPress={() => setDeleteOpen(false)}
                style={[styles.cancelBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="delete-confirm-btn"
                disabled={deleting}
                onPress={doDelete}
                style={[styles.dangerBtn, { backgroundColor: deleting ? "#FCA5A5" : "#DC2626" }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 * scale }}>
                  {deleting ? "Deleting…" : "Delete Account"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontWeight: "800", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  cardBig: { padding: 16, borderRadius: 16 },
  linkRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderRadius: 16, borderWidth: 1, minHeight: 56,
  },
  dangerRow: {
    flexDirection: "row", alignItems: "center", padding: 16,
    borderRadius: 16, borderWidth: 2, gap: 12, marginTop: 4,
  },
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  sheet: {
    width: "100%", maxWidth: 460, borderRadius: 24, padding: 24,
    alignItems: "center", gap: 12,
  },
  modalTitle: { fontWeight: "900", textAlign: "center" },
  modalBody: { textAlign: "left", lineHeight: 22 },
  btnRow: {
    flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 6,
  },
  dangerBtn: {
    flex: 1, alignItems: "center", paddingVertical: 14,
    borderRadius: 999, minHeight: 48,
  },
  cancelBtn: {
    flex: 1, alignItems: "center", paddingVertical: 14,
    borderRadius: 999, minHeight: 48, borderWidth: 1,
  },
});
