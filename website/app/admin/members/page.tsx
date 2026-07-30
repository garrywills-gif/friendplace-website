'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function MembersPage() {
  return (
    <ComingSoon
      slice={1}
      title="Members"
      description="The single place to find any FriendPlace member, review their full moderation history, and take action — always with identity confirmation. Every existing safeguard from the mobile admin tools is preserved and enhanced for desktop."
      parity={[
        'Search by name, email, handle or Member ID (filter: banned, suspended, demo, founding)',
        'Full member profile driven by GET /api/admin/users/{id}/moderation — user, reports, warnings, moderation_log, counts on one screen',
        'Unified reverse-chronological timeline: reports, warnings, suspensions, bans, restores, notes, auto-actions',
        'Every timeline entry shows the acting admin, reason, outcome and cross-links',
        'Add moderator notes (stored inside moderation_log as action: "note" — same timeline)',
        'Warn / Suspend / Ban / Restore / Delete / Clear restriction — all keyed on the unique Member ID',
        'Repeat-offender queue with one-click restriction clear',
      ]}
      improvements={[
        'Moderation Summary card above the timeline: Reports (total/open), Actions (warnings/suspensions/bans), Notes, Last action — one-glance headline before the detailed feed',
        'Identity confirmation dialog before every suspend/ban/delete — avatar, full name, Member ID, email, join date, active flags',
        'Hard-delete requires typing the Member ID (GitHub-style safe delete)',
        'Every action writes to both moderation_log (member timeline) AND admin_log (cross-cutting)',
        'Keyboard shortcuts on the profile: w warn · s suspend · b ban · r restore · n note',
        'Report ↔ Profile stays sticky in the URL: /admin/members/[id]?from=report:R-1234',
        'Timeline density toggle (Compact / Comfortable) — desktop can afford richer rows',
        'Ask George — five fairness-focused prompts: summarise history, compare prior reports, spot patterns, spot unusual activity, and "have we treated similar cases consistently?"',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#member-identity--moderation-safeguards--non-negotiable-contract"
    />
  );
}
