'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function SettingsPage() {
  return (
    <ComingSoon
      slice={9}
      title="Settings"
      description="Tune the moderation policy, the MCGS rhythms schedule (morning briefing / midday pulse / end-of-day), and other Mission Control preferences."
      parity={[
        'Moderation policy: flag threshold, restrict threshold, window days, auto-ban toggle',
        'Rhythms scheduler: on/off, hour, timezone, quiet-hours',
      ]}
      improvements={[
        'Preview any policy change before saving',
        'Every setting change auto-logged to admin_log with before/after values',
        "Ask George: what would tightening the flag threshold change? What did other admins pick last month?",
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-9--analytics--settings"
    />
  );
}
