/**
 * /founders — the Founders Wall.
 *
 * A public celebration page listing every Founding Member (capped at 500)
 * with their avatar, first name, founder number and suburb. Two jobs:
 *
 *   1. Recognition — Founders see their own crest sitting alongside the
 *      rest of the cohort, ordered by who joined first.
 *   2. Social proof — any visitor (including not-yet-signed-up invitees)
 *      can browse to see this is a small, intentional founding community.
 *
 * Data: GET /api/founders → { total, items: [{id, first_name, username,
 * avatar, founder_number, suburb, created_at}, …] }. No auth required.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";

type Founder = {
  id: string;
  first_name?: string;
  username?: string;
  avatar?: string;
  founder_number?: number | null;
  suburb?: string;
  created_at?: string;
};

export default function FoundersWall() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<Founder[]>([]);
  const [total, setTotal] = useState(0);
  const [cap, setCap] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Whether the signed-in viewer is themselves a Founding Member —
  // unlocks the "You're a Founding Member ✓" status header and the
  // shortcut buttons to the Founders Lounge.
  const viewerIsFounder = !!(user as any)?.is_founder;
  const viewerFounderNumber = (user as any)?.founder_number ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [w, s]: any[] = await Promise.all([
          api.founders({ limit: 500 }).catch(() => ({ total: 0, items: [] })),
          api.founderStatus().catch(() => null),
        ]);
        if (cancelled) return;
        setItems(Array.isArray(w?.items) ? w.items : []);
        setTotal(w?.total || 0);
        if (s) setCap(s.cap ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.surfaceBase }}>
      <Header title="Founders Wall" emoji="🦋" subtitle="The Founding Members of FriendPlace" />
      <ScrollView
        contentContainerStyle={{
          padding: 18,
          paddingTop: 12,
          paddingBottom: insets.bottom + 32,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        testID="founders-wall"
      >
        {/* "You're a Founding Member ✓" status header — only renders when
            the viewer is themselves a Founder. Gives existing members a
            warm sense of belonging the moment they land on the Wall, plus
            shortcut access to the private Lounge they unlocked. */}
        {viewerIsFounder ? (
          <View style={[styles.statusCard, { backgroundColor: "#0F766E", borderColor: "#5EEAD4" }]} testID="founders-wall-status">
            <View style={styles.statusRow}>
              <Text style={{ fontSize: 30 }}>🦋</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: "#ECFEFF", fontWeight: "900", fontSize: 16 * scale, letterSpacing: 0.4 }}>
                    YOU&apos;RE A FOUNDING MEMBER
                  </Text>
                  <Ionicons name="checkmark-circle" size={20} color="#5EEAD4" />
                </View>
                {viewerFounderNumber ? (
                  <Text style={{ color: "#A7F3D0", fontWeight: "800", fontSize: 13 * scale, marginTop: 2 }}>
                    Founding Member #{viewerFounderNumber}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.statusBtnRow}>
              <Pressable
                testID="founders-wall-go-lounge"
                onPress={() => router.push("/lounge" as any)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.statusBtn, { backgroundColor: "#ECFEFF", opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="cafe" size={18} color="#0F766E" />
                <Text style={{ color: "#0F766E", fontWeight: "900", fontSize: 14 * scale }}>Founders Lounge</Text>
              </Pressable>
              <Pressable
                testID="founders-wall-go-profile"
                onPress={() => router.push("/(tabs)/profile" as any)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.statusBtn, { backgroundColor: "rgba(236, 254, 255, 0.18)", borderWidth: 1.2, borderColor: "#A7F3D0", opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="person-circle" size={18} color="#ECFEFF" />
                <Text style={{ color: "#ECFEFF", fontWeight: "900", fontSize: 14 * scale }}>My Profile</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={[styles.heroCard, { backgroundColor: c.brandTertiary, borderColor: "#D4A017" }]}>
          <Text style={{ fontSize: 36 }}>🦋</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale }}>
              Our Founding Members
            </Text>
            <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 4, lineHeight: 20 }}>
              {cap != null
                ? `${total} of ${cap.toLocaleString()} early members shaping FriendPlace together.`
                : `${total} early members shaping FriendPlace together.`}
            </Text>
            <Text style={{ color: "#7C5300", fontWeight: "800", fontSize: 12 * scale, marginTop: 4, letterSpacing: 0.3 }}>
              JOIN FREE AS A FOUNDING MEMBER
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ paddingTop: 40, alignItems: "center" }}>
            <ActivityIndicator color={c.brand} />
            <Text style={{ color: c.muted, marginTop: 10 }}>Loading the wall…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ fontSize: 38 }}>🦋</Text>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, textAlign: "center", marginTop: 8 }}>
              The wall is empty right now
            </Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, textAlign: "center", marginTop: 6, lineHeight: 20 }}>
              Be the first — sign up to claim a Founding Member spot.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {items.map((f) => (
              <Pressable
                key={f.id}
                testID={`founder-row-${f.id}`}
                onPress={() => router.push(`/user/${f.id}` as any)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.numberPill, { borderColor: "#D4A017", backgroundColor: c.brandTertiary }]}>
                  <Text style={{ color: "#7C5300", fontWeight: "900", fontSize: 13 * scale }}>
                    #{f.founder_number ?? "?"}
                  </Text>
                </View>
                <View style={[styles.avatarWrap, { backgroundColor: c.brandTertiary }]}>
                  <AvatarBubble value={f.avatar} size={44} textSize={28} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }} numberOfLines={1}>
                      {f.first_name || f.username || "Founding Member"}
                    </Text>
                    <FounderMark
                      isFounder
                      founderNumber={f.founder_number}
                      size={13}
                      testID={`wall-founder-mark-${f.id}`}
                    />
                  </View>
                  <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 2 }} numberOfLines={1}>
                    {f.suburb ? `📍 ${f.suburb}` : `@${f.username || ""}`}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusBtnRow: { flexDirection: "row", gap: 10 },
  statusBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
  },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  emptyCard: { alignItems: "center", padding: 28, borderRadius: 18, borderWidth: 1, marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  numberPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1.5,
    minWidth: 48,
    alignItems: "center",
  },
  avatarWrap: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
