'use client';

import { ComingSoon } from '@/components/admin/ComingSoon';

export default function SupportPage() {
  return (
    <ComingSoon
      slice={3}
      title="Support & Feedback"
      description="One inbox for support tickets, contact-form submissions and interest registrations. George can draft replies you review, edit and send in one keystroke."
      parity={[
        'Support ticket inbox with status filters and assignee hint',
        'Resolve ticket with reason (auto-closes linked MCGS signal)',
        'Contact-form submissions with the same triage workflow',
        'Interest registrations list with status update',
      ]}
      improvements={[
        'Contact-form submissions can be converted to tickets in one click',
        'George drafts a suggested reply for every open ticket — you approve or edit',
        'SLA hints on each row (age, priority)',
        'Ask George: summarise this ticket, look up sender history, draft a reply in my voice',
      ]}
      audit="/app/memory/MCGS_MIGRATION_AUDIT.md#domain-3--feedback--support"
    />
  );
}
