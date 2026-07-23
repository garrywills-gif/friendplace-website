/**
 * StatusProvider — global presence/status source of truth for the
 * signed-in member.
 *
 * Backs the "My Status" card, café "Looking for a chat" banner, and
 * every AvatarWithBadge across the app. All wire-format details live
 * in `src/lib/api.ts` (`api.statusMe`, `api.statusSetManual`,
 * `api.statusHeartbeat`, `api.statusForUsers`). The LOCKED design doc
 * at `/app/memory/design-presence-and-status.md` is the source of
 * truth for behaviour.
 *
 * Responsibilities:
 *  • On mount (and every foreground) → POST /api/status/heartbeat
 *    then GET /api/status/me.
 *  • While foreground → heartbeat every 60s (design §5.5).
 *  • Expose `useMyStatus()` for the Home card and any consumer that
 *    needs the signed-in user's own status.
 *  • Expose `useUserStatuses(ids)` — a batched, debounced lookup so
 *    list-heavy screens (Chats, Friends, café roster) can attach a
 *    badge to each avatar without spamming the backend.
 *
 * Not responsibilities (intentionally):
 *  • The `looking` list — that lives closer to the banner because it's
 *    café-scoped and refreshed on focus, not globally polled.
 *  • WebSocket status_change broadcast handling — deferred to the
 *    banner component per design §4.3 ("the existing café WebSocket").
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
import { api } from "@/src/lib/api";

// ─── Types (mirror the backend shape) ──────────────────────────────

export type ManualStatus = "looking" | "happy" | "busy" | null;

export type EffectiveStatus =
  | "online"
  | "offline"
  | "in_cafe"
  | "looking"
  | "happy"
  | "busy";

export type MyStatus = {
  user_id: string;
  effective: EffectiveStatus;
  manual: ManualStatus;
  manual_set_at: string | null;
  manual_expires_at: string | null;
  in_cafe_table_id: string | null;
  last_seen_at: string | null;
};

// ─── Status metadata (glyph + label). Kept in one place so every
//     surface renders the same emoji + copy. If we swap to SVG later,
//     only this constant changes. Precedence order matches design §2. ─
export const STATUS_META: Record<EffectiveStatus, { glyph: string; label: string }> = {
  offline: { glyph: "⚫", label: "Offline" },
  looking: { glyph: "🦋", label: "Looking for a chat" },
  in_cafe: { glyph: "☕", label: "In the FP Café" },
  busy: { glyph: "🟡", label: "Busy right now" },
  happy: { glyph: "😊", label: "Happy to connect" },
  online: { glyph: "🟢", label: "Online" },
};

const HEARTBEAT_MS = 60_000; // 60s per LOCKED design §5.5
const BATCH_DEBOUNCE_MS = 200; // Coalesce list-view badge fetches
const BATCH_TTL_MS = 45_000; // Cached statuses stay fresh 45s

// ─── Context shape ─────────────────────────────────────────────────

type Ctx = {
  /** Signed-in user's status. `null` until the first successful fetch. */
  me: MyStatus | null;
  /** True while a fetch/mutation is in flight. Useful for the toggle. */
  busy: boolean;
  /** Set (or clear with `null`) the manual status. Optimistic. */
  setManual: (status: ManualStatus) => Promise<void>;
  /** Force a re-fetch of `/status/me`. */
  refresh: () => Promise<void>;
  /** Batched, deduped, TTL-cached lookup for other users' statuses. */
  getUserStatuses: (ids: string[]) => Promise<Record<string, EffectiveStatus>>;
  /** Synchronous cache reader. Returns null when unknown. Renamed
   *  from a hook-shaped name to make the eslint react-hooks rule
   *  happy — this is a plain reader, not a hook. */
  getCachedStatus: (userId?: string | null) => EffectiveStatus | null;
};

const StatusCtx = createContext<Ctx | null>(null);

