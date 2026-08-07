import { redirect } from 'next/navigation';

/**
 * /admin/crm — CRM landing surface.
 *
 * The CRM is currently just the Founding Members workflow (Phase 1
 * shipped, Phase 2B/2C email + segments live under their own routes).
 * A bare `/admin/crm` visit previously 404'd, which was a launch-
 * confidence blocker: George's route map mentions "CRM" and admins
 * can also type the URL directly.
 *
 * V1 fix: redirect to the only live CRM sub-page. When more CRM
 * sub-surfaces land (Contacts, Deals, Pipelines, etc.) this page
 * can become a real hub view. Until then, a redirect keeps the
 * navigation graph honest and eliminates the 404.
 *
 * Server component — the redirect is issued at request time so
 * middleware, prefetch, and search-engine indexing all follow the
 * canonical route.
 */
export default function CrmIndex(): never {
  redirect('/admin/crm/founding-members');
}
