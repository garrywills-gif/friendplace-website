/**
 * Settings — accessibility prefs, community guidelines, legal pages,
 * sign out, and the (Apple/Google-mandated) in-app account deletion flow.
 *
 * The Delete Account flow is intentionally a two-step confirmation:
 *   1. User taps "Delete my account" → red modal explains exactly what
 *      will be removed (messages, posts, photos, friends) and asks them
 *      to type DELETE to confirm.
 *   2. On confirmation, we call `api.deleteAccount(token)` (DELETE
 *      /api/users/me). On 200, we clear the local session and route to
 *      the welcome screen.
 *
 * This satisfies App Store Review Guideline 5.1.1(v) and Google Play's
 * 2024+ "in-app account deletion" requirement.
 */
import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Switch, Pressable, Modal, TextInput, Alert,
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

  // Two-step delete state. `step` walks through: idle → confirm → typing → done.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText.trim().toUpperCase() === "DELETE" && !deleting;

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
      <Header title="Settings" />
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
          You can report or block any user from their profile page. Reports go to our moderator dashboard so we can keep YouBelong a warm and welcoming space for everyone. 🦋
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
            red label + a two-step typed confirmation modal. ─────────── */}
        {user ? (
          <>
            <Text style={[styles.section, { color: c.onSurface, fontSize: 20 * scale, marginTop: 8 }]}>Account</Text>
            <Pressable
              testID="settings-delete-account"
              onPress={() => { setConfirmText(""); setDeleteOpen(true); }}
              style={[styles.dangerRow, { borderColor: "#DC2626" }]}
              accessibilityRole="button"
              accessibilityLabel="Delete my account permanently"
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#DC2626", fontWeight: "900", fontSize: 17 * scale }}>Delete my account</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                  Permanently removes your profile, messages, posts and friend connections.
                </Text>
              </View>
              <Text style={{ color: "#DC2626", fontSize: 18 * scale, fontWeight: "900" }}>›</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {/* Two-step Delete Account confirmation modal. Type DELETE to enable
          the red button. This is the friction Apple/Google want for an
          irreversible action — no accidental taps. */}
      <Modal visible={deleteOpen} animationType="fade" transparent onRequestClose={() => !deleting && setDeleteOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => !deleting && setDeleteOpen(false)}>
          <Pressable
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
            style={[styles.sheet, { backgroundColor: c.surface }]}
          >
            <Text style={{ fontSize: 44 }}>⚠️</Text>
            <Text style={[styles.modalTitle, { color: c.onSurface, fontSize: 22 * scale }]}>Delete your account?</Text>
            <Text style={[styles.modalBody, { color: c.onSurface, fontSize: 16 * scale }]}>
              This is permanent. We&apos;ll remove your profile, all your messages and posts, your event RSVPs, your photos, and your friend connections.
              {"\n\n"}
              Group posts will stay so threads remain readable for other members, but they&apos;ll show <Text style={{ fontWeight: "800" }}>&ldquo;Former member&rdquo;</Text> instead of your name.
              {"\n\n"}
              Type <Text style={{ fontWeight: "900", color: "#DC2626" }}>DELETE</Text> below to confirm.
            </Text>
            <TextInput
              testID="delete-confirm-input"
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Type DELETE"
              placeholderTextColor={c.muted}
              editable={!deleting}
              style={[
                styles.input,
                { color: c.onSurface, borderColor: c.border, backgroundColor: c.surfaceSecondary, fontSize: 17 * scale },
              ]}
            />
            <Pressable
              testID="delete-confirm-btn"
              disabled={!canDelete}
              onPress={doDelete}
              style={[
                styles.dangerBtn,
                { backgroundColor: canDelete ? "#DC2626" : "#FCA5A5" },
              ]}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 17 * scale }}>
                {deleting ? "Deleting…" : "Delete my account permanently"}
              </Text>
            </Pressable>
            <Pressable
              testID="delete-cancel-btn"
              disabled={deleting}
              onPress={() => setDeleteOpen(false)}
              style={[styles.cancelBtn, { backgroundColor: c.surfaceSecondary }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 16 * scale }}>Cancel</Text>
            </Pressable>
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
  input: {
    alignSelf: "stretch", paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1.5, fontWeight: "800", letterSpacing: 1.5, textAlign: "center",
  },
  dangerBtn: {
    alignSelf: "stretch", alignItems: "center", paddingVertical: 16,
    borderRadius: 999, minHeight: 52, marginTop: 4,
  },
  cancelBtn: {
    alignSelf: "stretch", alignItems: "center", paddingVertical: 14,
    borderRadius: 999, minHeight: 48,
  },
});