// ─── Provider ──────────────────────────────────────────────────────

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [me, setMe] = useState<MyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Per-app in-memory cache of other members' statuses. Keyed by
  // user_id. Falls out of use after BATCH_TTL_MS. We keep the entire
  // cache in a ref so background re-renders don't clobber it, and we
  // bump `cacheVersion` state whenever the map changes so hooks that
  // subscribe via `useUserStatus` re-render.
  const cacheRef = useRef<Map<string, { status: EffectiveStatus; ts: number }>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  // Pending IDs waiting to be flushed on the next debounced batch.
  const pendingRef = useRef<Set<string>>(new Set());
  // Timer handle for the debounced flush. RN's setTimeout returns a
  // number (native) or Timeout (web); loosely typed to satisfy both.
  const flushTimerRef = useRef<any>(null);
  // Resolvers waiting for the next batch flush.
  const waitersRef = useRef<(() => void)[]>([]);

  // ─── /status/me + heartbeat ──────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setMe(null);
      return;
    }
    try {
      const doc: any = await api.statusMe();
      setMe(doc as MyStatus);
    } catch {
      // Silent — keep the last known-good value.
    }
  }, [user?.id]);

  const heartbeatOnce = useCallback(async () => {
    if (!user?.id) return;
    try {
      await api.statusHeartbeat();
    } catch { /* transient network, ignore */ }
  }, [user?.id]);

  // Bootstrap on login + start heartbeat loop while foreground. Also
  // listens to AppState so we can pause the loop while backgrounded
  // (design §5.5: "on background: stop heartbeat").
  useEffect(() => {
    if (!user?.id) {
      setMe(null);
      return;
    }
    let cancelled = false;
    let intervalId: any = null;

    const bootAndBeat = async () => {
      await heartbeatOnce();
      if (cancelled) return;
      await refresh();
    };
    bootAndBeat();

    const startInterval = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        heartbeatOnce();
      }, HEARTBEAT_MS);
    };
    const stopInterval = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    startInterval();

    const onChange = (s: AppStateStatus) => {
      if (s === "active") {
        heartbeatOnce();
        refresh();
        startInterval();
      } else {
        stopInterval();
      }
    };
    const sub = AppState.addEventListener("change", onChange);

    return () => {
      cancelled = true;
      stopInterval();
      sub.remove();
    };
  }, [user?.id, heartbeatOnce, refresh]);

  // ─── setManual (with optimistic update) ──────────────────────────

  const setManual = useCallback(async (status: ManualStatus) => {
    if (!user?.id) return;
    setBusy(true);
    const prev = me;
    // Optimistic — reflect the change immediately so the toggle feels
    // instant even on 3G. Server response overwrites shortly after.
    if (prev) {
      const optimistic: MyStatus = {
        ...prev,
        manual: status,
        manual_set_at: status ? new Date().toISOString() : null,
        manual_expires_at: null,
        effective:
          status === "looking"
            ? "looking"
            : status === "busy"
            ? "busy"
            : status === "happy"
            ? prev.in_cafe_table_id
              ? "in_cafe"
              : "happy"
            : prev.in_cafe_table_id
            ? "in_cafe"
            : "online",
      };
      setMe(optimistic);
    }
    try {
      const doc: any = await api.statusSetManual(status);
      setMe(doc as MyStatus);
    } catch {
      // Revert on failure so the UI doesn't lie.
      if (prev) setMe(prev);
    } finally {
      setBusy(false);
    }
  }, [me, user?.id]);

  // ─── Batched status lookup for other users ───────────────────────

  const flushBatch = useCallback(async () => {
    const ids = Array.from(pendingRef.current);
    pendingRef.current.clear();
    flushTimerRef.current = null;
    if (!ids.length) return;
    // Chunk into requests of 50 (server contract).
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    try {
      const results = await Promise.all(chunks.map((c) => api.statusForUsers(c)));
      const now = Date.now();
      const map = cacheRef.current;
      for (const r of results) {
        const statuses = ((r as any)?.statuses || {}) as Record<string, EffectiveStatus>;
        for (const [uid, s] of Object.entries(statuses)) {
          map.set(uid, { status: s as EffectiveStatus, ts: now });
        }
      }
      setCacheVersion((v) => v + 1);
    } catch {
      // On failure, seed misses with "online" so we don't leave a
      // spinner or ping the server every render.
      const now = Date.now();
      const map = cacheRef.current;
      for (const uid of ids) {
        if (!map.has(uid)) map.set(uid, { status: "online", ts: now });
      }
      setCacheVersion((v) => v + 1);
    } finally {
      // Wake anything awaiting a resolved batch.
      const waiters = waitersRef.current.splice(0);
      waiters.forEach((fn) => {
        try { fn(); } catch { /* no-op */ }
      });
    }
  }, []);

  const enqueue = useCallback((ids: string[]) => {
    const now = Date.now();
    const map = cacheRef.current;
    let queued = 0;
    for (const uid of ids) {
      if (!uid) continue;
      const cached = map.get(uid);
      if (cached && (now - cached.ts) < BATCH_TTL_MS) continue;
      pendingRef.current.add(uid);
      queued += 1;
    }
    if (!queued) return;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => { flushBatch(); }, BATCH_DEBOUNCE_MS);
  }, [flushBatch]);

  const getUserStatuses = useCallback(async (ids: string[]) => {
    enqueue(ids);
    // If there's a pending flush, wait for it before returning.
    if (pendingRef.current.size > 0 || flushTimerRef.current) {
      await new Promise<void>((resolve) => { waitersRef.current.push(resolve); });
    }
    const map = cacheRef.current;
    const out: Record<string, EffectiveStatus> = {};
    for (const uid of ids) {
      const cached = map.get(uid);
      if (cached) out[uid] = cached.status;
    }
    return out;
  }, [enqueue]);

  const getCachedStatus = useCallback((userId?: string | null): EffectiveStatus | null => {
    if (!userId) return null;
    const map = cacheRef.current;
    const cached = map.get(userId);
    // Return null (not "online") when unknown so consumers can decide
    // whether to render a placeholder vs no badge.
    return cached ? cached.status : null;
    // cacheVersion is intentionally listed even though the linter can't
    // see it — bumping it forces callers holding a stale reference to
    // re-render after a batch flush. Without this, list rows keep
    // rendering "unknown" until they re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion]);

  const value = useMemo<Ctx>(() => ({
    me,
    busy,
    setManual,
    refresh,
    getUserStatuses,
    getCachedStatus,
  }), [me, busy, setManual, refresh, getUserStatuses, getCachedStatus]);

  return <StatusCtx.Provider value={value}>{children}</StatusCtx.Provider>;
}

// ─── Hooks ─────────────────────────────────────────────────────────

export function useStatus(): Ctx {
  const ctx = useContext(StatusCtx);
  if (!ctx) throw new Error("useStatus must be used inside <StatusProvider>");
  return ctx;
}

/** Convenience shortcut for the "My Status" card. */
export function useMyStatus() {
  const { me, busy, setManual, refresh } = useStatus();
  return { me, busy, setManual, refresh };
}

/**
 * Hook: batched-fetch + subscribe to a single user's status.
 * Returns null while unknown. Re-renders when the batch resolves.
 * Safe to call from list rows — the debounce coalesces every visible
 * row's request into a single /api/status/for-users hit.
 */
export function useUserBadgeStatus(userId?: string | null): EffectiveStatus | null {
  const { getUserStatuses, getCachedStatus } = useStatus();
  useEffect(() => {
    if (userId) { getUserStatuses([userId]).catch(() => {}); }
  }, [userId, getUserStatuses]);
  return getCachedStatus(userId);
}

/**
 * Hook: batched-fetch statuses for an entire list at once. Callers
 * pass the current list of visible user IDs (e.g. from a FlatList's
 * data) and get back a lookup dict. Uses the same debounced batch so
 * multiple screens mounting simultaneously coalesce into one call.
 */
export function useUserBadgeStatuses(userIds: string[]): Record<string, EffectiveStatus> {
  const { getUserStatuses, getCachedStatus } = useStatus();
  const keyed = userIds.join(",");
  useEffect(() => {
    if (userIds.length) { getUserStatuses(userIds).catch(() => {}); }
  }, [keyed, getUserStatuses]); // eslint-disable-line react-hooks/exhaustive-deps
  const dict: Record<string, EffectiveStatus> = {};
  for (const uid of userIds) {
    const s = getCachedStatus(uid);
    if (s) dict[uid] = s;
  }
  return dict;
}
