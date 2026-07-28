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

/** True when a response looks like a transient edge/gateway blip
 *  rather than a real answer from our FastAPI backend. */
export function isEdgeBlip(status: number, bodyText: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 404 && EDGE_404_BODY.test(bodyText);
}

/**
 * fetch() with up to 2 retries on transient failures.
 *
 *   - Retries: network errors ("Failed to fetch"), 502/503/504, and
 *     the edge's plain-text "404 page not found".
 *   - Never retries: AbortError (caller cancelled) or any real API
 *     response (including genuine 4xx JSON errors).
 *   - Returns the Response with its body UNCONSUMED (we peek error
 *     bodies via clone()), so callers stream/parse exactly as before.
 */
export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const res = await fetch(url, init);
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
      // Caller-initiated aborts must propagate immediately.
      if ((err as { name?: string }).name === 'AbortError') throw err;
      lastError = err;
    }
  }
  console.error('[fetch-retry] all attempts failed for', url, lastError);
  throw new Error('The server took a moment too long to respond. Please try again.');
}
