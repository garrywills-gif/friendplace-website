'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { mcgsApi, type Case, type Signal, type SignalStatus } from '@/lib/mcgs-api';
import { inboxApi, type InboxMessage } from '@/lib/inbox-api';

type DetailedCase = Case & { signals: Signal[] };
const TICKET_REF = /\bFP-[A-Z0-9]{4,12}\b/gi;

function ticketRefs(value: string): string[] {
  return [...new Set((value.match(TICKET_REF) || []).map(x => x.toUpperCase()))];
}

function ticketReference(c: DetailedCase): string | null {
  // Only use explicit identifiers, never approximate matching by member name or subject.
  const candidates = [
    c.case_key, c.subject,
    ...(c.signals || []).flatMap(s => [s.subject, s.body, s.entity_ref?.id || '']),
  ];
  const fromKey = ticketRefs(c.case_key);
  if (fromKey.length === 1) return fromKey[0];
  const refs = [...new Set(candidates.flatMap(ticketRefs))];
  return refs.length === 1 ? refs[0] : null;
}


// Sender details must come from the support-ticket record itself,
// never from fuzzy searches, message text, or a similar name.
// Neo can populate a "sender" / "reporter" object on the case or signal.
type SenderDetails = {
  name?: string; email?: string; memberNumber?: string;
  userId?: string; verified?: boolean;
};
function senderDetails(record: DetailedCase): SenderDetails | null {
  const sources: any[] = [record, ...(record.signals || [])];
  for (const source of sources) {
    const sender = source?.sender || source?.reporter || source?.submitter || source?.ticket?.sender ||
      source?.ticket?.reporter || source?.metadata?.sender || source?.metadata?.reporter;
    if (!sender || typeof sender !== 'object') continue;
    const name = [sender.display_name || sender.name, sender.first_name].find(
      v => typeof v === 'string' && v.trim()
    ) || ([sender.first_name, sender.last_name].filter(Boolean).join(' ').trim());
    const email = typeof sender.email === 'string' ? sender.email : undefined;
    const memberNumber = sender.membership_number_display || sender.member_number_display ||
      sender.founder_number_display || (typeof sender.founder_number === 'number' ?
        '#' + String(sender.founder_number).padStart(4, '0') : undefined);
    const userId = typeof (sender.user_id || sender.id) === 'string' ?
      (sender.user_id || sender.id) : undefined;
    if (name || email || memberNumber || userId) {
      return { name: name || undefined, email, memberNumber,
        userId, verified: sender.email_verified === true || sender.identity_verified === true };
    }
  }
  return null;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

const panel: React.CSSProperties = {
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14,
  padding: 20, marginBottom: 16,
};
const button: React.CSSProperties = {
  display: 'inline-flex', padding: '10px 16px', borderRadius: 9, border: 0,
  color: '#fff', background: '#0F766E', fontWeight: 750, cursor: 'pointer',
  textDecoration: 'none', fontSize: 14,
};

export default function SupportTicketPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [caseData, setCaseData] = useState<DetailedCase | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [mailError, setMailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const c = await mcgsApi.getCase(id);
      if (!c.case_key.startsWith('support_ticket:')) throw new Error('This case is not a support ticket.');
      setCaseData(c);
      // Inbox messages and Bridge cases are separate services. Email matching is
      // deliberately exact and requires a unique ticket reference.
      try {
        const [current, archived] = await Promise.all([
          inboxApi.list({ archived: false, limit: 300 }),
          inboxApi.list({ archived: true, limit: 300 }),
        ]);
        setMessages([...current.rows, ...archived.rows]);
        setMailError(null);
      } catch {
        setMessages([]);
        setMailError('The email inbox could not be loaded. Ticket details are still available.');
      }
    } catch (e) {
      setError((e as Error).message || 'Unable to load this ticket.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  const ref = useMemo(() => caseData ? ticketReference(caseData) : null, [caseData]);
  const sender = useMemo(() => caseData ? senderDetails(caseData) : null, [caseData]);
  const matchingEmails = useMemo(() => {
    if (!ref) return [];
    return messages.filter(m => ticketRefs(m.subject || '').includes(ref));
  }, [messages, ref]);
  // Avoid automatically selecting a recipient if more than one incoming email
  // matches. The operator must choose the right notification in the Inbox.
  const email = matchingEmails.length === 1 ? matchingEmails[0] : null;
  const replyable = email?.direction === 'inbound' && !!email.from_email &&
    !/^(?:no.?reply|noreply)@/i.test(email.from_email);

  async function sendReply() {
    if (!email || !replyable || !reply.trim() || sending) return;
    setSending(true);
    setNotice(null);
    try {
      await inboxApi.reply(email.id, { body_text: reply.trim(), from_mailbox: 'support@friendplace.com.au' });
      setReply('');
      setNotice('Reply sent successfully from support@friendplace.com.au.');
    } catch (e) {
      setNotice('Reply not sent: ' + ((e as Error).message || 'Please try again.'));
    } finally {
      setSending(false);
    }
  }

  async function setStatus(to: SignalStatus) {
    if (!caseData || updating) return;
    setUpdating(true);
    setNotice(null);
    try {
      const changed = await mcgsApi.transitionCase(caseData.id, to,
        to === 'RESOLVED' ? { resolved_action: 'Handled in support ticket view' } : {});
      setCaseData(prev => prev ? { ...prev, ...changed } : prev);
      setNotice('Ticket status updated.');
    } catch (e) {
      setNotice('Status not changed: ' + ((e as Error).message || 'Please try again.'));
    } finally { setUpdating(false); }
  }

  return (
    <AdminShell title="Support ticket">
      <div style={{ maxWidth: 980 }}>
        <Link href="/admin/bridge" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
          ← Back to the Bridge
        </Link>
        {loading && <p style={{ marginTop: 20 }}>Loading ticket…</p>}
        {error && <div role="alert" style={{ ...panel, marginTop: 16, color: '#991B1B' }}>{error}</div>}
        {caseData && !loading && (
          <>
            <header style={{ margin: '22px 0' }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 700, letterSpacing: 1 }}>
                SUPPORT TICKET {ref ? '· ' + ref : ''}
              </div>
              <h2 style={{ fontSize: 26, color: '#0A2540', margin: '8px 0' }}>{caseData.subject}</h2>
              <div style={{ color: '#64748B', fontSize: 13 }}>
                {caseData.priority} · {caseData.status.replaceAll('_', ' ')} · Received {formatDate(caseData.first_signal_at)}
              </div>
            </header>

            <section style={panel}>
              <h3 style={{ marginTop: 0, color: '#0A2540' }}>Who sent this ticket?</h3>
              {sender ? (
                <div style={{ lineHeight: 1.9, fontSize: 14 }}>
                  <div><strong>Name:</strong> {sender.name || 'Not supplied'}</div>
                  <div><strong>Email:</strong> {sender.email || 'Not supplied'}</div>
                  <div><strong>Member number:</strong> {sender.memberNumber || 'Not supplied'}</div>
                  <div><strong>Account verification:</strong> {sender.verified ? 'Verified' : 'Not confirmed by ticket record'}</div>
                  {sender.userId && <div><strong>Account ID:</strong> {sender.userId}</div>}
                </div>
              ) : (
                <p role="status" style={{ color: '#92400E', marginBottom: 0 }}>
                  Sender details are not included in the Bridge response yet.
                  Do not assume the identity from the subject or message.
                  Neo needs to attach the verified support-ticket sender record.
                </p>
              )}
            </section>

            <section style={panel}>
              <h3 style={{ marginTop: 0, color: '#0A2540' }}>Member's message and ticket history</h3>
              {(caseData.signals || []).length === 0 &&
                <p>No linked messages are included with this case.</p>}
              {(caseData.signals || []).map(s => (
                <article key={s.id} style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14, marginTop: 14 }}>
                  <div style={{ fontWeight: 750, color: '#0A2540' }}>{s.subject}</div>
                  <div style={{ fontSize: 12, color: '#64748B', margin: '6px 0 12px' }}>
                    {formatDate(s.created_at)} · {s.source}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, marginBottom: 0 }}>
                    {s.body || 'No message text available.'}
                  </p>
                </article>
              ))}
            </section>

            {caseData.george_read && <section style={{ ...panel, background: '#F0FDFA' }}>
              <h3 style={{ marginTop: 0, color: '#0F766E' }}>🦋 George's read</h3>
              <p>{caseData.george_read.tldr}</p>
              {caseData.george_read.suggested_action && <p style={{ fontStyle: 'italic' }}>
                Suggested: {caseData.george_read.suggested_action}
              </p>}
            </section>}

            <section style={panel}>
              <h3 style={{ marginTop: 0, color: '#0A2540' }}>Support email & reply</h3>
              {mailError && <p role="status" style={{ color: '#92400E' }}>{mailError}</p>}
              {!ref && <p>This ticket has no unique email reference. Open the Inbox to locate its notification manually.</p>}
              {ref && matchingEmails.length === 0 && <p>No support email with reference {ref} was found in the latest Inbox records. The ticket itself is still shown above.</p>}
              {matchingEmails.length > 1 && <p>More than one email uses reference {ref}. Open the Inbox to choose the correct conversation before replying.</p>}
              {email && (
                <>
                  <p style={{ fontSize: 13, color: '#475569' }}>
                    <strong>From:</strong> {email.from_name || email.from_email} ({email.from_email})
                  </p>
                  <p style={{ fontSize: 13, color: '#475569' }}>
                    <strong>Subject:</strong> {email.subject}
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>
                    {email.text || email.snippet || 'The email is available in the Inbox.'}
                  </p>
                  {replyable && (
                    <>
                      <label htmlFor="ticket-reply" style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>
                        Reply from support@friendplace.com.au
                      </label>
                      <textarea id="ticket-reply" value={reply} onChange={e => setReply(e.target.value)}
                        rows={5} style={{ width: '100%', padding: 12, border: '1px solid #CBD5E1', borderRadius: 8, boxSizing: 'border-box', font: 'inherit' }} />
                      <button type="button" disabled={sending || !reply.trim()} onClick={sendReply}
                        style={{ ...button, marginTop: 10, opacity: sending || !reply.trim() ? 0.5 : 1 }}>
                        {sending ? 'Sending…' : 'Send reply'}
                      </button>
                    </>
                  )}
                </>
              )}
              <p style={{ marginBottom: 0, marginTop: 16 }}>
                <Link href="/admin/inbox" style={{ color: '#0F766E', fontWeight: 700 }}>Open full Inbox →</Link>
              </p>
            </section>

            <section style={panel}>
              <h3 style={{ marginTop: 0, color: '#0A2540' }}>Manage ticket</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['NEW', 'SEEN', 'OPEN'].includes(caseData.status) &&
                  <button style={button} disabled={updating} onClick={() => void setStatus('IN_REVIEW')}>Mark reviewing</button>}
                {!['RESOLVED', 'DISMISSED'].includes(caseData.status) &&
                  <button style={button} disabled={updating} onClick={() => void setStatus('RESOLVED')}>Resolve</button>}
                {['RESOLVED', 'DISMISSED'].includes(caseData.status) &&
                  <p>This ticket is {caseData.status.toLowerCase()}.</p>}
              </div>
              {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
