'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function MembersPage() {
  return (
    <ComingSoon
      slice={1}
      title="Members"
      description="The single place to find any FriendPlace member, review their profile, moderation history and notes, and take action — warn, suspend, ban, restore, delete, or clear a repeat-offender restriction."
      parity={[
        'Search by name, email, handle or user id (filter: banned, suspended, demo, founding)',
        'Full member profile: content history, reports filed against, reports filed by, warns / suspensions timeline',
        'Warn / Suspend / Ban / Restore with templated reasons',
        'Admin notes with author attribution',
        'Set / unset admin flag with audit-logged confirmation',
        'Repeat-offender queue with one-click restriction clear',
        'Hard delete for GDPR / right-to-erasure requests',
      ]}
      improvements={[
        'Every write action written to admin_log automatically',
        'Duration picker for suspensions (24h / 7d / 30d / custom) with auto-expiry',
        'Ask George about this member: explain flag reason, summarise prior reports, suggest an appropriate moderation action',
        'Last-active and last-login timestamps visible in every list row',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-1--member-management"
    />
  );
}
