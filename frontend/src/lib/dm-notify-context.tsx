/**
 * DmNotifyProvider — global watch for incoming DMs, powering the
 * `GlobalDmPrompt` overlay approved by Garry on 24 June 2026.
 *
 * Why this exists: the red badge on the Chats tab is only visible
 * from tabbed screens. Once a member enters a detail stack screen
 * (FP Café table, group room, event page, recipe, …) the tab bar
 * disappears and they have no visual signal that a private message
 * has arrived. George now steps in with a small non-blocking prompt
 * so no chat is ever missed just because of where the member was
 * standing when it landed.
 *
 * Contract (per Garry's ask):
 *   • Poll `/api/dm/{uid}/my-conversations` every 15 s (foregrounded).
 *   • Skip if the member is currently viewing `/dm/{convId}` for the
 *     target conversation.
 *   • Skip if any composer holds the composer-lock (see
 *     `src/lib/composer-lock.ts`) — defers to the NEXT poll cycle.
 *   • Show at most once per (conv_id, last_message_ts) — a newer
 *     message re-arms the prompt.
 *   • "Not now" leaves the Chats badge alone; only marks the current
 *     (conv, last_msg_ts) as dismissed.
 *   • "Open chat" navigates to `/dm/{convId}?other_id=...`. The
 *     existing server-side read-marking on the DM screen clears the
 *     badge — WE never touch it.
 *   • 2+ unread convs → grouped prompt "You have N new private chats".
 *
 * This provider is strictly additive: no existing badge, message-read
 * behaviour, backend, or screen layout is altered.
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
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "@/src/lib/auth";
import { api } from "@/src/lib/api";
import { useComposerActive } from "@/src/lib/composer-lock";

// ─── Types ──────────────────────────────────────────────────────────

type Conversation = {
  id: string;
  other?: { id?: string; first_name?: string; avatar?: string } | null;
  unread_count?: number;
  // Backend `/api/dm/{uid}/conversations` (server.py) returns the
  // most-recent message under `last` and stamps the conv's
  // `updated_at` on every new message — these are the fields we key
  // off. The older `last_message` / `last_message_at` field names
  // were from an earlier iteration and are no longer emitted; if
  // they ever come back we still accept them defensively below.
  last?: { text?: string; created_at?: string } | null;
  updated_at?: string | null;
  last_message?: { text?: string; created_at?: string } | null;
  last_message_at?: string | null;
};

export type DmPrompt =
  | {
      kind: "single";
      convId: string;
      otherId: string;
      name: string;
      avatar?: string;
      messageTs: string; // used to key the dismissed-set
    }
  | {
      kind: "group";
      count: number;
      // Snapshot of the newest message timestamp across the unread
      // set — lets us re-prompt when a new message lands.
      newestTs: string;
      // First few names, purely for optional preview text — we don't
      // ship them in the button copy but a future round could.
      previewNames: string[];
    };

const POLL_MS = 15_000;

// ─── Context ────────────────────────────────────────────────────────

type Ctx = {
  /** The prompt to show, or null if none. */
  prompt: DmPrompt | null;
  /** Called by the "Open chat" / "View chats" button. Navigates AND
   *  marks the prompt as consumed. */
  openTarget: () => void;
  /** Called by the "Not now" button. Records the dismissal so we
   *  don't re-nag for this exact message set, but leaves the badge
   *  alone. */
  dismiss: () => void;
};

const DmNotifyCtx = createContext<Ctx | null>(null);

// ─── Helpers ────────────────────────────────────────────────────────

// Time-based cooldown window (Garry, 4 Aug 2026): a "Not now" tap
// suppresses the prompt for this long UNLESS a genuinely new message
// arrives in the meantime. Prior key-based approach re-armed the
// prompt every time updated_at was bumped by unrelated activity
// (reads, presence pings), causing the ~2-minute nag Garry reported.
const DISMISS_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

type DismissRecord = {
  at: number;                       // ms since epoch when the user tapped Not now
  seenTs: Record<string, string>;   // convId → newest message ts at dismissal
  seenFingerprint: Record<string, string>;  // convId → `${unread}|${text}|${ts}` at dismissal
};

