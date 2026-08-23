'use client';

/**
 * /admin/replies — Replies inbox (iter160b P0).
 *
 * The manual counterpart to "wire up a Resend inbound webhook one day".
 * Admins log replies here as they arrive (email, phone, in-person) and
 * the row shows who replied, from which campaign, when, whether we've
 * read it, and whether we've responded (resolved).
 *
 * Reply flow:
 *  - Row → "Reply →" → opens /admin/marketing/send with the person
 *    pre-selected + template_id='enquiry_reply' + in_reply_to. When the
 *    admin sends, the backend auto-resolves the pending reply, closing
 *    the loop and dropping the sidebar badge count.
 *
 * Log flow:
 *  - "Log a reply" opens an in-page composer. Only From-email +
 *    From-name are required. Everything else is optional.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  repliesApi,
  type InboundReply,
  type ReplyChannel,
} from '@/lib/cms-api';

type Filter = 'all' | 'unread' | 'awaiting';

const CHANNEL_LABEL: Record<ReplyChannel, string> = {
  email:     'Email',
  phone:     'Phone',
  in_person: 'In person',
  sms:       'SMS',
  other:     'Other',
};

const CHANNEL_COLOUR: Record<ReplyChannel, { bg: string; fg: string }> = {
  email:     { bg: '#DBEAFE', fg: '#1E40AF' },
  phone:     { bg: '#FCE7F3', fg: '#9D174D' },
  in_person: { bg: '#DCFCE7', fg: '#166534' },
  sms:       { bg: '#FEF3C7', fg: '#92400E' },
  other:     { bg: '#F1F5F9', fg: '#475569' },
};

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 1)  return `${Math.max(1, Math.round(diffHrs * 60))} min ago`;
    if (diffHrs < 24) return `${Math.round(diffHrs)} h ago`;
    const diffDays = diffHrs / 24;
    if (diffDays < 7) return `${Math.round(diffDays)} d ago`;
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export default function RepliesPage() {
  const searchParams = useSearchParams();
  const prefill = useMemo(() => ({
    email:   searchParams?.get('email')   || '',
    name:    searchParams?.get('name')    || '',
    subject: searchParams?.get('subject') || '',
  }), [searchParams]);
  const autoOpenLog = searchParams?.get('log') === '1';
  // iter164g: allow ?filter=awaiting from the Mission Control stale
  // nudge card to open the Replies inbox pre-filtered.
  const urlFilter = (searchParams?.get('filter') as Filter | null) || null;

  const [filter, setFilter] = useState<Filter>(
    urlFilter && ['all', 'unread', 'awaiting'].includes(urlFilter) ? urlFilter : 'all',
  );
  const [rows, setRows] = useState<InboundReply[]>([]);
  const [unread, setUnread] = useState(0);
  const [awaiting, setAwaiting] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // iter164g: modal target for "Resolve without sending".
  const [resolveWithoutSend, setResolveWithoutSend] = useState<InboundReply | null>(null);

  useEffect(() => {
    if (autoOpenLog && (prefill.email || prefill.name)) setShowLog(true);
  }, [autoOpenLog, prefill.email, prefill.name]);

  const load = async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof repliesApi.list>[0] = { limit: 500 };
      if (filter === 'unread')   params.read = false;
      if (filter === 'awaiting') params.resolved = false;
      if (q.trim())              params.q = q.trim();
      const r = await repliesApi.list(params);
      setRows(r.replies);
      setUnread(r.unread_count);
      setAwaiting(r.awaiting_count);
    } catch (e: any) {
      setToast(`Couldn’t load replies: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const selected = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) : null),
    [selectedId, rows],
  );

  const flipRead = async (r: InboundReply) => {
    try {
      await repliesApi.markRead(r.id, !r.read);
      await load();
    } catch (e: any) { setToast(`Couldn’t update: ${e?.message || e}`); }
  };
  const flipResolved = async (r: InboundReply) => {
    try {
      // iter164g: unchanged "toggle" behaviour — used ONLY by the
      // "Reopen" case in the UI now. Explicit resolution actions
      // (Resolved via reply / Resolve without sending) provide the
      // kind + note through the dedicated modal below.
      await repliesApi.markResolved(r.id, !r.resolved);
      await load();
    } catch (e: any) { setToast(`Couldn’t update: ${e?.message || e}`); }
  };
  const submitResolveWithoutSend = async (
    r: InboundReply, note: string,
  ) => {
    try {
      await repliesApi.markResolved(r.id, true, {
        resolution_kind: 'no_reply_needed',
        resolution_note: note,
      });
      setResolveWithoutSend(null);
      setToast('Resolved without sending — kept in the audit trail.');
      await load();
    } catch (e: any) { setToast(`Couldn’t resolve: ${e?.message || e}`); }
  };
  const del = async (r: InboundReply) => {
    if (!confirm(`Delete reply from ${r.from_name || r.from_email}? This can't be undone.`)) return;
    try {
      await repliesApi.del(r.id);
      if (selectedId === r.id) setSelectedId(null);
      await load();
    } catch (e: any) { setToast(`Couldn’t delete: ${e?.message || e}`); }
  };

  const replyHref = (r: InboundReply) => {
    const p = new URLSearchParams({
      email: r.from_email,
      name:  r.from_name || '',
      template_id: 'enquiry_reply',
      subject: r.subject ? (r.subject.startsWith('Re:') ? r.subject : `Re: ${r.subject}`) : '',
      in_reply_to: r.id,
    });
    if (r.campaign_id) p.set('campaign_id', r.campaign_id);
    return `/admin/marketing/send?${p.toString()}`;
  };

  return (
    <AdminShell title="Replies">
      <p style={crumbs}>
        <Link href="/admin/crm" style={crumbLink}>CRM</Link>
        {' › '}Replies — log every response from a campaign or enquiry so
        nobody waits longer than they should.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {(['all','unread','awaiting'] as Filter[]).map((f) => (
          <button
            key={f}
            data-testid={`replies-tab-${f}`}
            onClick={() => setFilter(f)}
            style={{
              ...pill,
              background: filter === f ? '#0D9488' : '#FFFFFF',
              color:      filter === f ? '#FFFFFF' : '#0F172A',
              borderColor: filter === f ? '#0D9488' : '#E2E8F0',
            }}
          >
            {f === 'all'      ? `All (${rows.length})` :
             f === 'unread'   ? `Unread (${unread})` :
             `Awaiting reply (${awaiting})`}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          placeholder="Search sender, subject, body…"
          style={{ ...adminStyles.input, maxWidth: 320, marginLeft: 'auto', marginBottom: 0 }}
        />
        <button
          data-testid="replies-log-btn"
          onClick={() => setShowLog(true)}
          style={{ ...adminStyles.primaryBtn }}
        >+ Log a reply</button>
      </div>

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading replies…</p>
      ) : rows.length === 0 ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💌</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0A2540' }}>No replies yet</div>
          <p style={{ color: '#64748B', maxWidth: 480, margin: '8px auto 16px', lineHeight: 1.55 }}>
            When someone writes back — or calls, or replies in person — click{' '}
            <strong>Log a reply</strong> so we can track who&apos;s waiting on us.
          </p>
          <button onClick={() => setShowLog(true)} style={adminStyles.primaryBtn}>
            + Log a reply
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r) => (
              <div
                key={r.id}
                data-testid={`reply-row-${r.id}`}
                onClick={() => { setSelectedId(r.id); if (!r.read) flipRead(r); }}
                style={{
                  ...rowCard,
                  borderColor: selectedId === r.id ? '#14B8A6' : (r.read ? '#E2E8F0' : '#5EEAD4'),
                  background:  r.read ? '#FFFFFF' : '#F0FDFA',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: 999, marginTop: 6,
                    background: r.read ? 'transparent' : '#14B8A6', flexShrink: 0,
                  }} />
                  <span style={{
                    padding: '3px 10px', borderRadius: 999,
                    background: CHANNEL_COLOUR[r.channel].bg,
                    color:      CHANNEL_COLOUR[r.channel].fg,
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
                    textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>{CHANNEL_LABEL[r.channel]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: r.read ? 600 : 800, color: '#0A2540' }}>
                      {r.from_name || '(no name)'}
                      <span style={{ color: '#64748B', fontWeight: 500, marginLeft: 8 }}>· {r.from_email}</span>
                    </div>
                    {r.subject && <div style={{ fontSize: 13, color: '#475569', marginTop: 3, fontWeight: r.read ? 500 : 700 }}>{r.subject}</div>}
                    {r.body && (
                      <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, lineHeight: 1.55, maxHeight: 40, overflow: 'hidden' }}>
                        {r.body}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.campaign_name && (
                        <span style={metaChip}>📮 {r.campaign_name}</span>
                      )}
                      {r.resolved ? (
                        <span style={{ ...metaChip, background: '#DCFCE7', color: '#166534' }}>✓ Resolved</span>
                      ) : (
                        <span style={{ ...metaChip, background: '#FEE2E2', color: '#991B1B' }}>◔ Awaiting our reply</span>
                      )}
                      <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 'auto' }}>{fmtWhen(r.received_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Detail rail ------------------------------------------------- */}
          <aside style={detailRail}>
            {selected ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 999,
                    background: CHANNEL_COLOUR[selected.channel].bg,
                    color:      CHANNEL_COLOUR[selected.channel].fg,
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
                  }}>{CHANNEL_LABEL[selected.channel]}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 'auto' }}>{fmtWhen(selected.received_at)}</span>
                </div>
                <h3 style={{ margin: '0 0 4px', color: '#0A2540', fontSize: 17, fontWeight: 800 }}>
                  {selected.from_name || '(no name)'}
                </h3>
                <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>{selected.from_email}</div>
                {selected.subject && (
                  <div style={{ color: '#0F172A', fontWeight: 700, marginBottom: 6 }}>{selected.subject}</div>
                )}
                <div style={{ color: '#334155', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 14, minHeight: 60 }}>
                  {selected.body || <em style={{ color: '#94A3B8' }}>(no message body)</em>}
                </div>
                {selected.campaign_name && (
                  <div style={metaLine}><strong>Campaign:</strong> {selected.campaign_name}</div>
                )}
                {selected.notes && (
                  <div style={metaLine}><strong>Notes:</strong> {selected.notes}</div>
                )}
                {selected.resolved && selected.resolved_at && (
                  <div style={{ ...metaLine, color: '#166534' }}>
                    <strong>✓ Resolved</strong>{' '}
                    {selected.resolution_kind === 'no_reply_needed'
                      ? '(without sending) '
                      : selected.resolution_kind === 'replied'
                      ? '(replied) '
                      : ''}
                    {fmtWhen(selected.resolved_at)}
                    {selected.resolved_by && ` by ${selected.resolved_by}`}
                  </div>
                )}
                {selected.resolved && selected.resolution_note && (
                  <div style={{ ...metaLine, color: '#475569' }}>
                    <strong>Reason:</strong>{' '}
                    <span style={{ fontStyle: 'italic' }}>{selected.resolution_note}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                  <Link href={replyHref(selected)} style={{ ...adminStyles.primaryBtn, textDecoration: 'none', display: 'inline-block' }} data-testid="reply-action-btn">
                    Reply →
                  </Link>
                  {!selected.resolved && (
                    <button
                      onClick={() => setResolveWithoutSend(selected)}
                      style={adminStyles.ghostBtn}
                      data-testid="reply-resolve-without-send"
                      title="Close this reply without sending an outbound response. Kept in history."
                    >
                      Resolve without sending
                    </button>
                  )}
                  <button onClick={() => flipRead(selected)} style={adminStyles.ghostBtn} data-testid="reply-toggle-read">
                    {selected.read ? 'Mark unread' : 'Mark read'}
                  </button>
                  {selected.resolved && (
                    <button onClick={() => flipResolved(selected)} style={adminStyles.ghostBtn} data-testid="reply-reopen">
                      Reopen
                    </button>
                  )}
                  <button onClick={() => del(selected)} style={adminStyles.dangerBtn} data-testid="reply-delete-btn">Delete</button>
                </div>
              </>
            ) : (
              <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: '48px 8px' }}>
                Select a reply to see the full message and reply actions.
              </div>
            )}
          </aside>
        </div>
      )}

      {showLog && (
        <LogReplyModal
          initial={prefill}
          onClose={() => setShowLog(false)}
          onSaved={(r) => { setShowLog(false); setToast(`Reply from ${r.from_name || r.from_email} logged.`); load(); }}
        />
      )}

      {resolveWithoutSend && (
        <ResolveWithoutSendModal
          reply={resolveWithoutSend}
          onClose={() => setResolveWithoutSend(null)}
          onConfirm={(note) => submitResolveWithoutSend(resolveWithoutSend, note)}
        />
      )}

      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{ ...adminStyles.toast, cursor: 'pointer' }}
        >{toast}</div>
      )}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Resolve-without-sending modal (iter164g)
