'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function AnnouncementsPage() {
  return (
    <ComingSoon
      slice={6}
      title="Announcements"
      description="Compose, schedule and manage community notices from Mission Control. Choose your audience (all members / founding / a specific group) and let George suggest the copy."
      parity={[
        'List existing announcements with reach + engagement',
        'Delete announcement',
      ]}
      improvements={[
        'Compose UI with rich text and inline media picker',
        'Audience selector: all / founding / group-specific',
        'Schedule for a future date/time — draft, schedule, publish',
        'Ask George: draft an announcement for X, review my tone, translate to plain English',
        'Every action auto-logged to admin_log',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-6--announcements--notices"
    />
  );
}
