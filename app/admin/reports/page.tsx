'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function ReportsPage() {
  return (
    <ComingSoon
      slice={2}
      title="Reports & Moderation"
      description="A dedicated report inbox that unifies member reports with MCGS signals. Every resolved report auto-closes the linked signal, so nothing gets tracked twice."
      parity={[
        'Inbox with status tabs: new, reviewing, urgent, resolved',
        'Report detail with evidence, reporter, target — plus target content inline',
        'One-click actions: warn / suspend / ban / remove content',
        'Reporter reputation panel: their own moderation history',
        'Status updates persist and cascade to MCGS signals',
      ]}
      improvements={[
        'Reports and MCGS signals unified in a single triage view',
        'Ask George: summarise this report, compare targets previous reports, suggest an appropriate action',
        'Optimistic UI: newly-filed reports appear live via WebSocket',
        'Every resolution auto-writes an admin_log entry',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-2--reports--moderation"
    />
  );
}
