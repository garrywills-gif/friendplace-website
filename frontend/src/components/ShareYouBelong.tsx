/**
 * Share YouBelong — invite friends & family via SMS, Email, Copy Link, or QR.
 *
 * Single reusable component used on Home and Profile. Renders an outlined
 * button that opens a bottom-sheet modal with the four share options.
 *
 * URL: pulled from EXPO_PUBLIC_SHARE_URL when set (so QA + production can
 * point at the real domain), falling back to EXPO_PUBLIC_BACKEND_URL (the
 * current preview URL). To change the production link, set
 * EXPO_PUBLIC_SHARE_URL in /app/frontend/.env and rebuild.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  Linking,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { useTheme } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import { useAuth } from "@/src/lib/auth";

const BASE_SHARE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).EXPO_PUBLIC_SHARE_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  "https://youbelong.app";

export const SHARE_URL = BASE_SHARE_URL;

export const SHARE_MESSAGE =
  "Join me on YouBelong – a friendly community where you can meet people, " +
  "join local events, chat in the Coffee Lounge, share interests and make new friends.";

export const SHARE_SUBJECT = "Join me on YouBelong";

const fullBody = `${SHARE_MESSAGE}\n\n${SHARE_URL}`;

type Variant = "primary" | "ghost" | "tile";

export default function ShareYouBelong({
  variant = "primary",
  testID = "share-youbelong",
}: {
  variant?: Variant;
  testID?: string;
}) {
  const { c, scale } = useTheme();
  const { show } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Personalised share URL — every share gets `?ref=<user_id>` appended so
  // we can credit this user when a new signup comes through their invite.
  const sharedUrl = useMemo(
    () => (user?.id ? `${BASE_SHARE_URL}?ref=${encodeURIComponent(user.id)}` : BASE_SHARE_URL),
    [user?.id],
  );
  const fullBody = `${SHARE_MESSAGE}\n\n${sharedUrl}`;

  // Encode helpers — kept as memos so re-encoding doesn't happen on every render.
  const encoded = useMemo(() => {
    const body = encodeURIComponent(fullBody);
    const subject = encodeURIComponent(SHARE_SUBJECT);
    return { body, subject };
  }, [fullBody]);

  const openSms = async () => {
    // iOS uses `&`, Android uses `?` for the body parameter. Linking handles
    // both, but we follow the platform-specific separator for reliability.
    const sep = Platform.OS === "ios" ? "&" : "?";
    const url = `sms:${sep}body=${encoded.body}`;
    try {
      // Web: SMS scheme doesn't work — fall back to copy.
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(fullBody);
        show("Message copied — paste into your text app");
        setOpen(false);
        return;
      }
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        await Clipboard.setStringAsync(fullBody);
        show("SMS not available — message copied instead");
      } else {
        await Linking.openURL(url);
      }
      setOpen(false);
    } catch {
      show("Could not open SMS app");
    }
  };

  const openEmail = async () => {
    const url = `mailto:?subject=${encoded.subject}&body=${encoded.body}`;
    try {
      if (Platform.OS === "web") {
        // Most desktop browsers handle mailto: by opening the default mail
        // client. If nothing's registered the click is a no-op, so we ALSO
        // copy the message as a safety net.
        await Clipboard.setStringAsync(fullBody);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).location.href = url;
        show("Opening email — message also copied");
        setOpen(false);
        return;
      }
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        await Clipboard.setStringAsync(fullBody);
        show("Email not available — message copied instead");
      } else {
        await Linking.openURL(url);
      }
      setOpen(false);
    } catch {
      show("Could not open Email app");
    }
  };

  const copyLink = async () => {
    try {
      await Clipboard.setStringAsync(fullBody);
      show("Link copied successfully");
      setOpen(false);
    } catch {
      show("Could not copy");
    }
  };

  // ── Button variants ────────────────────────────────────────────────────
  const TriggerButton = () => {
    if (variant === "tile") {
      return (
        <Pressable
          testID={testID}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.tile, { backgroundColor: "#7C3AED", opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="share-social" size={28} color="#FFFFFF" />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[styles.tileTitle, { fontSize: 18 * scale }]}>Share YouBelong</Text>
            <Text style={[styles.tileSub, { fontSize: 13 * scale }]}>Invite friends & family</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.85)" />
        </Pressable>
      );
    }
    if (variant === "ghost") {
      return (
        <Pressable
          testID={testID}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.ghostBtn, { borderColor: c.brand, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="share-social" size={20} color={c.brand} />
          <Text style={{ color: c.brand, fontWeight: "800", fontSize: 16 * scale }}>Share YouBelong</Text>
        </Pressable>
      );
    }
    return (
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.brand, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="share-social" size={22} color="#FFFFFF" />
        <Text style={[styles.primaryTxt, { fontSize: 17 * scale }]}>Share YouBelong</Text>
      </Pressable>
    );
  };

  return (
    <>
      <TriggerButton />

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => { setShowQR(false); setOpen(false); }}>
        <Pressable style={styles.backdrop} onPress={() => { setShowQR(false); setOpen(false); }}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.surface }]}
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.headRow}>
              <Text style={[styles.title, { color: c.onSurface, fontSize: 22 * scale }]}>
                {showQR ? "Scan to join" : "Invite Friends to YouBelong"}
              </Text>
              <Pressable
                testID="share-close"
                onPress={() => { setShowQR(false); setOpen(false); }}
                hitSlop={12}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={26} color={c.muted} />
              </Pressable>
            </View>

            {showQR ? (
              <ScrollView contentContainerStyle={styles.qrWrap}>
                <View style={[styles.qrCard, { backgroundColor: "#FFFFFF" }]}>
                  <QRCode value={sharedUrl} size={240} backgroundColor="#FFFFFF" color="#0F172A" />
                </View>
                <Text style={[styles.qrCaption, { color: c.onSurface, fontSize: 16 * scale }]}>
                  Point a phone camera at this code to open YouBelong.
                </Text>
                <Text selectable style={[styles.qrUrl, { color: c.muted, fontSize: 13 * scale }]} numberOfLines={2}>
                  {sharedUrl}
                </Text>
                <Pressable
                  testID="share-qr-back"
                  onPress={() => setShowQR(false)}
                  style={[styles.qrBack, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                >
                  <Ionicons name="chevron-back" size={18} color={c.onSurface} />
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>Back to options</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <View style={{ gap: 10, paddingBottom: 8 }}>
                <Text style={[styles.preview, { color: c.muted, fontSize: 14 * scale, borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
                  {SHARE_MESSAGE}
                </Text>
                <ShareOption
                  testID="share-qr"
                  icon="qr-code"
                  tint="#B45309"
                  label="Show QR Code"
                  sub="Let someone scan it with their phone camera"
                  onPress={() => setShowQR(true)}
                />
                <ShareOption
                  testID="share-sms"
                  icon="chatbubble-ellipses"
                  tint="#0F766E"
                  label="Share via SMS"
                  sub="Open your messages app with the invite ready to send"
                  onPress={openSms}
                />
                <ShareOption
                  testID="share-email"
                  icon="mail"
                  tint="#0369A1"
                  label="Share via Email"
                  sub="Open your email app with subject and message pre-filled"
                  onPress={openEmail}
                />
                <ShareOption
                  testID="share-copy"
                  icon="copy"
                  tint="#7C3AED"
                  label="Copy Link"
                  sub="Copy the invite to paste into any app"
                  onPress={copyLink}
                />
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ShareOption({
  icon,
  tint,
  label,
  sub,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  sub: string;
  onPress: () => void;
  testID: string;
}) {
  const { c, scale } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={24} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: c.onSurface, fontSize: 17 * scale }]}>{label}</Text>
        <Text style={[styles.rowSub, { color: c.muted, fontSize: 13 * scale }]}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 999,
    minHeight: 48,
  },
  primaryTxt: { color: "#FFFFFF", fontWeight: "800" },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 2,
    minHeight: 48,
  },
  tile: {
    width: "100%",
    minHeight: 72,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  tileTitle: { color: "#FFFFFF", fontWeight: "900" },
  tileSub: { color: "rgba(255,255,255,0.85)", fontWeight: "600", marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28 },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: "#CBD5E1", marginVertical: 8 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontWeight: "900" },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  preview: { padding: 12, borderRadius: 12, borderWidth: 1, lineHeight: 20, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1, gap: 12, minHeight: 64 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontWeight: "800" },
  rowSub: { marginTop: 2, fontWeight: "500" },
  qrWrap: { alignItems: "center", gap: 14, paddingVertical: 8 },
  qrCard: { padding: 18, borderRadius: 18, shadowColor: "#0F172A", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  qrCaption: { fontWeight: "700", textAlign: "center", paddingHorizontal: 20 },
  qrUrl: { fontWeight: "500", textAlign: "center", paddingHorizontal: 20 },
  qrBack: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, borderWidth: 1, marginTop: 8 },
});

