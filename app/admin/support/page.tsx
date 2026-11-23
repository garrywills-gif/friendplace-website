import { redirect } from 'next/navigation';

/**
 * The Support & Feedback migration is not live yet.
 * Avoid leaving admins on a Coming Soon screen when they open a
 * support-ticket signal from the Bridge. The existing Inbox contains
 * the support notification emails and supports replying to members.
 *
 * Once the dedicated support-ticket screen ships, replace this
 * compatibility redirect with the completed screen.
 */
export default function SupportPage() {
  redirect('/admin/inbox');
}
