'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function PendingGroupsPage() {
  return (
    <ComingSoon
      slice={5}
      title="Pending groups"
      description="Approve or reject the community groups members propose. Signals from the queue land in The Bridge automatically."
      parity={[
        'Pending queue with creator profile and member count',
        'Approve → auto-seat creator as owner, generate welcome post',
        'Reject with a reason emailed to the creator',
      ]}
      improvements={[
        'Similar-groups hint: surface existing groups with overlapping topic to avoid duplicates',
        'Ask George: is this group safe? What community would it serve? Should we suggest merging with an existing group?',
        'Auto-log every approve / reject action to admin_log',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-5--groups"
    />
  );
}
