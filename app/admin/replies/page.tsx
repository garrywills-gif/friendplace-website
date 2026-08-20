'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  repliesApi,
  type InboundReply,
  type ReplyChannel,
} from '@/lib/cms-api';

type TabKey = 'all' | 'unread' | 'awaiting';

export default function AdminRepliesPage() {
  const [rows, setRows] = useState<InboundReply[]>([]);
  const [selected, setSelected] = useState<InboundReply | null>(null);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [awaitingCount, setAwaitingCount] = useState(0);
  const [showLogModal, setShowLogModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await repliesApi.list({
        read: tab === 'unread' ? false : undefined,
        resolved: tab === 'awaiting' ? false : undefined,
        q: search.trim() || undefined,
        limit: 300,
      });

      setRows(result.replies || []);
      setUnreadCount(result.unread_count || 0);
      setAwaitingCount(result.awaiting_count || 0);

      if (
        selected &&
        !(result.replies || []).some((reply) => reply.id === selected.id)
      ) {
        setSelected(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load replies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, search ? 250 : 0);

    return () => clearTimeout(timer);
  }, [tab, search]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const email = params.get('email');
    if (email) {
      setShowLogModal(true);
    }
  }, []);

  const tabs = [
    { key: 'all' as const, label: 'All', count: rows.length },
    { key: 'unread' as const, label: 'Unread', count: unreadCount },
    { key: 'awaiting' as const, label: 'Awaiting reply', count: awaitingCount },
  ];

  return (
    <AdminShell title="Replies">
      <div style={topBar}>
        <div>
          <p style={intro}>
            Incoming and manually logged replies from people and organisations
            FriendPlace has contacted.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowLogModal(true)}
          style={adminStyles.primaryBtn}
        >
          + Log a reply
        </button>
      </div>

      <div style={tabsRow}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            style={{
              ...tabButton,
              ...(tab === item.key ? tabButtonActive : {}),
            }}
          >
            {item.label}
            <span
              style={{
                ...countPill,
                ...(tab === item.key ? countPillActive : {}),
              }}
            >
              {item.count}
            </span>
          </button>
        ))}
      </div>

      <div style={searchRow}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, subject or reply…"
          style={{ ...adminStyles.input, maxWidth: 520 }}
        />
      </div>

      {error && <div style={errorBox}>{error}</div>}

      <div style={layout}>
        <div style={listCard}>
          {loading ? (
            <p style={muted}>Loading replies…</p>
          ) : rows.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 30 }}>📭</div>
              <strong>No replies here yet</strong>
              <span style={muted}>
                Replies and manually logged responses will appear here.
              </span>
            </div>
          ) : (
            rows.map((reply) => (
              <ReplyRow
                key={reply.id}
                reply={reply}
                active={selected?.id === reply.id}
                onOpen={async () => {
                  setSelected(reply);

                  if (!reply.read) {
                    try {
                      const updated = await repliesApi.markRead(reply.id, true);
                      setSelected(updated);
                      setRows((current) =>
                        current.map((item) =>
                          item.id === updated.id ? updated : item,
                        ),
                      );
                      setUnreadCount((n) => Math.max(0, n - 1));
                    } catch {
                      // Leave the reply open even if read-state update fails.
                    }
                  }
                }}
              />
            ))
          )}
        </div>

        <div style={detailCard}>
          {selected ? (
            <ReplyDetail
              reply={selected}
              onChanged={(updated) => {
                setSelected(updated);
                setRows((current) =>
                  current.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                );
                void load();
              }}
              onDeleted={() => {
                setSelected(null);
                void load();
              }}
            />
          ) : (
            <div style={emptyDetail}>
              <div style={{ fontSize: 30 }}>💬</div>
              <strong>Select a reply</strong>
              <span style={muted}>
                Choose a reply on the left to see the full message and actions.
              </span>
            </div>
          )}
        </div>
      </div>

      {showLogModal && (
        <LogReplyModal
          onClose={() => setShowLogModal(false)}
          onCreated={(reply) => {
            setShowLogModal(false);
            setSelected(reply);
            void load();
          }}
        />
      )}
    </AdminShell>
  );
}

