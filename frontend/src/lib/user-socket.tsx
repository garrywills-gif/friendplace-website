/**
 * UserSocketProvider — the single long-lived per-user WebSocket for
 * FriendPlace real-time inbox events (iter154, June 2026).
 *
 * Contract
 * --------
 *   • One socket per authenticated session, connected to
 *     `/api/ws/user/{user_id}` with the bearer token as query.
 *   • Fans out server events to any subscriber via an
 *     EventEmitter-style API:
 *
 *         const { subscribe } = useUserSocket();
 *         useEffect(() => subscribe("notification", (evt) => …), []);
 *
 *   • Recognised event types (see /app/backend/server.py):
 *         "notification" — any push_notification() insert
 *         "dm_update"    — new message in a DM the user participates in
 *         "dm_read"      — user marked a DM read (echoes across devices)
 *         "hello"        — server confirmed authentication
 *         "pong"         — response to a client-sent ping
 *
 *   • Reconnect strategy: exponential backoff with jitter, capped at
 *     30 s. On AppState → "active" the socket is re-checked and
 *     nudged if it isn't OPEN. On auth-expiry (code 4401) we do
 *     NOT keep looping — we defer until AuthProvider re-issues a
 *     token, then reconnect.
 *
 *   • Keep-alive: sends `{"type":"ping"}` every 25 s while OPEN.
 *     Reconciliation polling on top of the socket happens in each
 *     consumer (badge / list / notifications) at 30 s cadence.
 *
 *   • The socket is a REAL-TIME NICETY, never the source of truth.
 *     Every consumer must still be able to reconcile its state via
 *     the REST endpoints; the socket only makes that state land
 *     faster.
 *
 * Locked with Garry (iter154) — do not add business logic here.
 * All decisions about *what to do* with an event live in the
 * consumer that subscribes.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "@/src/lib/auth";
import { wsUrl } from "@/src/lib/api";

type EventKind =
  | "notification"
  | "dm_update"
  | "dm_read"
  | "hello"
  | "pong"
  | "reconnect"; // synthetic: fired locally after (re)connect settles

type Handler = (evt: any) => void;

type Ctx = {
  /** True once the socket has completed the "hello" handshake. */
  connected: boolean;
  /** How many reconnect attempts since the last successful open.
   *  Used by consumers to decide when to do a reconciliation fetch. */
  epoch: number;
  /** Subscribe to a server-emitted event; returns an unsubscribe fn. */
  subscribe: (kind: EventKind, handler: Handler) => () => void;
};

const UserSocketCtx = createContext<Ctx | null>(null);

// Reconnect backoff parameters. First attempt fires at ~1 s; the
// sequence roughly doubles until 30 s and then holds. A ±25% jitter
// prevents thundering-herd retries after a server bounce.
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const KEEPALIVE_MS = 25_000;

function _next_delay(attempt: number): number {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const jitter = raw * (0.75 + Math.random() * 0.5);
  return Math.floor(jitter);
}

