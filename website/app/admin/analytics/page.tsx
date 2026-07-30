'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function AnalyticsPage() {
  return (
    <ComingSoon
      slice={10}
      title="Analytics"
      description="Growth, engagement and community health at a glance — the numbers that matter, not the noise."
      parity={[
        'Growth: signups per day / week / month',
        'Engagement: DAU / WAU / MAU + retention curves',
        'Summary tiles: total members, active groups, events this week',
      ]}
      improvements={[
        'Charts with hover annotations (what happened here?)',
        "Ask George: what's driving this week's growth? What group had the highest engagement?",
        'Every viewed dashboard writes a light-touch admin_log entry for internal usage patterns',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-9--analytics--settings"
    />
  );
}
