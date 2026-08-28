'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { marketingApi, type MarketingPreviewOut } from '@/lib/cms-api';
import { markEnquiryHandled } from '@/lib/enquiry-handled';

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
  const [preview, setPreview] = useState<MarketingPreviewOut | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    setRecipientEmail(searchParams?.get('email') || '');
    setRecipientName(searchParams?.get('name') || '');
    setSubject(searchParams?.get('subject') || '');
    setOriginalMessage(searchParams?.get('message') || '');
  }, [searchParams]);

  const previewKey = useMemo(
    () => JSON.stringify({ recipientName, recipientEmail, subject, bodyText }),
    [recipientName, recipientEmail, subject, bodyText],
  );

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      setPreviewErr(null);
      try {
        const p = await marketingApi.preview({
          template_id: 'enquiry_reply',
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          recipient_type: 'person',
          subject_override: subject || null,
          additional_message: '',
          body_text: bodyText,
        } as any);
        if (alive) setPreview(p);
      } catch (e: any) {
        if (!alive) return;
        setPreview(null);
        setPreviewErr(e?.message || String(e));
      } finally {
        if (alive) setPreviewBusy(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [previewKey, recipientName, recipientEmail, subject, bodyText]);

  const canSend = recipientEmail.includes('@') && bodyText.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setToast(null);
    try {
      const result = await marketingApi.send({
        template_id: 'enquiry_reply',
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        recipient_type: 'person',
        subject_override: subject || null,
        additional_message: '',
        body_text: bodyText,
      } as any);

      if (result.ok) {
        // A successful outbound reply means this enquiry has been handled.
        // Keep that state separate from the Replies inbox, which is only for
        // replies coming back *to us* (email/phone/in person).
        markEnquiryHandled(searchParams?.get('in_reply_to'));
        setToast({ kind: 'ok', msg: `Sent to ${result.recipient_email}. Enquiry marked replied.` });
      } else {
        setToast({ kind: 'err', msg: `Send failed: ${result.error || 'unknown error'}` });
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
        <strong>Personal enquiry reply</strong> — read the full original enquiry below, then write your complete reply. No canned intro will be added. The FriendPlace branded wrapper and team sign-off stay in place.
      </div>

      <div style={layout}>
        <div style={formCol}>
          <div style={card}>
            <h3 style={cardTitle}>Recipient</h3>

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

          <div style={sendBar}>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              style={{ ...sendBtn, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }}
            >
              {sending ? 'Sending…' : 'Send reply'}
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
              <span style={previewHeaderMeta}>{previewBusy ? 'refreshing…' : preview?.subject || '—'}</span>
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
const sendBar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14 };
const sendBtn: React.CSSProperties = { background: '#0D9488', color: '#FFFFFF', border: 'none', borderRadius: 12, padding: '12px 28px', fontSize: 15, fontWeight: 800 };
const cancelLink: React.CSSProperties = { color: '#64748B', fontSize: 13, fontWeight: 700, textDecoration: 'none' };
const toastBox: React.CSSProperties = { marginTop: 0, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600 };
const previewHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' };
const previewHeaderLabel: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#0F766E' };
const previewHeaderMeta: React.CSSProperties = { fontSize: 12, color: '#0F172A', fontWeight: 700, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
