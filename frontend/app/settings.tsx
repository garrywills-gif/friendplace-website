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
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Switch, Pressable, Modal, Alert, ActivityIndicator, FlatList,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { playAudioUri, type PlaybackController } from "@/src/lib/george-playback";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { useGeorgeVoice, setVoice, VOICE_LABELS, type GeorgeVoice } from "@/src/lib/george-voice";
import { georgeApi } from "@/src/lib/george-api";
import { loadFavourites, toggleFavourite } from "@/src/lib/thoughts";
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
  const { show } = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ anchor?: string }>();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Favourite thoughts — surfaces items members have hearted from
  // "Today's Thought". Kept from the old standalone Accessibility page
  // because it's the only place these saves are viewable.
  const [favsOpen, setFavsOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => { (async () => setFavs(await loadFavourites()))(); }, [favsOpen]);

  // Deep-link anchor. `router.push('/settings?anchor=accessibility')`
  // (or any other section key) will scroll to the named section on
  // mount. We remember each section's Y in refs via `onLayout`.
  const scrollRef = useRef<ScrollView>(null);
  const anchorYs = useRef<Record<string, number>>({});
  const registerAnchor = useCallback((key: string) => (y: number) => {
    anchorYs.current[key] = y;
  }, []);
  useEffect(() => {
    const target = (params.anchor || '').toString();
    if (!target) return;
    // Give the layout a beat to settle so `onLayout` has fired.
    const t = setTimeout(() => {
      const y = anchorYs.current[target];
      if (y != null && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [params.anchor]);

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
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <Text
          style={[styles.section, { color: c.onSurface, fontSize: 20 * scale }]}
          onLayout={(e) => registerAnchor('accessibility')(e.nativeEvent.layout.y)}
        >Accessibility</Text>
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
        {/* Simplified mode — bumps padding and touch targets across
            the app for members who prefer less clutter and bigger tap
            areas. Backed by `theme.simplified`. */}
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Simplified mode</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Larger buttons and more breathing room. Reduces visual clutter.</Text>
          </View>
          <Switch
            testID="toggle-simplified"
            value={prefs.simplified}
            onValueChange={(v) => { setPref("simplified", v); show(`Simplified mode ${v ? "on" : "off"}`); }}
            trackColor={{ true: c.brand, false: c.border }}
          />
        </View>

        {/* Reading aloud — show a speaker icon beside messages, posts
            and Today's Thought so members can tap to hear them. Uses
            the device's built-in TTS via `expo-speech`. */}
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Read messages aloud</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Show a speaker icon beside messages, posts and Today&apos;s Thought so you can tap to hear them.</Text>
          </View>
          <Switch
            testID="toggle-read-aloud"
            value={prefs.readMessagesAloud}
            onValueChange={(v) => { setPref("readMessagesAloud", v); show(`Read aloud ${v ? "on" : "off"}`); }}
            trackColor={{ true: c.brand, false: c.border }}
          />
        </View>

        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Auto-read new messages</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Automatically speak incoming chat messages as they arrive.</Text>
          </View>
          <Switch
            testID="toggle-auto-read"
            value={prefs.autoReadNewMessages}
            onValueChange={(v) => { setPref("autoReadNewMessages", v); show(`Auto-read ${v ? "on" : "off"}`); }}
            trackColor={{ true: c.brand, false: c.border }}
          />
        </View>

        {/* Voice typing — the in-app tap-to-dictate mic (expo-audio
            capture + OpenAI whisper-1). Members can also always fall
            back to the device keyboard's built-in microphone key. */}
        <View style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 18 * scale }}>Voice typing</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>Tap the mic beside any message box to dictate. You can always use the 🎤 on your device&apos;s keyboard instead.</Text>
          </View>
          <Switch
            testID="toggle-voice-input"
            value={prefs.voiceInputEnabled}
            onValueChange={(v) => { setPref("voiceInputEnabled", v); show(`Voice typing ${v ? "on" : "off"}`); }}
            trackColor={{ true: c.brand, false: c.border }}
          />
        </View>

        <GeorgeVoiceCard />

        {/* Favourite thoughts — carried over from the old dedicated
            Accessibility screen. Only place in the app where members
            can review the "Today's Thought" cards they've hearted. */}
        <Pressable
          testID="settings-open-favs"
          onPress={() => setFavsOpen(true)}
          style={[styles.favsLink, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
        >
          <Ionicons name="heart" size={22} color={c.error} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 17 * scale }}>Favourite thoughts ({favs.length})</Text>
            <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>Tap the heart on Today&apos;s Thought to save your favourites.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.muted} />
        </Pressable>

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

      {/* Favourite Thoughts sheet — a bottom-sheet listing every
          "Today's Thought" the member has hearted. Removing a favourite
          from here is optimistic (removes from local state before the
          async persist call). */}
      <Modal visible={favsOpen} animationType="slide" transparent onRequestClose={() => setFavsOpen(false)}>
        <View style={styles.favsWrap}>
          <View style={[styles.favsSheet, { backgroundColor: c.surface }]}>
            <View style={styles.favsHead}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale }}>Favourite thoughts</Text>
              <Pressable onPress={() => setFavsOpen(false)} hitSlop={8} style={{ padding: 6 }} accessibilityLabel="Close favourites">
                <Ionicons name="close" size={26} color={c.onSurface} />
              </Pressable>
            </View>
            <FlatList
              data={favs}
              keyExtractor={(t, i) => `${i}-${t}`}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              ListEmptyComponent={() => (
                <Text style={{ color: c.muted, textAlign: "center", padding: 20, fontSize: 14 * scale, lineHeight: 20 }}>
                  You haven&apos;t saved any thoughts yet. Tap the heart on Today&apos;s Thought to add one here.
                </Text>
              )}
              renderItem={({ item }) => (
                <View style={[styles.favRow, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, flex: 1, fontSize: 15 * scale, lineHeight: 21 }}>{item}</Text>
                  <Pressable
                    onPress={async () => {
                      // Optimistic remove; the async op just persists.
                      setFavs(prev => prev.filter(t => t !== item));
                      await toggleFavourite(item);
                    }}
                    accessibilityLabel="Remove favourite"
                    hitSlop={8}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="close-circle" size={22} color={c.muted} />
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
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
  const [previewing, setPreviewing] = useState<GeorgeVoice | null>(null);
  // Holds the active playback controller so a second tap can stop it,
  // and so we can tear it down on unmount.
  const activeRef = useRef<PlaybackController | null>(null);

  useEffect(() => () => {
    try { activeRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const preview = async (which: GeorgeVoice) => {
    // Tapping the currently-playing voice stops it.
    if (previewing === which) {
      try { activeRef.current?.stop(); } catch { /* noop */ }
      activeRef.current = null;
      setPreviewing(null);
      return;
    }
    // Starting a new preview supersedes any in-flight one.
    if (activeRef.current) {
      try { activeRef.current.stop(); } catch { /* noop */ }
      activeRef.current = null;
    }
    setPreviewing(which);
    try {
      const uri = await georgeApi.speak(PREVIEW_LINES[which], which);
      const ctrl = playAudioUri(uri);
      activeRef.current = ctrl;
      ctrl.whenDone.then(() => {
        if (activeRef.current === ctrl) {
          activeRef.current = null;
          setPreviewing(null);
        }
      });
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
  favsLink: {
    flexDirection: "row", alignItems: "center",
    padding: 14, borderRadius: 16, borderWidth: 1,
  },
  favsWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  favsSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "80%" },
  favsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  favRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, gap: 6 },
});
