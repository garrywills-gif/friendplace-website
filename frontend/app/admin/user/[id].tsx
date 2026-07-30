/**
 * RETIRED — moved to Mission Control (30 July 2026).
 *
 * All member management now lives in the desktop MCGS at
 *   /admin/members             (browse)
 *   /admin/members/{id}         (profile · moderation timeline · actions)
 *
 * The desktop surface enforces the identity-confirmation safeguard on
 * every consequential action (warn/suspend/ban/delete) and dual-writes
 * to both moderation_log and admin_log. This mobile screen intentionally
 * cannot perform those actions any more.
 *
 * If a member arrives here from an old push notification link, we show
 * a clear "This has moved" screen with a link back to the mobile admin
 * home. Admins on desktop should sign into MCGS at
 *   https://<host>/admin/members
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

export default function RetiredAdminUserScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const memberId = String(params.id || "");

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Moved to Mission Control" />
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
          <View style={[styles.iconBubble, { backgroundColor: theme.accent + "22" }]}>
            <Ionicons name="rocket-outline" size={32} color={theme.accent} />
          </View>

          <Text style={[styles.h1, { color: theme.text }]}>Member management has moved.</Text>

          <Text style={[styles.para, { color: theme.textDim }]}>
            The mobile admin tools have been retired. Member profiles,
            moderation history, warnings, suspensions and bans now live
            in <Text style={{ fontWeight: "700" }}>Mission Control</Text>{" "}
            on desktop — where the identity-confirmation safeguard runs
            before every consequential action.
          </Text>

          {memberId ? (
            <View style={[styles.idBox, { borderColor: theme.line, backgroundColor: theme.bg }]}>
              <Text style={[styles.idLabel, { color: theme.textDim }]}>Requested member</Text>
              <Text style={[styles.idText, { color: theme.text }]} selectable>
                {memberId}
              </Text>
              <Text style={[styles.idHint, { color: theme.textDim }]}>
                Open Mission Control at{" "}
                <Text style={{ fontWeight: "700" }}>
                  /admin/members/{memberId.slice(0, 8)}…
                </Text>{" "}
                to review this profile.
              </Text>
            </View>
          ) : null}

          <View style={[styles.whyBox, { borderColor: theme.line }]}>
            <Text style={[styles.whyLabel, { color: theme.textDim }]}>Why the change?</Text>
            <Text style={[styles.para, { color: theme.textDim, marginTop: 4 }]}>
              Desktop gives moderators the space to see a member&apos;s full
              history at a glance, run fairness checks with George, and
              step through identity confirmation without the risk of
              acting on the wrong account.
            </Text>
          </View>

          <Pressable
            onPress={() => router.replace("/admin")}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: theme.accent, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnText}>← Back to admin home</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 },
  iconBubble: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  h1: { fontSize: 22, fontWeight: "800", lineHeight: 28 },
  para: { fontSize: 15, lineHeight: 22 },
  idBox: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  idLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  idText: { fontSize: 13, fontFamily: "Menlo", fontWeight: "600" },
  idHint: { fontSize: 12, marginTop: 4 },
  whyBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  whyLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  primaryBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