function _newest_ts(c: Conversation): string {
  return (
    c.last?.created_at ||
    c.updated_at ||
    c.last_message?.created_at ||
    c.last_message_at ||
    ""
  );
}

// Content fingerprint that changes ONLY when a real new message
// arrives — not when server bumps `updated_at` due to reads/pings.
// Combines the unread count, last message text and last message ts.
// Immune to timestamp wobble because it also requires the text or
// count to match. (Garry, 4 Aug 2026 — fixes "Not now keeps coming
// back" nag caused by pure-timestamp comparison drifting.)
function _fingerprint(c: Conversation): string {
  const unread = String(c.unread_count || 0);
  const text = String(c.last?.text || c.last_message?.text || "");
  const ts = _newest_ts(c);
  return `${unread}|${text}|${ts}`;
}

function _has_fresh_message(
  convs: Conversation[],
  seenTs: Record<string, string>,
  seenFp: Record<string, string>,
): boolean {
  // Any eligible conv whose fingerprint differs from the snapshot →
  // genuine new activity → re-arm the prompt. We require BOTH the
  // fingerprint to differ AND the newest ts to have advanced, so
  // read-only pings (which shouldn't change ts anyway) can't trigger.
  for (const c of convs) {
    const nowFp = _fingerprint(c);
    const prevFp = seenFp[c.id];
    const nowTs = _newest_ts(c);
    const prevTs = seenTs[c.id] || "";
    if (prevFp === undefined) {
      // Conv was not tracked at dismissal — must be genuinely new to
      // the eligible set (either a new conv or one that just crossed
      // the unread threshold). Count as fresh.
      if (nowTs) return true;
      continue;
    }
    if (nowFp !== prevFp && nowTs && nowTs > prevTs) return true;
  }
  return false;
}

function _pick_prompt(
  convs: Conversation[],
  viewingConvId: string | null,
  dismiss: DismissRecord | null,
): DmPrompt | null {
  const unread = convs.filter((c) => (c.unread_count || 0) > 0);
  if (unread.length === 0) return null;

  // Filter out the conv the member is currently reading — the read
  // pipeline on the DM screen will clear that unread count on its
  // next poll anyway, but we don't want to nag them in the meantime.
  const eligible = viewingConvId
    ? unread.filter((c) => c.id !== viewingConvId)
    : unread;
  if (eligible.length === 0) return null;

  // Time-based cooldown: if we're still inside the cooldown window
  // AND no genuinely fresh message has landed since the dismissal,
  // suppress. Fresh messages always re-arm regardless of cooldown.
  if (dismiss) {
    const withinCooldown = Date.now() - dismiss.at < DISMISS_COOLDOWN_MS;
    if (withinCooldown && !_has_fresh_message(eligible, dismiss.seenTs, dismiss.seenFingerprint)) {
      return null;
    }
  }

  if (eligible.length === 1) {
    const c = eligible[0];
    const ts = _newest_ts(c);
    const p: DmPrompt = {
      kind: "single",
      convId: c.id,
      otherId: String(c.other?.id || ""),
      name: c.other?.first_name || "Someone",
      avatar: c.other?.avatar,
      messageTs: ts,
    };
    return p;
  }

  // Group prompt — take the newest message timestamp so a fresh
  // arrival re-arms the prompt after dismissal.
  const newest = eligible.reduce<string>((acc, c) => {
    const t = _newest_ts(c);
    return t > acc ? t : acc;
  }, "");
  const previewNames = eligible
    .slice(0, 3)
    .map((c) => c.other?.first_name || "Someone");
  const p: DmPrompt = {
    kind: "group",
    count: eligible.length,
    newestTs: newest,
    previewNames,
  };
  return p;
}

// ─── Provider ───────────────────────────────────────────────────────

