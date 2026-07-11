/**
 * Admin → Invite Flyer
 *
 * Renders a preview of the printable A4 flyer (generated server-side as a
 * single PNG by GET /api/admin/invite-flyer) and offers a one-tap download.
 * Designed to be pinned up at community centres, libraries and local clubs,
 * libraries and clubs.
 */
import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image,
  Linking, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

const SHARE_BASE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).EXPO_PUBLIC_SHARE_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  "https://friendplace.com.au";

export default function InviteFlyer() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);

  // Cache-busting key so when the user changes venue, the preview refreshes.
  const [revision, setRevision] = useState(0);

  // We always include the admin's own id as `?ref=` so flyer-driven signups
  // are credited to whichever admin printed the poster. Falls back to the
  // bare URL for not-logged-in flows (shouldn't happen on this page).
  const sharedUrl = useMemo(
    () => (user?.id ? `${SHARE_BASE_URL}?ref=${encodeURIComponent(user.id)}` : SHARE_BASE_URL),
    [user?.id],
  );

  const previewUrl = useMemo(() => {
    if (!user?.id) return "";
    return `${api.inviteFlyerUrl(user.id, venue.trim(), sharedUrl)}&_r=${revision}`;
  }, [user?.id, venue, sharedUrl, revision]);

  const download = async () => {
    if (!previewUrl) return;
    setBusy(true);
    try {
      if (Platform.OS === "web") {
        // Force a download attribute via an anchor click so the browser saves
        // it to disk instead of just opening it in a new tab.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc: any = (globalThis as any).document;
        if (doc) {
          const a = doc.createElement("a");
          a.href = previewUrl;
          a.download = venue.trim() ? `friendplace-flyer-${venue.trim().replace(/\s+/g, "-")}.png` : "friendplace-flyer.png";
          doc.body.appendChild(a);
          a.click();
          doc.body.removeChild(a);
          show("Flyer downloaded — happy printing!");
        }
      } else {
        await Linking.openURL(previewUrl);
        show("Flyer opened — long-press to save");
      }
    } catch {
      show("Could not download flyer");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = () => setRevision((r) => r + 1);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Invite Flyer" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 14 }}>
        <View style={[styles.card, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="print" size={24} color={c.brand} />
            <Text style={{ color: c.brand, fontWeight: "900", fontSize: 17 * scale }}>Printable QR poster</Text>
          </View>
          <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 6, lineHeight: 20 }}>
            Generate an A4 portrait poster with a large QR code that takes scanners straight to FriendPlace.
            Pin it up at community centres, libraries, cafés, clubs and anywhere people gather.
            New signups through your poster will be credited to your admin account.
          </Text>
        </View>

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale }]}>Venue or host name (optional)</Text>
        <TextInput
          testID="flyer-venue"
          value={venue}
          onChangeText={setVenue}
          placeholder="e.g. Sydney Library, Ashfield Bowling Club"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale }]}
          onSubmitEditing={regenerate}
          returnKeyType="done"
          maxLength={80}
        />
        <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: -8 }}>
          Printed along the bottom of the poster as &quot;Hosted by …&quot;.
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            testID="flyer-regenerate"
            onPress={regenerate}
            style={({ pressed }) => [styles.secondaryBtn, { borderColor: c.brand, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="refresh" size={20} color={c.brand} />
            <Text style={{ color: c.brand, fontWeight: "800", fontSize: 15 * scale }}>Refresh preview</Text>
          </Pressable>
          <Pressable
            testID="flyer-download"
            disabled={busy}
            onPress={download}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand, opacity: pressed || busy ? 0.7 : 1 }]}
          >
            {busy ? <ActivityIndicator color="#FFF" /> : <Ionicons name="download" size={20} color="#FFF" />}
            <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 15 * scale }}>Download PNG</Text>
          </Pressable>
        </View>

        <Text style={[styles.label, { color: c.onSurface, fontSize: 15 * scale, marginTop: 6 }]}>Preview</Text>
        <View style={[styles.previewWrap, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          {previewUrl ? (
            <Image
              key={previewUrl}
              source={{ uri: previewUrl }}
              style={styles.preview}
              resizeMode="contain"
            />
          ) : (
            <View style={{ alignItems: "center", padding: 40 }}><ActivityIndicator color={c.brand} /></View>
          )}
        </View>

        <Text style={{ color: c.muted, fontSize: 12 * scale, textAlign: "center" }}>
          Tip: print at 100% / actual size on plain A4 for a crisp QR code.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 14 },
  label: { fontWeight: "800", marginTop: 4 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontWeight: "600", minHeight: 48 },
  secondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 999, borderWidth: 2, minHeight: 48 },
  primaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 999, minHeight: 48 },
  previewWrap: { borderWidth: 1, borderRadius: 16, padding: 8, alignItems: "center" },
  preview: { width: "100%", aspectRatio: 1240 / 1754, maxWidth: 560 },
});
