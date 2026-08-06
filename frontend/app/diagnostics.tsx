/**
 * /diagnostics — iter154 on-device inbox-socket diagnostics.
 *
 * A visible read-only panel any tester can visit to answer
 * "is my inbox socket actually connected and receiving events?"
 * without needing Xcode / Android logcat / a JS console.
 *
 * The panel is deliberately plain — no theme flourishes, no framer
 * motion, no state beyond what UserSocketProvider already exposes —
 * so a rendering bug elsewhere can never mask a real socket issue.
 *
 * Not linked from any navigation. Visit `/diagnostics` directly
 * (or `friendplace.com.au/diagnostics` when deployed) while logged in.
 * DELETE THIS FILE once the launch-blocker P1 is closed — the
 * diagnostics endpoint on the backend can stay.
 *
 * Locked with Garry (iter154, June 2026).
 */

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useUserSocket } from "@/src/lib/user-socket";
import { useAuth } from "@/src/lib/auth";
import { api, wsUrl } from "@/src/lib/api";

function Row({ k, v }: { k: string; v: string | number | boolean | null | undefined }) {
  const display = v === null || v === undefined
    ? "—"
    : typeof v === "boolean"
    ? (v ? "yes" : "no")
    : String(v);
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v} numberOfLines={2}>{display}</Text>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const { user } = useAuth();
  const { connected, epoch, debug } = useUserSocket();
  const [presence, setPresence] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadPresence = useCallback(async () => {
    if (!user?.id) return;
    try {
      const r: any = await api.getUser(user.id);
      setPresence({
        last_seen_at: r?.last_seen_at,
        privacy: r?.privacy,
        status: r?.status,
      });
    } catch {
      setPresence({ error: "could not fetch /users/me" });
    }
  }, [user?.id]);

  useEffect(() => { loadPresence(); }, [loadPresence]);

  // Auto-refresh presence every 3s so testers can see last_seen_at
  // ticking upward as long as the socket is pinging.
  useEffect(() => {
    const id = setInterval(loadPresence, 3000);
    return () => clearInterval(id);
  }, [loadPresence]);

  const now = new Date().toISOString();
  const lastSeenAgo = presence?.last_seen_at
    ? Math.max(0, Math.round((Date.parse(now) - Date.parse(presence.last_seen_at)) / 1000))
    : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
        setRefreshing(true); await loadPresence(); setRefreshing(false);
      }} />}
    >
      <Text style={styles.h1}>🔬 iter154 — Real-time diagnostics</Text>
      <Text style={styles.p}>
        This panel shows the live state of the per-user inbox WebSocket and
        presence heartbeat. Watch this screen while another user sends you a DM
        — every event should tick a counter in the "Events received" section
        within ~1&nbsp;s.
      </Text>

      <Text style={styles.h2}>Session</Text>
      <View style={styles.card}>
        <Row k="user_id" v={user?.id?.slice(0, 8) + "…"} />
        <Row k="username" v={user?.username} />
        <Row k="socket_url" v={debug.lastUrl?.replace(/^wss?:\/\/[^/]+/, "…") || null} />
      </View>

      <Text style={styles.h2}>Socket</Text>
      <View style={[styles.card, connected ? styles.cardOk : styles.cardBad]}>
        <Row k="connected"       v={connected} />
        <Row k="readyState"      v={debug.readyState} />
        <Row k="attempts_since_hello" v={debug.attempts} />
        <Row k="reconnect_epoch" v={epoch} />
        <Row k="auth_expired"    v={debug.authExpired} />
        <Row k="last_hello_iso"  v={debug.lastHello} />
        <Row k="last_ping_sent"  v={debug.lastPingSent} />
        <Row k="last_pong_recv"  v={debug.lastPongRecv} />
        <Row k="last_close_iso"  v={debug.lastClose} />
        <Row k="last_close_code" v={debug.lastCloseCode || null} />
      </View>

      <Text style={styles.h2}>Events received (since app boot)</Text>
      <View style={styles.card}>
        <Row k="hello"         v={debug.counts.hello         || 0} />
        <Row k="notification"  v={debug.counts.notification  || 0} />
        <Row k="dm_update"     v={debug.counts.dm_update     || 0} />
        <Row k="dm_read"       v={debug.counts.dm_read       || 0} />
        <Row k="reconnect"     v={debug.counts.reconnect     || 0} />
        <Row k="last_event_iso" v={debug.lastEvent} />
      </View>

      <Text style={styles.h2}>Most recent events</Text>
      <View style={styles.card}>
        {debug.recent.length === 0
          ? <Text style={styles.muted}>(none yet — send yourself a DM from another account)</Text>
          : debug.recent.slice().reverse().map((e, i) => (
              <View key={`${e.ts}-${i}`} style={styles.evt}>
                <Text style={styles.evtKind}>{e.kind}</Text>
                <Text style={styles.evtTs}>{e.ts}</Text>
                <Text style={styles.evtPreview}>{e.preview}</Text>
              </View>
            ))}
      </View>

      <Text style={styles.h2}>Presence</Text>
      <View style={styles.card}>
        <Row k="privacy"          v={presence?.privacy} />
        <Row k="chosen_status"    v={presence?.status?.code || presence?.status} />
        <Row k="last_seen_at"     v={presence?.last_seen_at} />
        <Row k="seconds_since_last_seen" v={lastSeenAgo} />
      </View>

      <Text style={styles.h2}>What to look for</Text>
      <View style={styles.card}>
        <Text style={styles.p}>✅ <Text style={styles.b}>connected: yes</Text> — the socket is open.</Text>
        <Text style={styles.p}>✅ <Text style={styles.b}>last_pong_recv</Text> ticks every ~15&nbsp;s while foregrounded.</Text>
        <Text style={styles.p}>✅ Send a DM from another account — a <Text style={styles.b}>dm_update</Text> and a <Text style={styles.b}>notification</Text> should appear in "recent events" within ~1&nbsp;s, and their counters should increment.</Text>
        <Text style={styles.p}>❌ If <Text style={styles.b}>connected: no</Text>, look at <Text style={styles.b}>last_close_code</Text>: 4401 = auth mismatch; 1006 = network/ingress drop; 1001 = tab suspended.</Text>
        <Text style={styles.p}>❌ If <Text style={styles.b}>seconds_since_last_seen</Text> keeps growing past ~20&nbsp;s while the socket is OPEN, the server-side WS presence path is failing.</Text>
      </View>

      <Text style={styles.h2}>URL sanity</Text>
      <View style={styles.card}>
        <Row k="expected_ws" v={wsUrl(`/ws/user/${user?.id || "?"}?token=<redacted>`).replace(/^wss?:\/\/[^/]+/, "…")} />
        <Row k="expected_api_base" v={process.env.EXPO_PUBLIC_BACKEND_URL || "(unset)"} />
      </View>

      <Pressable style={styles.btn} onPress={async () => {
        setRefreshing(true); await loadPresence(); setRefreshing(false);
      }}>
        <Text style={styles.btnT}>Refresh presence now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: "#F8FAFC" },
  content:  { padding: 16, paddingBottom: 64 },
  h1:       { fontSize: 20, fontWeight: "800", color: "#0A2540", marginBottom: 6 },
  h2:       { fontSize: 14, fontWeight: "800", color: "#334155", marginTop: 18, marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase" },
  p:        { fontSize: 13, color: "#334155", lineHeight: 18, marginBottom: 4 },
  b:        { fontWeight: "700" },
  card:     { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E2E8F0" },
  cardOk:   { borderColor: "#14B8A6", backgroundColor: "#F0FDFA" },
  cardBad:  { borderColor: "#EF4444", backgroundColor: "#FEF2F2" },
  row:      { flexDirection: "row", paddingVertical: 4 },
  k:        { flex: 1.1, fontSize: 12, color: "#64748B", fontFamily: "monospace" },
  v:        { flex: 2.4, fontSize: 12, color: "#0F172A", fontFamily: "monospace" },
  muted:    { fontSize: 12, color: "#94A3B8", fontStyle: "italic" },
  evt:      { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E2E8F0" },
  evtKind:  { fontWeight: "800", color: "#0F766E", fontSize: 12 },
  evtTs:    { color: "#64748B", fontSize: 11, fontFamily: "monospace" },
  evtPreview:{ color: "#0F172A", fontSize: 12, fontFamily: "monospace", marginTop: 2 },
  btn:      { marginTop: 24, backgroundColor: "#0F766E", padding: 12, borderRadius: 12, alignItems: "center" },
  btnT:     { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
});
