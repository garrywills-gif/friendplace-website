'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { inboxApi, type Mailbox } from '@/lib/inbox-api';
import { renderEnquiryEmail } from '@/lib/enquiry-email';
import { markEnquiryHandled, setEnquiryStatus } from '@/lib/enquiry-handled';

type CtaChoice = 'none' | 'visit' | 'register' | 'get_app' | 'custom';

const CTA_OPTIONS: Array<{ value: CtaChoice; label: string; help: string }> = [
  { value: 'none', label: 'No button', help: 'Send the reply without a call-to-action button.' },
  { value: 'visit', label: 'Visit FriendPlace', help: 'Links to friendplace.com.au.' },
  { value: 'register', label: 'Register your interest', help: 'Links to the FriendPlace registration page.' },
  { value: 'get_app', label: 'Get the app', help: 'Links to the FriendPlace app/download section.' },
  { value: 'custom', label: 'Custom button', help: 'Choose your own button label and web address.' },
];

export default function EnquiryReplyPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <EnquiryReplyComposer />
    </Suspense>
  );
}

function EnquiryReplyComposer() {
  const searchParams = useSearchParams();
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [originalMessage, setOriginalMessage] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [ctaChoice, setCtaChoice] = useState<CtaChoice>('none');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [fromMailbox, setFromMailbox] = useState('');
  const [signature, setSignature] = useState('George at FriendPlace');
  const [sent, setSent] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    setRecipientEmail(searchParams?.get('email') || '');
    setRecipientName(searchParams?.get('name') || '');
    setSubject(searchParams?.get('subject') || '');
    setOriginalMessage(searchParams?.get('message') || '');
  }, [searchParams]);

  const selectedCta = CTA_OPTIONS.find((o) => o.value === ctaChoice) || CTA_OPTIONS[0];
  const customCtaReady = ctaChoice !== 'custom' || (ctaLabel.trim().length > 0 && /^https?:\/\//i.test(ctaUrl.trim()));

  useEffect(() => {
    let alive = true;
    inboxApi.mailboxes().then(({ mailboxes: boxes }) => {
      if (!alive) return;
      const active = boxes.filter((box) => box.active !== false);
      setMailboxes(active);
      const received = searchParams?.get('mailbox') || 'hello@friendplace.com.au';
      setFromMailbox(active.find((box) => box.address.toLowerCase() === received.toLowerCase())?.address || active[0]?.address || '');
    }).catch((e) => {
      if (alive) setPreviewErr(e?.message || 'Could not load sender addresses.');
    });
    return () => { alive = false; };
  }, [searchParams]);

  const emailContent = useMemo(() => renderEnquiryEmail({
    body: bodyText, signature, ctaChoice, ctaLabel, ctaUrl,
  }), [bodyText, signature, ctaChoice, ctaLabel, ctaUrl]);

  const preview = { html: emailContent.html, subject };

  const canSend = recipientEmail.includes('@') && !!fromMailbox && !!subject.trim() && bodyText.trim().length > 0 && customCtaReady && !sending && !sent;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setToast(null);
    try {
      const result = await inboxApi.compose({
        to_email: recipientEmail.trim(),
        subject: subject.trim(),
        body_text: emailContent.text,
        body_html: emailContent.html,
        from_mailbox: fromMailbox,
        include_footer: false,
      });

      if (result.ok) {
        setSent(true);
        const enquiryId = searchParams?.get('in_reply_to');
        const kind = searchParams?.get('kind');
        if (enquiryId && (kind === 'contact' || kind === 'interest' || kind === 'support' || kind === 'report' || kind === 'waitlist')) {
          try {
            await setEnquiryStatus(kind, enquiryId, 'replied');
            setToast({ kind: 'ok', msg: `Sent to ${recipientEmail}. Enquiry marked replied.` });
          } catch {
            setToast({ kind: 'ok', msg: `Email sent to ${recipientEmail}, but its enquiry status could not be updated. Mark it replied from Enquiries; do not resend.` });
          }
        } else {
          markEnquiryHandled(enquiryId);
          setToast({ kind: 'ok', msg: `Sent to ${recipientEmail}.` });
        }
      } else {
        setToast({ kind: 'err', msg: `Send failed: unknown error` });
      }
    } catch (e: any) {
      setToast({ kind: 'err', msg: `Send failed: ${e?.message || e}` });
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminShell title="Reply to Enquiry">
      <p style={crumbs}>
        <Link href="/admin/enquiries" style={crumbLink}>Enquiries</Link>
        {' › '}Personal reply
      </p>

      <div style={modeBanner}>
        <strong>Personal enquiry reply</strong> — read the full original enquiry below, then write your complete reply. Your greeting and wording are used exactly as written. Choose the sending mailbox and signature below.
      </div>

      <div style={layout}>
        <div style={formCol}>
          <div style={card}>
            <h3 style={cardTitle}>Recipient</h3>
            <label style={label} htmlFor="enquiry-from">From</label>
            <select id="enquiry-from" style={input} value={fromMailbox} onChange={(e) => setFromMailbox(e.target.value)}>
              {!fromMailbox && <option value="">Loading sender addresses…</option>}
              {mailboxes.map((box) => <option key={box.id} value={box.address}>{box.label} &lt;{box.address}&gt;</option>)}
            </select>
            <label style={label} htmlFor="enquiry-signature">Signature (leave blank to use your own)</label>
            <input id="enquiry-signature" style={input} value={signature} onChange={(e) => setSignature(e.target.value)} />


            <label style={label}>Name</label>
            <input style={input} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />

            <label style={label}>Email</label>
            <input style={input} type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />

            <label style={label}>Subject</label>
            <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Re: your enquiry" />
          </div>

          <div style={originalCard}>
            <h3 style={cardTitle}>Original enquiry</h3>
            {originalMessage ? (
              <div style={originalMessageStyle}>{originalMessage}</div>
            ) : (
              <p style={{ ...helpText, marginBottom: 0 }}>The original message was not included in this reply link. Return to Enquiries and open Reply again.</p>
            )}
          </div>

          <div style={card}>
            <h3 style={cardTitle}>Your reply</h3>
            <p style={helpText}>This is the full message. Blank lines create new paragraphs and single line breaks are preserved exactly in the preview and delivered email.</p>
            <textarea
              autoFocus
              style={{ ...input, minHeight: 300, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 }}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={recipientName ? `Hi ${recipientName.split(' ')[0]},\n\nThanks for getting in touch...` : 'Hi there,\n\nThanks for getting in touch...'}
            />
          </div>

          <div style={card}>
            <h3 style={cardTitle}>Call-to-action (optional)</h3>
            <p style={helpText}>Add a FriendPlace button to the bottom of this email. It will appear in the live preview before you send.</p>
            <label style={label}>Button choice</label>
            <select
              style={input}
              value={ctaChoice}
              onChange={(e) => setCtaChoice(e.target.value as CtaChoice)}
            >
              {CTA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p style={{ ...helpText, marginTop: 8, marginBottom: ctaChoice === 'custom' ? 10 : 0 }}>{selectedCta.help}</p>

            {ctaChoice === 'custom' && (
              <div style={customCtaGrid}>
                <div>
                  <label style={label}>Button label</label>
                  <input
                    style={input}
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    placeholder="Learn more"
                  />
                </div>
                <div>
                  <label style={label}>Button URL</label>
                  <input
                    style={input}
                    type="url"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            )}

            {ctaChoice === 'custom' && !customCtaReady && (ctaLabel || ctaUrl) && (
              <p style={ctaError}>Custom buttons need a label and a full http:// or https:// URL.</p>
            )}
          </div>

          <div style={sendBar}>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              style={{ ...sendBtn, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }}
            >
              {sent ? 'Reply sent' : sending ? 'Sending…' : 'Send reply'}
            </button>
            <Link href="/admin/enquiries" style={cancelLink}>Cancel</Link>
          </div>

          {toast && (
            <div style={{ ...toastBox, background: toast.kind === 'ok' ? '#DCFCE7' : '#FEE2E2', color: toast.kind === 'ok' ? '#166534' : '#991B1B' }}>
              {toast.msg}
            </div>
          )}
        </div>

        <div style={previewCol}>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={previewHeader}>
              <span style={previewHeaderLabel}>Live preview</span>
              <span style={previewHeaderMeta}>{preview?.subject || '—'}</span>
            </div>

            {previewErr ? (
              <div style={{ padding: 16, color: '#991B1B', fontSize: 13 }}>Preview failed: {previewErr}</div>
            ) : (
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview?.html || '<p style="padding:24px;color:#94A3B8;font-family:sans-serif;">Type your reply to see the exact email preview…</p>'}
                style={{ width: '100%', height: 720, border: 'none', background: '#0A2540' }}
              />
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 480px) minmax(0, 1fr)',
  gap: 20,
  alignItems: 'start',
};
const crumbs: React.CSSProperties = { margin: '4px 0 16px', color: '#475569', fontSize: 13 };
const crumbLink: React.CSSProperties = { color: '#0F766E', textDecoration: 'none', fontWeight: 700 };
const modeBanner: React.CSSProperties = { marginBottom: 18, padding: '12px 14px', borderRadius: 12, background: '#F0FDFA', border: '1px solid #99F6E4', color: '#0F766E', fontSize: 13, lineHeight: 1.5 };
const formCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const previewCol: React.CSSProperties = { position: 'sticky', top: 16 };
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 20 };
const originalCard: React.CSSProperties = { ...card, background: '#F8FAFC', borderColor: '#CBD5E1' };
const originalMessageStyle: React.CSSProperties = { fontSize: 14, color: '#334155', lineHeight: 1.65, whiteSpace: 'pre-wrap', padding: '12px 14px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10 };
const cardTitle: React.CSSProperties = { margin: '0 0 12px', fontSize: 15, fontWeight: 800, color: '#0A2540' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 10, marginBottom: 4 };
const helpText: React.CSSProperties = { margin: '0 0 10px', fontSize: 12, color: '#64748B', lineHeight: 1.5 };
const input: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F172A', background: '#FFFFFF' };
const customCtaGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 10 };
const ctaError: React.CSSProperties = { margin: '10px 0 0', fontSize: 12, color: '#B91C1C', fontWeight: 700 };
const sendBar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14 };
const sendBtn: React.CSSProperties = { background: '#0D9488', color: '#FFFFFF', border: 'none', borderRadius: 12, padding: '12px 28px', fontSize: 15, fontWeight: 800 };
const cancelLink: React.CSSProperties = { color: '#64748B', fontSize: 13, fontWeight: 700, textDecoration: 'none' };
const toastBox: React.CSSProperties = { marginTop: 0, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600 };
const previewHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const previewHeaderLabel: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#0F766E' };
const previewHeaderMeta: React.CSSProperties = { fontSize: 12, color: '#0F172A', fontWeight: 700, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
