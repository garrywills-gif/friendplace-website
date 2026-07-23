/**
 * CafeLookingBanner — the "Looking for a chat" banner shown at the
 * top of an FP Café table. Lists members (nearby) whose effective
 * status is `looking`, and lets the viewer tap a name to open a
 * contextual action sheet (Join their table + Send a private message,
 * or PM only).
 *
 * Design references:
 *   • §5.2 FP Café "Looking for a chat" banner
 *   • §4.1 GET /api/status/looking?scope=nearby
 *   • §4.3 WebSocket status_change / looking_list_update events —
 *     the backend broadcasts on the existing café WebSocket. Until
 *     the server hooks are wired we rely on 30s polling + on-focus
 *     refresh for a live-feel MVP.
 *
 * Behaviour highlights:
 *   • Single-member state: "🦋 <Name> would love a chat" · subtitle
 *     "Tap to start chatting."
 *   • Multi-member state: heading "People looking for a chat" · rows
 *     prefixed with 🦋 each.
 *   • Auto-hides when the list becomes empty.
 *   • Tap action sheet:
 *     - member.in_cafe_table_id → [Join their table] + [Private msg]
 *     - else → [Private msg only]
 *   • The signed-in user (if they themselves are looking) is filtered
 *     server-side but we also drop them defensively.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import AvatarBubble from "@/src/components/AvatarBubble";

type Looker = {
  user_id: string;
  name?: string;
  avatar_url?: string | null;
  suburb?: string | null;
  since?: string | null;
  in_cafe_table_id?: string | null;
};

const POLL_MS = 30_000; // Cheap 30s polling until WS wiring lands.

export default function CafeLookingBanner({
  currentTableId,
  testID = "cafe-looking-banner",
}: {
  currentTableId?: string | null;
  testID?: string;
}) {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const router = useRouter();

  const [lookers, setLookers] = useState<Looker[]>([]);
  const [loading, setLoading] = useState(false);
  const [sheetFor, setSheetFor] = useState<Looker | null>(null);
  const [acting, setActing] = useState(false);
  const intervalRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res: any = await api.statusLooking("nearby");
      const items: Looker[] = Array.isArray(res?.items) ? res.items : [];
      // Defensive self-filter — server already excludes but we double-
      // check so a stale response never shows the viewer their own row.
      const clean = items.filter((x) => x.user_id && x.user_id !== user.id);
      setLookers(clean);
    } catch {
      // Silent — keep last-known list rather than clearing on a blip.
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(load, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [load]);

  // Nothing to show → render nothing (keeps the café clean when quiet).
  if (!lookers.length && !loading) return null;

  const isSingle = lookers.length === 1;
  const inCafe = sheetFor?.in_cafe_table_id ?? null;
  // If the tapped member is at the SAME table we're viewing, "Join
  // their table" would be a no-op — hide it in that case.
  const canJoinTable = !!inCafe && inCafe !== currentTableId;

  const goPrivateMessage = async (target: Looker) => {
    if (!user?.id || acting) return;
    setActing(true);
    try {
      const conv: any = await api.startDm(user.id, target.user_id);
      setSheetFor(null);
      router.push(`/dm/${conv.id}?other_id=${target.user_id}` as any);
    } catch (e: any) {
      show(e?.message || "Could not open the chat.");
    } finally {
      setActing(false);
    }
  };

  const goJoinTable = async (target: Looker) => {
    if (!user?.id || acting || !target.in_cafe_table_id) return;
    setActing(true);
    try {
      setSheetFor(null);
      router.push(`/table/${target.in_cafe_table_id}` as any);
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <View
        testID={testID}
        style={[styles.banner, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}
      >
        {isSingle ? (
          <Pressable
            testID={`${testID}-row-${lookers[0].user_id}`}
            onPress={() => setSheetFor(lookers[0])}
            accessibilityRole="button"
            accessibilityLabel={`${lookers[0].name || "Someone"} would love a chat`}
            style={styles.singleRow}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={2}
                style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}
              >
                🦋 {lookers[0].name || "Someone"} would love a chat
              </Text>
              <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                Tap to start chatting.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={c.brand} />
          </Pressable>
        ) : (
          <View>
            <Text
              style={{
                color: c.onSurface,
                fontWeight: "900",
                fontSize: 15 * scale,
                marginBottom: 6,
              }}
            >
              People looking for a chat
            </Text>
            {lookers.slice(0, 6).map((m, i) => (
              <Pressable
                key={m.user_id}
                testID={`${testID}-row-${m.user_id}`}
                onPress={() => setSheetFor(m)}
                accessibilityRole="button"
                accessibilityLabel={`Say hello to ${m.name || "member"}`}
                style={[
                  styles.multiRow,
                  {
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: c.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 16 }}>🦋</Text>
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: c.onSurface,
                    fontWeight: "700",
                    fontSize: 15 * scale,
                    marginLeft: 6,
                  }}
                >
                  {m.name || "Member"}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.brand} />
              </Pressable>
            ))}
            {lookers.length > 6 ? (
              <Text style={{ color: c.muted, fontSize: 12 * scale, marginTop: 6, fontStyle: "italic" }}>
                +{lookers.length - 6} more nearby…
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Action sheet — light-weight Modal that respects the design
          "Join table + PM" vs "PM only" branch. */}
      <Modal
        visible={!!sheetFor}
        animationType={Platform.OS === "ios" ? "slide" : "fade"}
        transparent
        onRequestClose={() => setSheetFor(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetFor(null)}>
          <Pressable
            style={[styles.sheetCard, { backgroundColor: c.surface }]}
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
          >
            <View style={styles.sheetHeader}>
              <AvatarBubble value={sheetFor?.avatar_url as any} size={44} fallback="🙂" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>
                  Say hello to {sheetFor?.name || "them"} 🦋
                </Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }}>
                  {sheetFor?.suburb ? `${sheetFor.suburb} · ` : ""}Looking for a chat
                </Text>
              </View>
              <Pressable
                onPress={() => setSheetFor(null)}
                hitSlop={10}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={c.muted} />
              </Pressable>
            </View>

            {canJoinTable ? (
              <Pressable
                testID="looking-sheet-join"
                onPress={() => sheetFor && goJoinTable(sheetFor)}
                disabled={acting}
                style={({ pressed }) => [
                  styles.sheetPrimary,
                  {
                    backgroundColor: c.brand,
                    opacity: acting ? 0.6 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={{ fontSize: 18 }}>☕</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale, marginLeft: 8 }}>
                  Join their table
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              testID="looking-sheet-pm"
              onPress={() => sheetFor && goPrivateMessage(sheetFor)}
              disabled={acting}
              style={({ pressed }) => [
                canJoinTable ? styles.sheetSecondary : styles.sheetPrimary,
                {
                  backgroundColor: canJoinTable ? c.surface : c.brand,
                  borderColor: c.brand,
                  opacity: acting ? 0.6 : pressed ? 0.85 : 1,
                  borderWidth: canJoinTable ? 2 : 0,
                },
              ]}
            >
              {acting ? (
                <ActivityIndicator color={canJoinTable ? c.brand : "#FFFFFF"} />
              ) : (
                <>
                  <Text style={{ fontSize: 18 }}>✉️</Text>
                  <Text
                    style={{
                      color: canJoinTable ? c.brand : "#FFFFFF",
                      fontWeight: "900",
                      fontSize: 15 * scale,
                      marginLeft: 8,
                    }}
                  >
                    Send a private message
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              testID="looking-sheet-cancel"
              onPress={() => setSheetFor(null)}
              style={styles.sheetCancel}
              accessibilityRole="button"
            >
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  singleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  multiRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  sheetPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 52,
  },
  sheetSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 52,
  },
  sheetCancel: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    minHeight: 44,
  },
});
