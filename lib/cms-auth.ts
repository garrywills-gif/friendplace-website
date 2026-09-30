/**
 * Client-side auth helper for the FriendPlace Mini-CMS.
 *
 * We store the admin JWT in sessionStorage (`fp_cms_token`) so MCGS
 * stays signed in while the tab is open but signs out when that browser
 * tab/window is closed. The website and API sit on different origins
 * (Vercel vs FastAPI), and cross-origin cookies bring more pain than
 * they solve for a low-risk internal tool. All admin fetches send the
 * token via `Authorization: Bearer …`.
 *
 * If we ever move the admin surface behind admin.friendplace.com.au
 * with the API on api.friendplace.com.au (same eTLD+1) we can switch
 * to httpOnly cookies without touching any callers — just flip the
 * two helpers below.
 */

const TOKEN_KEY = 'fp_cms_token';
const ADMIN_KEY = 'fp_cms_admin';

export type CmsAdmin = { id: string; email: string; display_name?: string };

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Old builds used localStorage, which survived closing the browser.
    // Do not migrate it: clear it so the new close-to-logout behaviour
    // takes effect immediately after deployment.
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ADMIN_KEY);
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch { return null; }
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    // Remove any legacy persistent login so closing MCGS really signs out.
    window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked */ }
}

export function getAdmin(): CmsAdmin | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_KEY);
    return raw ? (JSON.parse(raw) as CmsAdmin) : null;
  } catch { return null; }
}

export function setAdmin(admin: CmsAdmin) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    window.localStorage.removeItem(ADMIN_KEY);
  } catch { /* storage blocked */ }
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(ADMIN_KEY);
    // Also clear any legacy persistent auth left by older MCGS builds.
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ADMIN_KEY);
  } catch { /* storage blocked */ }
  // Batch-3 conversation continuity: logout must clear George's
  // per-admin conversation buckets so the next login starts clean.
  try {
    // Dynamic import so this module stays framework-agnostic.
    const { clearAllGeorgeSessions } = require('./george-session');
    clearAllGeorgeSessions();
  } catch { /* module missing during SSR — harmless */ }
}

export function isAuthed(): boolean {
  return !!getToken();
}
