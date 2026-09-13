/**
 * Transient-failure-aware fetch used by every API client in the website.
 *
 * WHY THIS EXISTS (June 2026)
 * ---------------------------
 * The production website talks to the Emergent *preview* backend. The
 * preview edge router intermittently loses the route for the preview
 * hostname (pod hibernation / route refresh) and answers with a plain
 * text body of exactly "404 page not found" — a response FastAPI can
 * never produce. Those blips lasted seconds but surfaced to the user
 * as four different permanent-looking failures (admin 404, George
 * stuck "thinking", voice failing, Read Aloud failing).
 *
 * This wrapper retries those specific transient signatures (and plain
 * network errors) a couple of times with a short backoff before
 * surfacing one honest, human error.
 */

const EDGE_404_BODY = /^\s*404 page not found\s*$/;
const RETRY_DELAYS_MS = [500, 1500];
// Per-attempt timeout so an unbounded stall (cold pod, proxy hang) can't
// hold the caller for the full ~2 minutes it would otherwise take before
// the retry loop finishes. 10s is enough for a warm Emergent LLM-proxy
// TTS round-trip (observed ~1–3s) while still giving the loop a chance
// to help on a genuinely slow attempt. See Read-Aloud RCA, 14 Aug 2026.
const PER_ATTEMPT_TIMEOUT_MS = 10_000;

/** True when a response looks like a transient edge/gateway blip
 *  rather than a real answer from our FastAPI backend. */
export function isEdgeBlip(status: number, bodyText: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 404 && EDGE_404_BODY.test(bodyText);
}

/**
 * fetch() with up to 2 retries on transient failures.
 *
 *   - Retries: network errors ("Failed to fetch"), 502/503/504, the
 *     edge's plain-text "404 page not found", AND any single attempt
 *     that fails to return within PER_ATTEMPT_TIMEOUT_MS (treated as
 *     a transient blip so the next attempt runs).
 *   - Never retries: AbortError raised by the CALLER's signal (they
 *     cancelled deliberately) or any real API response (including
 *     genuine 4xx JSON errors).
 *   - Returns the Response with its body UNCONSUMED (we peek error
 *     bodies via clone()), so callers stream/parse exactly as before.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const callerSignal = init.signal ?? null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    // Fresh controller PER attempt: we abort it on our 10s timeout so
    // stalled attempts don't consume the whole budget. It's chained to
    // the caller's signal so an external cancel (Iter155 abort-on-growth,
    // component unmount, etc.) still propagates immediately.
    const timeoutCtl = new AbortController();
    let attemptTimedOut = false;
    const timer = setTimeout(() => {
      attemptTimedOut = true;
      timeoutCtl.abort();
    }, PER_ATTEMPT_TIMEOUT_MS);
    // Bridge caller-abort → this attempt's controller so fetch actually
    // stops fast on external cancel (otherwise the fetch keeps running
    // to completion in the background even after the caller gave up).
    const onCallerAbort = () => timeoutCtl.abort();
    if (callerSignal) {
      if (callerSignal.aborted) timeoutCtl.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      const res = await fetch(url, { ...init, signal: timeoutCtl.signal });
      if (!res.ok) {
        let bodyText = '';
        try { bodyText = await res.clone().text(); } catch { /* opaque body */ }
        if (isEdgeBlip(res.status, bodyText)) {
          lastError = new Error(`Transient edge failure (${res.status})`);
          continue;
        }
      }
      return res;
    } catch (err) {
      const name = (err as { name?: string }).name;
      // Caller-initiated aborts must propagate immediately.
      // Distinguish from OUR internal 10s timeout: if the caller's
      // signal has been aborted, respect it and re-throw; otherwise
      // the AbortError came from our own timer and we treat it as a
      // transient blip so the loop retries.
      if (name === 'AbortError') {
        if (callerSignal?.aborted) throw err;
        if (attemptTimedOut) {
          lastError = new Error(`Attempt timed out after ${PER_ATTEMPT_TIMEOUT_MS}ms`);
          continue;
        }
        // Some environments surface non-signal aborts as AbortError —
        // treat those conservatively as transient too so we don't
        // silently drop the retry budget.
        lastError = err;
        continue;
      }
      lastError = err;
    } finally {
      clearTimeout(timer);
      if (callerSignal) {
        try { callerSignal.removeEventListener('abort', onCallerAbort); } catch { /* noop */ }
      }
    }
  }
  console.error('[fetch-retry] all attempts failed for', url, lastError);
  throw new Error('The server took a moment too long to respond. Please try again.');
}