export function UserSocketProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [connected, setConnected] = useState(false);
  const [epoch, setEpoch] = useState(0);

  // Handler registry keyed by event kind → Set<Handler>. Using a ref
  // so subscribe/unsubscribe don't cause re-renders of the provider.
  const handlersRef = useRef<Map<EventKind, Set<Handler>>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<any>(null);
  const keepaliveTimerRef = useRef<any>(null);
  // Auth-expired sockets close with 4401. When that happens we
  // freeze reconnect attempts until the AuthProvider hands us a
  // new token (i.e. `token` prop changes) — otherwise we'd spin
  // and flood the server with unauthorised handshakes.
  const authExpiredRef = useRef(false);

  const dispatch = useCallback((kind: EventKind, evt: any) => {
    const set = handlersRef.current.get(kind);
    if (!set) return;
    for (const h of Array.from(set)) {
      try { h(evt); } catch { /* consumer error — never crash the socket loop */ }
    }
  }, []);

  const subscribe = useCallback((kind: EventKind, handler: Handler) => {
    let set = handlersRef.current.get(kind);
    if (!set) {
      set = new Set();
      handlersRef.current.set(kind, set);
    }
    set.add(handler);
    return () => {
      const s = handlersRef.current.get(kind);
      if (s) s.delete(handler);
    };
  }, []);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    const s = wsRef.current;
    if (s) {
      wsRef.current = null;
      try { s.close(); } catch { /* ignore */ }
    }
  }, []);

  const scheduleReconnect = useCallback((connect: () => void) => {
    if (authExpiredRef.current) return; // AuthProvider will retrigger us
    if (reconnectTimerRef.current) return;
    const delay = _next_delay(attemptRef.current);
    attemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!user?.id || !token) return;
    // Never open a second socket; close any existing first.
    cleanup();
    let ws: WebSocket;
    try {
      ws = new WebSocket(
        wsUrl(`/ws/user/${user.id}?token=${encodeURIComponent(token)}`),
      );
    } catch {
      scheduleReconnect(connect);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      // The "hello" frame will confirm auth in a moment; we don't
      // flip connected=true until then, so consumers that trigger
      // a reconciliation on the "connected" edge don't fire twice.
      // Reset backoff so the next drop starts from a fresh 1 s.
      attemptRef.current = 0;
      // Start keep-alive.
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = setInterval(() => {
        try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
      }, KEEPALIVE_MS);
    };

    ws.onmessage = (ev) => {
      let payload: any;
      try { payload = JSON.parse(ev.data as any); } catch { return; }
      const kind = payload?.type as EventKind | undefined;
      if (!kind) return;
      if (kind === "hello") {
        setConnected(true);
        setEpoch((e) => e + 1);
        // Give consumers a chance to reconcile on every fresh
        // connection — not on `hello` frames from the SAME session,
        // but the epoch bump covers reconnection edges.
        dispatch("reconnect", { server_time: payload.server_time });
        return;
      }
      dispatch(kind, payload);
    };

    ws.onerror = () => {
      // Do nothing — onclose will follow immediately with a code.
    };

    ws.onclose = (ev) => {
      setConnected(false);
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
      // 4401 = server-side auth failure. Sit tight until AuthProvider
      // hands us a new token.
      if (ev.code === 4401) {
        authExpiredRef.current = true;
        return;
      }
      // 1000 = clean close (user logged out). Do not reconnect.
      if (ev.code === 1000) return;
      scheduleReconnect(connect);
    };
  }, [user?.id, token, cleanup, scheduleReconnect, dispatch]);

  // Bring the socket up whenever we have both a user and a token.
  // On sign-out/token-refresh the effect tears down cleanly.
  useEffect(() => {
    if (!user?.id || !token) {
      authExpiredRef.current = false;
      cleanup();
      setConnected(false);
      return;
    }
    authExpiredRef.current = false;
    connect();
    return cleanup;
  }, [user?.id, token, connect, cleanup]);

  // AppState → active: if we came back to the foreground and the
  // socket isn't OPEN, nudge a reconnect immediately (don't wait
  // for the backoff timer). If it IS open, still send a ping so
  // dead-connection detection is fast.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s !== "active") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Cancel any pending timer and try now.
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        attemptRef.current = 0;
        connect();
      } else {
        try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
      }
    });
    return () => sub.remove();
  }, [connect]);

  const value = useMemo<Ctx>(
    () => ({ connected, epoch, subscribe }),
    [connected, epoch, subscribe],
  );

  return <UserSocketCtx.Provider value={value}>{children}</UserSocketCtx.Provider>;
}

export function useUserSocket(): Ctx {
  const ctx = useContext(UserSocketCtx);
  if (!ctx) throw new Error("useUserSocket must be used inside UserSocketProvider");
  return ctx;
}

/**
 * Convenience hook — subscribes to a single event type for the
 * lifetime of the caller component. Handler identity may change
 * between renders (we store it in a ref) so consumers can pass
 * inline arrow functions without churning subscriptions.
 */
export function useInboxEvent(kind: EventKind, handler: Handler) {
  const { subscribe } = useUserSocket();
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; }, [handler]);
  useEffect(() => subscribe(kind, (evt) => ref.current(evt)), [subscribe, kind]);
}
