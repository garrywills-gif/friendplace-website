import { notFound } from 'next/navigation';

/**
 * Catch-all fallback for any /admin/* URL that isn't handled by a
 * dedicated page. Simply defers to the segment-level not-found.tsx
 * so the visitor sees Mission Control's own 404 (inside AdminShell)
 * instead of the site-wide 404 wrapped in the public marketing shell.
 *
 * Concretely, this fixes the /admin/support link the Bridge shows on
 * support_ticket:* signals — the target page hasn't been built yet
 * and previously fell through to app/not-found.tsx.
 */
export default function AdminCatchAllPage() {
  notFound();
}
