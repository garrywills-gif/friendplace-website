/**
 * FirstRunCard — a warm "here's what to try next" card that greets new
 * members on their Home screen the first few times they open the app.
 *
 * Why this exists:
 *   The 6-step onboarding wizard collects interests + location + groups, but
 *   when the user lands on /home for the first time the page can still feel
 *   like a wall of tiles. This card sits at the very top and gives them
 *   three concrete next actions ("join a FP Café table", "browse
 *   events", "say hi to a neighbour"). Dismissable + auto-hides after 3
 *   sessions so it never nags returning users.
 *
 * Storage:
 *   Persists a tiny JSON record under `friendplace.firstrun.<user_id>` in
 *   AsyncStorage:
 *     { dismissed: bool, opens: number, last_open_iso: string }
 *   - `dismissed=true` hides the card forever.
 *   - `opens >= MAX_SHOWS` auto-hides without explicit dismissal so the
 *     card naturally fades after the new member has settled in.
 *   - Per-user key so multiple accounts on the same device don't leak.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";

const MAX_SHOWS = 3;

type StorageRecord = {
  dismissed?: boolean;
  opens?: number;
  last_open_iso?: string;
};

function keyFor(userId: string) {
  return `friendplace.firstrun.${userId}`;
}

type Step = {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof import("@expo/vector-icons/build/Ionicons").glyphMap;
  route: string;
};

const STEPS: Step[] = [
  {
    key: "lounge",
    label: "Join a FP Café table",
    hint: "Drop into a chat — no scheduling, no pressure.",
    icon: "cafe",
    route: "/lounge",
  },
  {
    key: "events",
    label: "Browse local events",
    hint: "Walks, lunches, classes near you.",
    icon: "calendar",
    route: "/events",
  },
  {
    key: "friends",
    label: "Find friendly faces nearby",
    hint: "Say hi to a neighbour in your suburb.",
    icon: "people",
    route: "/friends",
  },
];

type Props = {
  userId: string;
  firstName?: string;
  testID?: string;
};

export default function FirstRunCard({ userId, firstName, testID = "first-run-card" }: Props) {
  const router = useRouter();
  const { c, scale } = useTheme();

  // visibility state: undefined while we're still reading storage so we
  // never flash the card and then yank it.
  const [show, setShow] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        if (!cancelled) setShow(false);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(keyFor(userId));
        const rec: StorageRecord = raw ? JSON.parse(raw) : {};
        if (rec.dismissed) {
          if (!cancelled) setShow(false);
          return;
        }
        const opens = (rec.opens || 0) + 1;
        const next: StorageRecord = {
          ...rec,
          opens,
          last_open_iso: new Date().toISOString(),
        };
        await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
        if (!cancelled) setShow(opens <= MAX_SHOWS);
      } catch {
        // Storage failure (rare) — just don't show the card.
        if (!cancelled) setShow(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function dismiss() {
    setShow(false);
    try {
      await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ dismissed: true }));
    } catch { /* best-effort */ }
  }

  function go(route: string) {
    // Mark dismissed once they act so we don't re-prompt next session.
    void AsyncStorage.setItem(keyFor(userId), JSON.stringify({ dismissed: true }));
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).location.assign(route);
    } else {
      // TestFlight Fix Batch 1 (Garry, Aug 2026 — P0 #1):
      // Previously used `router.replace()` which REPLACED the /(tabs)/home
      // entry in the navigation stack with the target route. For top-level
      // routes like `/events` or `/notices`, this meant Home was no longer
      // in the back-stack. Any subsequent forward navigation (e.g., into
      // Notice Board from Events) then popped the user past their tabs and
      // landed them back on `/` (Welcome), which briefly showed the Log In
      // buttons — reads as "logged out" to the member. Using `push()`
      // instead preserves Home in the stack so back always resolves cleanly.
      router.push(route as any);
    }
  }

  if (show !== true) return null;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: c.brandTertiary,
          borderColor: c.brand,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale, letterSpacing: 1 }}>
            WELCOME TO FRIENDPLACE
          </Text>
          <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 18 * scale, marginTop: 4 }}>
            {firstName ? `${firstName}, here's a good first step` : "Here's a good first step"}
          </Text>
        </View>
        <Pressable
          testID="first-run-dismiss"
          onPress={dismiss}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityLabel="Dismiss welcome card"
        >
          <Ionicons name="close" size={20} color={c.brand} />
        </Pressable>
      </View>

      <View style={styles.list}>
        {STEPS.map((s, i) => (
          <Pressable
            key={s.key}
            testID={`first-run-step-${s.key}`}
            onPress={() => go(s.route)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.numBadge, { backgroundColor: c.brand }]}>
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 13 }}>{i + 1}</Text>
            </View>
            <Ionicons name={s.icon} size={26} color={c.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 15 * scale }}>{s.label}</Text>
              <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }} numberOfLines={2}>
                {s.hint}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.muted} />
          </Pressable>
        ))}
      </View>

      <Text style={{ color: c.muted, fontSize: 11 * scale, marginTop: 10, textAlign: "center" }}>
        Tap × to hide — we&apos;ll stop showing this card on its own after a few opens.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  head: { flexDirection: "row", alignItems: "flex-start" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { gap: 8, marginTop: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 60,
  },
  numBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
