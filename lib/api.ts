/**
 * API client for the website.
 *
 * The website talks to the SAME FastAPI backend the mobile app does,
 * hitting the `/api/public/*` endpoints already built. When Mission
 * Control (admin portal) lands, those endpoints will read from
 * MongoDB CMS collections — which means editing content in the
 * admin UI will instantly update the website with no code deploy.
 *
 * All fetches are SERVER-SIDE (in Next.js Server Components) so the
 * user's browser never sees the backend URL, response is fully SEO-
 * indexable, and page loads are as fast as static HTML.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

/** Fetch with a soft cache: revalidate every 60 s in production so
 *  admin edits show up within a minute without hammering the API. */
async function req<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      ...init,
      // ISR-style caching. `revalidate: 60` → hot cache for 60s, then
      // Next.js re-fetches in the background on the next request.
      next: { revalidate: 60 },
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Never crash the page on API failure — fall back to defaults.
    return null;
  }
}

export type FAQ = { q: string; a: string };
export type FeatureCard = { icon: string; title: string; body: string };
export type FoundingMember = { name: string; number: number; avatar?: string; blurb?: string };
export type SuccessStory = { name: string; title: string; body: string; avatar?: string };

export const cms = {
  about: () => req<{ heading: string; body: string; mission: string }>('/public/about'),
  features: () => req<{ features: FeatureCard[] }>('/public/features'),
  faqs: () => req<{ faqs: FAQ[] }>('/public/faqs'),
  founders: () => req<{ members: FoundingMember[]; count: number; cap: number }>('/public/founders'),
  stories: () => req<{ stories: SuccessStory[] }>('/public/stories'),
};

/** POST the contact form to the backend. Public endpoint — no auth. */
export async function submitContact(payload: {
  name: string;
  email: string;
  message: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/public/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: txt || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}
