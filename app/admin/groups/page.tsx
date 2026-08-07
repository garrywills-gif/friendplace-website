import { redirect } from 'next/navigation';

/**
 * /admin/groups — Community Groups landing.
 *
 * Currently the only shipped Groups sub-page is the moderation queue
 * for pending groups (`/admin/groups/pending`). A bare `/admin/groups`
 * visit previously fell through to Next.js NotFound, which surfaced
 * as a 404 in George's navigation (he says "Opening Groups now" and
 * lands Garry on a dead page).
 *
 * V1 fix: redirect to the live sub-page. When we ship a proper
 * Groups directory this becomes a real hub view; until then, the
 * redirect keeps the nav graph honest and eliminates the 404.
 * Mirrors the fix pattern used for /admin/crm/page.tsx.
 */
export default function GroupsIndex(): never {
  redirect('/admin/groups/pending');
}