function ReplyRow({
  reply,
  active,
  onOpen,
}: {
  reply: InboundReply;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        ...replyRow,
        ...(active ? replyRowActive : {}),
      }}
    >
      <div style={replyRowTop}>
        <div style={{ minWidth: 0 }}>
          <div style={nameLine}>
            {!reply.read && <span style={unreadDot} />}
            <strong>{reply.from_name || reply.from_email || 'Unknown'}</strong>
          </div>

          <div style={emailLine}>{reply.from_email}</div>
        </div>

        <span style={dateText}>{formatDate(reply.received_at)}</span>
      </div>

      <div style={subjectLine}>
        {reply.subject || '(No subject)'}
      </div>

      <div style={previewText}>
        {reply.body || 'No message body recorded.'}
      </div>

      <div style={rowFooter}>
        <span style={channelPill}>{channelLabel(reply.channel)}</span>

        {reply.resolved ? (
          <span style={resolvedPill}>Resolved</span>
        ) : (
          <span style={awaitingPill}>Awaiting our reply</span>
        )}
      </div>
    </button>
  );
}

function ReplyDetail({
  reply,
  onChanged,
  onDeleted,
}: {
  reply: InboundReply;
  onChanged: (reply: InboundReply) => void;
  onDeleted: () => void;
}) {
  const [working, setWorking] = useState(false);

  const replyHref = useMemo(() => {
    const params = new URLSearchParams();

    params.set('email', reply.from_email || '');
    params.set('name', reply.from_name || '');
    params.set(
      'subject',
      reply.subject ? `Re: ${reply.subject}` : '',
    );
    params.set('template_id', 'enquiry_reply');
    params.set('in_reply_to', reply.id);

    return `/admin/marketing/send?${params.toString()}`;
  }, [reply]);

  const toggleResolved = async () => {
    setWorking(true);

    try {
      const updated = await repliesApi.markResolved(
        reply.id,
        !reply.resolved,
      );
      onChanged(updated);
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    const ok = window.confirm(
      'Delete this reply record? This cannot be undone.',
    );

    if (!ok) return;

    setWorking(true);

    try {
      await repliesApi.del(reply.id);
      onDeleted();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <div style={detailHeader}>
        <div>
          <h2 style={detailTitle}>
            {reply.subject || '(No subject)'}
          </h2>

          <div style={detailMeta}>
            From{' '}
            <strong>
              {reply.from_name || reply.from_email || 'Unknown'}
            </strong>
            {reply.from_name && reply.from_email
              ? ` <${reply.from_email}>`
              : ''}
          </div>

          <div style={detailMeta}>
            Received {formatDate(reply.received_at)}
          </div>
        </div>

        <span style={channelPill}>
          {channelLabel(reply.channel)}
        </span>
      </div>

      <div style={messageBox}>
        {reply.body || 'No message body recorded.'}
      </div>

      {reply.notes && (
        <div style={notesBox}>
          <strong>Notes</strong>
          <div style={{ marginTop: 6 }}>{reply.notes}</div>
        </div>
      )}

      {(reply.campaign_name || reply.campaign_id) && (
        <div style={infoBox}>
          <strong>Campaign:</strong>{' '}
          {reply.campaign_name || reply.campaign_id}
        </div>
      )}

      <div style={detailActions}>
        <Link
          href={replyHref}
          style={{
            ...adminStyles.primaryBtn,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          Reply
        </Link>

        <button
          type="button"
          onClick={() => void toggleResolved()}
          disabled={working}
          style={adminStyles.ghostBtn}
        >
          {reply.resolved ? 'Reopen' : 'Mark resolved'}
        </button>

        <button
          type="button"
          onClick={() => void remove()}
          disabled={working}
          style={adminStyles.dangerBtn}
        >
          Delete
        </button>
      </div>

      <div style={statusBox}>
        <MetaRow
          label="Status"
          value={reply.resolved ? 'Resolved' : 'Awaiting our reply'}
        />
        <MetaRow
          label="Read"
          value={reply.read ? 'Yes' : 'No'}
        />
        <MetaRow
          label="Logged"
          value={formatDate(reply.created_at)}
        />
      </div>
    </div>
  );
}

function LogReplyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (reply: InboundReply) => void;
}) {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const [email, setEmail] = useState(params.get('email') || '');
  const [name, setName] = useState(params.get('name') || '');
  const [subject, setSubject] = useState(params.get('subject') || '');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<ReplyChannel>('email');
  const [notes, setNotes] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!email.trim()) {
      setError('Email address is required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await repliesApi.create({
        from_email: email.trim(),
        from_name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
        channel,
        notes: notes.trim(),
        received_at: receivedAt
          ? new Date(receivedAt).toISOString()
          : undefined,
      });

      onCreated(created);
    } catch (e: any) {
      setError(e?.message || 'Could not log reply.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop}>
      <div style={modalCard}>
        <div style={modalHeader}>
          <div>
            <h2 style={modalTitle}>Log a reply</h2>
            <p style={modalIntro}>
              Record a reply received by email, phone, SMS or in person.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={closeButton}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={formGrid}>
          <Field label="Email *">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={adminStyles.input}
            />
          </Field>

          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={adminStyles.input}
            />
          </Field>

          <Field label="Channel">
            <select
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value as ReplyChannel)
              }
              style={adminStyles.input}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="in_person">In person</option>
              <option value="sms">SMS</option>
              <option value="other">Other</option>
            </select>
          </Field>

          <Field label="Received">
            <input
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              style={adminStyles.input}
            />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={adminStyles.input}
            />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={adminStyles.label}>Reply</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ ...adminStyles.textarea, minHeight: 140 }}
            placeholder="What did they say?"
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={adminStyles.label}>Internal notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...adminStyles.textarea, minHeight: 80 }}
            placeholder="Optional notes for FriendPlace admins."
          />
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={modalActions}>
          <button
            type="button"
            onClick={onClose}
            style={adminStyles.ghostBtn}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            style={{
              ...adminStyles.primaryBtn,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Log reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={adminStyles.label}>{label}</label>
      {children}
    </div>
  );
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={metaRow}>
      <span style={muted}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '—';

  try {
    return new Date(value).toLocaleString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function channelLabel(channel: ReplyChannel) {
  const labels: Record<ReplyChannel, string> = {
    email: 'Email',
    phone: 'Phone',
    in_person: 'In person',
    sms: 'SMS',
    other: 'Other',
  };

  return labels[channel] || channel;
}

const intro: React.CSSProperties = {
  margin: 0,
  color: '#64748B',
  fontSize: 13,
  lineHeight: 1.55,
};

const topBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 18,
};

const tabsRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 14,
};