export function DmNotifyProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const composerBusy = useComposerActive();

  const [convs, setConvs] = useState<Conversation[]>([]);
  const [dismissedVersion, setDismissedVersion] = useState(0);
  // Time-based cooldown record. Null before any dismissal; set by
  // dismiss(); cleared implicitly when a fresh message re-arms
  // (see _pick_prompt).
  const dismissedRef = useRef<DismissRecord | null>(null);
  const timerRef = useRef<any>(null);

  // Path check — while the member is INSIDE /dm/{id} we treat that
  // conversation as "being viewed" and never prompt for it. Any
  // navigation change causes an immediate recompute so a stale prompt
  // can't linger after the member has just opened the DM.
  const viewingConvId = useMemo(() => {
    if (!pathname) return null;
    const m = pathname.match(/^\/dm\/([^/?#]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  const load = useCallback(async () => {
    if (!user?.id || !token) return;
    try {
      const rows: any = await api.myConversationsSilent(user.id, "active");
      if (Array.isArray(rows)) setConvs(rows as Conversation[]);
      else setConvs([]);
    } catch {
      // Silent — we don't spam the console for a background poll.
    }
  }, [user?.id, token]);

  // Poll loop — only while authed + foregrounded. Follows the same
  // 15s cadence as the tab-bar unread badge so we're additive, not
  // additive-with-extra-cost.
  useEffect(() => {
    if (!user?.id || !token) {
      setConvs([]);
      return;
    }
    load();
    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    start();
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        load();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [user?.id, token, load]);

  // Derived prompt — recomputes on convs change, path change, and
  // dismissedVersion bump. Deliberately excludes composerBusy: the
  // gate is applied in the RENDERING consumer, not here, so the
  // provider stays composer-agnostic and easy to unit test.
  const prompt = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _bump = dismissedVersion; // pull into deps
    return _pick_prompt(convs, viewingConvId, dismissedRef.current);
  }, [convs, viewingConvId, dismissedVersion]);

  // If a genuinely NEW message arrives after a dismissal, its newest
  // ts will exceed the recorded seenTs → _has_fresh_message returns
  // true → the cooldown is bypassed and the prompt re-arms. See
  // _pick_prompt for the check.

  const _record_dismissal = useCallback(() => {
    // Snapshot the current newest-ts + fingerprint per eligible conv so
    // any FUTURE arrival can be detected as "genuinely new" and bypass
    // the cooldown. Uses the same source-of-truth field priority as the
    // pick logic (see _newest_ts + _fingerprint).
    const seenTs: Record<string, string> = {};
    const seenFingerprint: Record<string, string> = {};
    for (const c of convs) {
      if ((c.unread_count || 0) <= 0) continue;
      const ts = _newest_ts(c);
      if (ts) seenTs[c.id] = ts;
      seenFingerprint[c.id] = _fingerprint(c);
    }
    dismissedRef.current = { at: Date.now(), seenTs, seenFingerprint };
    setDismissedVersion((v) => v + 1);
  }, [convs]);

  const dismiss = useCallback(() => {
    if (!prompt) return;
    _record_dismissal();
  }, [prompt, _record_dismissal]);

  const openTarget = useCallback(() => {
    if (!prompt) return;
    // Mark dismissed FIRST so the prompt doesn't flash back into
    // view during the navigation transition — the DM screen will
    // clear the unread count server-side on its own poll, at which
    // point the prompt is truly gone regardless of dismissed state.
    _record_dismissal();
    if (prompt.kind === "single") {
      const q = prompt.otherId
        ? `?other_id=${encodeURIComponent(prompt.otherId)}`
        : "";
      router.push(`/dm/${prompt.convId}${q}` as any);
    } else {
      router.push("/chats" as any);
    }
  }, [prompt, router, _record_dismissal]);

  // No housekeeping trim needed — dismissedRef holds at most one
  // small record. Old logic used a growing Map keyed on messages.

  // Expose composerBusy through a memoised value so the renderer
  // (`GlobalDmPrompt`) can defer showing while typing/recording is
  // in progress. We do NOT modify the provider's state during a
  // busy period — the deferral is purely a rendering choice.
  const value = useMemo<Ctx & { _composerBusy: boolean }>(
    () => ({
      prompt: composerBusy ? null : prompt,
      openTarget,
      dismiss,
      _composerBusy: composerBusy,
    }),
    [prompt, openTarget, dismiss, composerBusy],
  );

  return <DmNotifyCtx.Provider value={value}>{children}</DmNotifyCtx.Provider>;
}

export function useDmNotify(): Ctx {
  const ctx = useContext(DmNotifyCtx);
  if (!ctx) throw new Error("useDmNotify must be used inside DmNotifyProvider");
  return ctx;
}