// ---------------------------------------------------------------------------

function ResolveWithoutSendModal({
  reply, onClose, onConfirm,
}: {
  reply: InboundReply;
  onClose: () => void;
  onConfirm: (note: string) => void | Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const canSave = !saving; // note is optional but strongly encouraged
  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try { await onConfirm(note.trim()); }
    finally { setSaving(false); }
  };
  const suggestions = [
    'Spam — no action needed',
    'Thank-you, no reply required',
    'Handled offline / by phone',
    'Wrong recipient — ignore',
    'Already replied outside FriendPlace',
  ];
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()} data-testid="resolve-without-send-modal">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#0A2540', fontSize: 20, fontWeight: 900 }}>
            Resolve without sending
          </h3>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
          Close this reply from{' '}
          <strong>{reply.from_name || reply.from_email}</strong> without
          sending an outbound response. The reply stays in history with
          your reason attached — nothing is emailed, nothing is deleted.
        </p>

        <label style={{ ...adminStyles.label, marginTop: 16 }}>
          Reason (recommended)
        </label>
        <textarea
          data-testid="resolve-without-send-note"
          style={{ ...adminStyles.textarea, minHeight: 80 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why doesn’t this need a reply? e.g. Spam, thank-you, handled by phone…"
        />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setNote(s)}
              style={{
                ...pill,
                padding: '4px 10px',
                fontSize: 12,
                background: '#F1F5F9',
              }}
            >{s}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={adminStyles.ghostBtn}>Cancel</button>
          <button
            onClick={submit}
            disabled={!canSave}
            data-testid="resolve-without-send-confirm"
            style={{ ...adminStyles.primaryBtn, opacity: canSave ? 1 : 0.5 }}
          >
            {saving ? 'Resolving…' : 'Resolve without sending'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log-a-reply modal
// ---------------------------------------------------------------------------

function LogReplyModal({
  initial, onClose, onSaved,
}: {
  initial?: { email?: string; name?: string; subject?: string };
  onClose: () => void;
  onSaved: (r: InboundReply) => void;
}) {
  const [from_email, setEmail] = useState(initial?.email || '');
  const [from_name, setName]   = useState(initial?.name  || '');
  const [subject, setSubject]  = useState(initial?.subject || '');
  const [body, setBody]        = useState('');
  const [channel, setChannel]  = useState<ReplyChannel>('email');
  const [notes, setNotes]      = useState('');
  const [saving, setSaving]    = useState(false);
  const [err, setErr]          = useState<string | null>(null);

  const canSave = from_email.includes('@') && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await repliesApi.create({
        from_email: from_email.trim(),
        from_name:  from_name.trim(),
        subject:    subject.trim(),
        body:       body.trim(),
        channel,
        notes:      notes.trim(),
      });
      onSaved(r);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setSaving(false); }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()} data-testid="log-reply-modal">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#0A2540', fontSize: 20, fontWeight: 900 }}>Log a reply</h3>
          <button onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        <label style={adminStyles.label}>Channel</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {(['email','phone','in_person','sms','other'] as ReplyChannel[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              style={{
                ...pill,
                background: channel === c ? '#0D9488' : '#F1F5F9',
                color:      channel === c ? '#FFFFFF' : '#0F172A',
                borderColor: channel === c ? '#0D9488' : '#E2E8F0',
              }}
            >{CHANNEL_LABEL[c]}</button>
          ))}
        </div>

        <label style={adminStyles.label}>From email <span style={{ color: '#EF4444' }}>*</span></label>
        <input
          data-testid="log-reply-email"
          style={adminStyles.input}
          type="email"
          value={from_email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@retirementvillage.com.au"
        />

        <label style={{ ...adminStyles.label, marginTop: 12 }}>From name</label>
        <input
          data-testid="log-reply-name"
          style={adminStyles.input}
          value={from_name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Smith"
        />

        <label style={{ ...adminStyles.label, marginTop: 12 }}>Subject</label>
        <input
          style={adminStyles.input}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder='Re: "FriendPlace intro"'
        />

        <label style={{ ...adminStyles.label, marginTop: 12 }}>
          What they said {channel === 'phone' || channel === 'in_person' ? '(your notes)' : ''}
        </label>
        <textarea
          data-testid="log-reply-body"
          style={{ ...adminStyles.textarea, minHeight: 120 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={channel === 'phone'
            ? 'Called at 2pm. Interested in a display for the residents’ lounge…'
            : 'Paste the reply, or summarise what they said.'}
        />

        <label style={{ ...adminStyles.label, marginTop: 12 }}>Internal notes (optional)</label>
        <input
          style={adminStyles.input}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Follow up next Tuesday"
        />

        {err && <div style={{ color: '#B91C1C', marginTop: 12, fontSize: 13 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={adminStyles.ghostBtn}>Cancel</button>
          <button
            onClick={save}
            disabled={!canSave}
            data-testid="log-reply-save"
            style={{ ...adminStyles.primaryBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >
            {saving ? 'Saving…' : 'Log reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const crumbs: React.CSSProperties = { fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 20, lineHeight: 1.55 };
const crumbLink: React.CSSProperties = { color: '#0D9488', fontWeight: 700, textDecoration: 'none' };
const pill: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1.5px solid #E2E8F0',
  background: '#FFFFFF',
  color: '#0F172A',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};
const rowCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1.5px solid #E2E8F0',
  borderRadius: 14,
  padding: 16,
  transition: 'transform 160ms ease, box-shadow 200ms ease, border-color 200ms ease',
};
const detailRail: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: 20,
  position: 'sticky',
  top: 20,
  alignSelf: 'flex-start',
  maxHeight: 'calc(100vh - 100px)',
  overflowY: 'auto',
};
const emptyCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px dashed #CBD5E1',
  borderRadius: 16,
  padding: '48px 24px',
  textAlign: 'center',
};
const metaChip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 6,
  background: '#F1F5F9',
  color: '#475569',
  fontSize: 11,
  fontWeight: 700,
};
const metaLine: React.CSSProperties = { fontSize: 13, color: '#475569', marginBottom: 6 };
const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 20,
};
const modalCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 16, padding: 24,
  maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: '0 24px 60px rgba(10,37,64,0.35)',
};
const closeBtn: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 20, color: '#64748B',
};
