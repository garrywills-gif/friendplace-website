'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function AdminsPage() {
  return (
    <ComingSoon
      slice={8}
      title="Admins & permissions"
      description="Manage everyone who has Mission Control access. See who signed in when, what they've been doing, and grant or revoke access with full audit trail."
      parity={[
        'List all admins with last-login timestamp',
        'Add admin (invite by email)',
        'Remove admin',
        "Reset another admin's password",
      ]}
      improvements={[
        'Per-admin activity view: last N actions from admin_log',
        'Merges mobile-app promote screen — one place for all admin management',
        'Ask George: who has been active this week? Whose access should be reviewed?',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-8--administration--identity"
    />
  );
}