const tabButton: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#475569',
  padding: '7px 11px',
  borderRadius: 999,
  fontWeight: 800,
  fontSize: 12,
  cursor: 'pointer',
};

const tabButtonActive: React.CSSProperties = {
  borderColor: '#14B8A6',
  background: '#F0FDFA',
  color: '#0F766E',
};

const countPill: React.CSSProperties = {
  marginLeft: 7,
  padding: '1px 6px',
  borderRadius: 999,
  background: '#E2E8F0',
  fontSize: 10,
};

const countPillActive: React.CSSProperties = {
  background: '#14B8A6',
  color: '#FFFFFF',
};

const searchRow: React.CSSProperties = {
  marginBottom: 16,
};

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.8fr) minmax(420px, 1.2fr)',
  gap: 16,
  alignItems: 'start',
};

const listCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  overflow: 'hidden',
};

const detailCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  padding: 20,
  minHeight: 360,
};

const replyRow: React.CSSProperties = {
  width: '100%',
  display: 'block',
  textAlign: 'left',
  background: '#FFFFFF',
  border: 'none',
  borderBottom: '1px solid #E2E8F0',
  padding: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const replyRowActive: React.CSSProperties = {
  background: '#F0FDFA',
};

const replyRowTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
};

const nameLine: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  color: '#0A2540',
  fontSize: 13,
};

const unreadDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#14B8A6',
  flex: '0 0 auto',
};

const emailLine: React.CSSProperties = {
  color: '#94A3B8',
  fontSize: 11,
  marginTop: 3,
};

const dateText: React.CSSProperties = {
  color: '#94A3B8',
  fontSize: 10,
  whiteSpace: 'nowrap',
};

const subjectLine: React.CSSProperties = {
  marginTop: 8,
  color: '#334155',
  fontSize: 12,
  fontWeight: 800,
};

const previewText: React.CSSProperties = {
  marginTop: 5,
  color: '#64748B',
  fontSize: 12,
  lineHeight: 1.45,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

const rowFooter: React.CSSProperties = {
  display: 'flex',
  gap: 7,
  flexWrap: 'wrap',
  marginTop: 9,
};

const channelPill: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 999,
  background: '#F1F5F9',
  color: '#475569',
  fontSize: 10,
  fontWeight: 800,
};

const awaitingPill: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 999,
  background: '#FEF3C7',
  color: '#92400E',
  fontSize: 10,
  fontWeight: 800,
};

const resolvedPill: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 999,
  background: '#DCFCE7',
  color: '#166534',
  fontSize: 10,
  fontWeight: 800,
};

const emptyState: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  alignItems: 'center',
  textAlign: 'center',
  padding: 38,
  color: '#475569',
};

const emptyDetail: React.CSSProperties = {
  display: 'flex',
  minHeight: 300,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textAlign: 'center',
  color: '#475569',
};

const detailHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 14,
};

const detailTitle: React.CSSProperties = {
  margin: 0,
  color: '#0A2540',
  fontSize: 18,
};

const detailMeta: React.CSSProperties = {
  marginTop: 5,
  color: '#64748B',
  fontSize: 12,
};

const messageBox: React.CSSProperties = {
  marginTop: 20,
  borderTop: '1px solid #E2E8F0',
  paddingTop: 18,
  whiteSpace: 'pre-wrap',
  color: '#334155',
  fontSize: 13,
  lineHeight: 1.65,
};

const notesBox: React.CSSProperties = {
  marginTop: 18,
  padding: 12,
  borderRadius: 10,
  background: '#F8FAFC',
  color: '#475569',
  fontSize: 12,
};

const infoBox: React.CSSProperties = {
  marginTop: 14,
  padding: 10,
  borderRadius: 10,
  background: '#F0FDFA',
  color: '#0F766E',
  fontSize: 12,
};

const detailActions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 20,
};

const statusBox: React.CSSProperties = {
  marginTop: 20,
  paddingTop: 14,
  borderTop: '1px solid #E2E8F0',
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 0',
  color: '#334155',
  fontSize: 12,
};

const muted: React.CSSProperties = {
  color: '#94A3B8',
  fontSize: 12,
};

const errorBox: React.CSSProperties = {
  marginBottom: 14,
  padding: 12,
  borderRadius: 10,
  background: '#FEF2F2',
  color: '#B91C1C',
  fontSize: 13,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  zIndex: 1000,
};

const modalCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#FFFFFF',
  borderRadius: 16,
  padding: 22,
  boxShadow: '0 24px 70px rgba(15, 23, 42, 0.25)',
};

const modalHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
  marginBottom: 18,
};

const modalTitle: React.CSSProperties = {
  margin: 0,
  color: '#0A2540',
  fontSize: 19,
};

const modalIntro: React.CSSProperties = {
  margin: '5px 0 0',
  color: '#64748B',
  fontSize: 12,
};

const closeButton: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 28,
  lineHeight: 1,
  cursor: 'pointer',
  color: '#64748B',
};

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
};

const modalActions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
  flexWrap: 'wrap',
};
