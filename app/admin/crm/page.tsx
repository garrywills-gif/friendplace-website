import Link from 'next/link';

import AdminShell from '../../../components/admin/AdminShell';

const workspaces = [
  {
    href: '/admin/crm/founding-members',
    icon: '🌟',
    title: 'Founding Members',
    description:
      'The people who registered before launch. Manage status, notes, tags. Send invitations. Permanently delete registrations from Advanced/Admin.',
    action: 'Open →',
  },
  {
    href: '/admin/members',
    icon: '👤',
    title: 'Members',
    description:
      'Everyone with a FriendPlace account. Profiles, activity, moderation actions.',
    action: 'Open →',
  },
  {
    href: '/admin/enquiries',
    icon: '📥',
    title: 'Enquiries',
    description:
      'Interest registrations, contact-form messages, general questions — all in one triaged inbox.',
    action: 'Open →',
  },
  {
    href: '/admin/campaigns',
    icon: '📮',
    title: 'Campaigns',
    description:
      'Compose, preview and send emails to Founding Members and any saved Segment.',
    action: 'Open →',
  },
  {
    href: '/admin/segments',
    icon: '🦋',
    title: 'Segments',
    description:
      'Group people by shared traits — location, referral, companion choice — for targeted campaigns.',
    action: 'Open →',
  },
  {
    href: '/admin/support',
    icon: '💬',
    title: 'Support & Feedback',
    description:
      "One inbox for support tickets, contact-form submissions and feedback. George drafts suggested replies.",
    action: 'Preview →',
    soon: true,
  },
];

export default function CrmIndex() {
  return (
    <AdminShell title="CRM Navigator">
      <div style={{ maxWidth: 1120 }}>
        <p
          style={{
            margin: '0 0 24px',
            color: '#64748b',
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Everything you need to understand and reach the people who make
          FriendPlace. Pick a workspace to dive into — each one opens in the
          same tab so you can come back to this hub via the sidebar.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {workspaces.map((workspace) => (
            <Link
              key={workspace.href}
              href={workspace.href}
              style={{
                display: 'flex',
                minHeight: 180,
                flexDirection: 'column',
                padding: 22,
                border: '1px solid #e2e8f0',
                borderRadius: 16,
                background: '#fff',
                color: 'inherit',
                textDecoration: 'none',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 22 }}>{workspace.icon}</span>

                <strong
                  style={{
                    color: '#0f172a',
                    fontSize: 17,
                  }}
                >
                  {workspace.title}
                </strong>

                {workspace.soon ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: '#fef3c7',
                      color: '#92400e',
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Soon
                  </span>
                ) : null}
              </div>

              <p
                style={{
                  margin: 0,
                  color: '#64748b',
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {workspace.description}
              </p>

              <span
                style={{
                  marginTop: 'auto',
                  paddingTop: 18,
                  color: '#0f8f7a',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {workspace.action}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}