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
import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Switch, Pressable, Modal, Alert, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { useGeorgeVoice, setVoice, VOICE_LABELS, type GeorgeVoice } from "@/src/lib/george-voice";
import { georgeApi } from "@/src/lib/george-api";
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
        {/* Text zoom — 4-step slider that scales every font in the app.
            Replaces the coarse "Large text" toggle for users who want a
            gentler bump or an even bigger boost. Live preview: tapping
            each option immediately re-renders every screen at the new
            scale. */}
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border, flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
          <View>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Text size</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Adjust how large text appears across the whole app</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {([
              { key: "sm", label: "Small",   fs: 12 },
              { key: "md", label: "Default", fs: 14 },
              { key: "lg", label: "Large",   fs: 16 },
              { key: "xl", label: "Extra",   fs: 18 },
            ] as const).map((opt) => {
              const active = (prefs.textZoom || (prefs.largeText ? "lg" : "md")) === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  testID={`text-zoom-${opt.key}`}
                  accessibilityLabel={`Text size ${opt.label}`}
                  onPress={() => { setPref("textZoom", opt.key); if (prefs.largeText && opt.key !== "lg") setPref("largeText", false); }}
                  style={[
                    styles.zoomPill,
                    {
                      backgroundColor: active ? c.brand : c.surface,
                      borderColor: active ? c.brand : c.border,
                    },
                  ]}
                >
                  <Text style={{ color: active ? c.onBrandPrimary : c.onSurface, fontWeight: "900", fontSize: opt.fs }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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

        <GeorgeVoiceCard />

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

// ---------------------------------------------------------------------------
// George's voice — Voice Phase 3 picker
// ---------------------------------------------------------------------------

const PREVIEW_LINES: Record<GeorgeVoice, string> = {
  george:  "G\u2019day, I\u2019m George. I\u2019ll be your community companion here at FriendPlace.",
  georgia: "Hi there, I\u2019m Georgia. I\u2019ll be your community companion here at FriendPlace.",
};

function GeorgeVoiceCard() {
  const { c, scale } = useTheme();
  const { show } = useToast();
  const { voice } = useGeorgeVoice();
  const player = useAudioPlayer(null);
  const [previewing, setPreviewing] = useState<GeorgeVoice | null>(null);

  useEffect(() => () => {
    try { player.pause(); } catch { /* noop */ }
  }, [player]);

  useEffect(() => {
    if (previewing && !player.playing) setPreviewing(null);
  }, [player.playing, previewing]);

  const preview = async (which: GeorgeVoice) => {
    if (previewing === which) {
      try { player.pause(); } catch { /* noop */ }
      setPreviewing(null);
      return;
    }
    setPreviewing(which);
    try {
      try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch { /* web no-op */ }
      const uri = await georgeApi.speak(PREVIEW_LINES[which], which);
      player.replace({ uri });
      try { player.seekTo(0); } catch { /* first-play */ }
      player.play();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn\u2019t play the preview. Please try again.";
      show(msg);
      setPreviewing(null);
    }
  };

  const pick = async (which: GeorgeVoice) => {
    if (which === voice) return;
    await setVoice(which);
    show(`George\u2019s voice set to ${VOICE_LABELS[which].short}.`);
    preview(which);
  };

  return (
    <View style={[voiceStyles.card, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
      <View style={voiceStyles.head}>
        <Ionicons name="chatbubbles" size={20} color={c.brand} />
        <Text style={[voiceStyles.title, { color: c.brand, fontSize: 15 * scale }]}>GEORGE&#39;S VOICE</Text>
      </View>
      <Text style={[voiceStyles.subtitle, { color: c.onBrandTertiary, fontSize: 14 * scale }]}>
        Choose the voice George uses when reading his replies aloud in FriendPlace.
      </Text>

      <View style={voiceStyles.options}>
        {(Object.keys(VOICE_LABELS) as GeorgeVoice[]).map((key) => {
          const info = VOICE_LABELS[key];
          const selected = voice === key;
          return (
            <Pressable
              key={key}
              testID={`voice-option-${key}`}
              onPress={() => pick(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Use ${info.short}, ${info.description}`}
              style={[
                voiceStyles.option,
                {
                  backgroundColor: selected ? c.brand : c.surface,
                  borderColor: selected ? c.brand : c.border,
                },
              ]}
            >
              <View style={voiceStyles.optionHead}>
                <Text style={{ fontSize: 18 }}>{info.flag}</Text>
                <Text style={[voiceStyles.optionLabel, {
                  color: selected ? "#FFFFFF" : c.onSurface,
                  fontSize: 15 * scale,
                }]}>{info.short}</Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={18} color={"#FFFFFF"} style={{ marginLeft: "auto" }} />
                )}
              </View>
              <Text style={[voiceStyles.optionDesc, {
                color: selected ? "rgba(255,255,255,0.9)" : c.muted,
                fontSize: 12 * scale,
              }]}>{info.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        testID="voice-preview-current"
        onPress={() => preview(voice)}
        style={[voiceStyles.previewBtn, { backgroundColor: c.brand }]}
        accessibilityRole="button"
        accessibilityLabel={previewing === voice ? "Stop preview" : `Preview ${VOICE_LABELS[voice].short}`}
      >
        {previewing === voice ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Ionicons name={"play"} size={16} color={"#FFFFFF"} />
        )}
        <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 * scale }}>
          {previewing === voice ? "Stop preview" : `Preview ${VOICE_LABELS[voice].short}`}
        </Text>
      </Pressable>
    </View>
  );
}

const voiceStyles = StyleSheet.create({
  card: { marginTop: 14, borderRadius: 18, padding: 14, borderWidth: 1.5 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontWeight: "900", letterSpacing: 0.6 },
  subtitle: { fontWeight: "500", marginTop: 6, lineHeight: 20 },
  options: { flexDirection: "row", gap: 10, marginTop: 12 },
  option: { flex: 1, borderRadius: 16, borderWidth: 2, padding: 12 },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionLabel: { fontWeight: "900" },
  optionDesc: { marginTop: 4, lineHeight: 18, fontWeight: "500" },
  previewBtn: {
    marginTop: 12, flexDirection: "row", alignItems: "center",
    alignSelf: "flex-start", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
  },
});

const styles = StyleSheet.create({
  section: { fontWeight: "800", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  zoomPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
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
