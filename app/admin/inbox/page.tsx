'use client';

/**
 * Admin ▸ Inbox ▸ Combined FriendPlace mailbox
 *
 * A single combined inbox for every managed FriendPlace address
 * (hello@, support@, enquiries@, garry@, privacy@ … editable from here).
 * Real inbound email arrives via the backend webhook; replies go out
 * through the existing Resend infrastructure, from the same FriendPlace
 * address the message was sent to. Behaviour mirrors the Enquiries
 * section: unread badge, open/read, mark read/unread, archive, reply.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  inboxApi,
  type InboxMessage,
  type Mailbox,
} from '@/lib/inbox-api';

export default function AdminInboxPage() {
  return (
    <AdminShell title="Inbox">
      <InboxPanel />
    </AdminShell>
  );
}

function fmt(dt?: string) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function InboxPanel() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [rows, setRows] = useState<InboxMessage[] | null>(null);
  const [mailbox, setMailbox] = useState<string>(''); // '' = all
  const [archived, setArchived] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // detail
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  const [thread, setThread] = useState<InboxMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // manage mailboxes
  const [manageOpen, setManageOpen] = useState(false);
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      // Fetch the current view and a tiny unread-only view in parallel.
      // The second response lets Mission Control calculate reliable per-mailbox
      // unread badges even if the backend mailbox metadata is stale.
      const [r, unreadR] = await Promise.all([
        inboxApi.list({
          mailbox: mailbox || undefined,
          archived,
          read: unreadOnly ? false : undefined,
          limit: 300,
        }),
        inboxApi.list({
          archived: false,
          read: false,
          limit: 300,
        }),
      ]);

      const unreadByMailbox = new Map<string, number>();
      for (const message of unreadR.rows || []) {
        unreadByMailbox.set(message.mailbox, (unreadByMailbox.get(message.mailbox) || 0) + 1);
      }

      setRows(r.rows);
      setMailboxes(r.mailboxes.map((mb) => ({
        ...mb,
        unread: unreadByMailbox.get(mb.address) || 0,
      })));
      setError(null);
    } catch (e: any) {
      // Background polling should not replace a working inbox with a loading
      // state, but a real error still needs to be visible to the admin.
      setError(e?.message || 'Failed to load inbox.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [mailbox, archived, unreadOnly]);

  useEffect(() => { void load(); }, [load]);

  // Keep the inbox live without requiring a browser refresh. Poll quietly while
  // visible, and refresh immediately when the admin returns to the tab/window.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    const timer = window.setInterval(refreshIfVisible, 10000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  const totalUnread = useMemo(
    () => mailboxes.reduce((n, m) => n + (m.unread || 0), 0),
    [mailboxes],
  );

  const openMessage = async (m: InboxMessage) => {
    setNotice(null);
    setReplyText('');
    try {
      const r = await inboxApi.get(m.id);
      setSelected(r.message);
      setThread(r.thread);
      // reflect read state in the list without a full reload
      setRows((prev) => prev?.map((x) => (x.id === m.id ? { ...x, read: true } : x)) ?? prev);
      setMailboxes((prev) => prev.map((mb) =>
        mb.address === m.mailbox && !m.read ? { ...mb, unread: Math.max(0, (mb.unread || 0) - 1) } : mb));
    } catch (e: any) {
      setError(e?.message || 'Could not open message.');
    }
  };

  const toggleRead = async (m: InboxMessage) => {
    setBusy(m.id);
    try {
      const updated = await inboxApi.setRead(m.id, !m.read);
      setRows((prev) => prev?.map((x) => (x.id === m.id ? updated : x)) ?? prev);
      if (selected?.id === m.id) setSelected(updated);
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || 'Action failed.'); }
    finally { setBusy(null); }
  };

  const archiveOrRestore = async (m: InboxMessage) => {
    setBusy(m.id);
    try {
      if (archived) await inboxApi.restore(m.id);
      else await inboxApi.archive(m.id);
      if (selected?.id === m.id) { setSelected(null); setThread([]); }
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || 'Action failed.'); }
    finally { setBusy(null); }
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      await inboxApi.reply(selected.id, { body_text: replyText.trim() });
      setNotice('Reply sent.');
      setReplyText('');
      const r = await inboxApi.get(selected.id);
      setSelected(r.message);
      setThread(r.thread);
      await load({ silent: true });
    } catch (e: any) {
      setNotice(null);
      setError(e?.message || 'Reply could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const addMailbox = async () => {
    if (!newAddr.trim()) return;
    try {
      await inboxApi.addMailbox(newAddr.trim(), newLabel.trim() || undefined);
      setNewAddr(''); setNewLabel('');
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || 'Could not add mailbox.'); }
  };

  const removeMailbox = async (mb: Mailbox) => {
    if (!confirm(`Remove ${mb.address} from the managed mailbox list? Stored messages are kept.`)) return;
    try {
      await inboxApi.removeMailbox(mb.id);
      if (mailbox === mb.address) setMailbox('');
      await load({ silent: true });
    } catch (e: any) { setError(e?.message || 'Could not remove mailbox.'); }
  };

  const mailboxLabel = (addr: string) =>
    mailboxes.find((m) => m.address === addr)?.label || addr;

  return (
    <div>
      {error && <div style={errorBox}>{error}</div>}

      {/* Mailbox filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Chip active={mailbox === ''} onClick={() => setMailbox('')}
          label="All" count={totalUnread} />
        {mailboxes.map((mb) => (
          <Chip key={mb.id} active={mailbox === mb.address}
            onClick={() => setMailbox(mb.address)}
            label={mb.label}
            count={mb.unread || 0}
            title={mb.address} />
        ))}
        <button type="button" onClick={() => setManageOpen((v) => !v)} style={manageBtn}>
          ⚙︎ Manage
        </button>
      </div>

      {manageOpen && (
        <div style={{ ...s.card, padding: 18 }}>
          <p style={s.cardTitle}>Managed FriendPlace addresses</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {mailboxes.map((mb) => (
              <span key={mb.id} style={mbPill}>
                {mb.label} · {mb.address}
                <button type="button" onClick={() => removeMailbox(mb)} style={mbPillX} aria-label="Remove">×</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 240px' }}>
              <label style={s.label}>Add address</label>
              <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)}
                placeholder="new@friendplace.com.au" style={s.input as React.CSSProperties} />
            </div>
            <div style={{ flex: '0 1 160px' }}>
              <label style={s.label}>Label (optional)</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Team" style={s.input as React.CSSProperties} />
            </div>
            <button type="button" onClick={addMailbox} style={s.primaryBtn as React.CSSProperties}>Add mailbox</button>
          </div>
          <p style={s.helper}>New mailboxes take inbound mail immediately — no code change needed.</p>
        </div>
      )}

      {/* View toggles */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Toggle active={!archived} onClick={() => setArchived(false)} label="Inbox" />
        <Toggle active={archived} onClick={() => setArchived(true)} label="Archived" />
        <Toggle active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} label="Unread only" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 20, alignItems: 'start' }}>
        {/* List */}
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          {loading && <div style={emptyRow}>Loading…</div>}
          {!loading && (rows?.length ?? 0) === 0 && (
            <div style={emptyRow}>{archived ? 'No archived messages.' : 'No messages yet.'}</div>
          )}
          {!loading && rows?.map((m) => (
            <button key={m.id} type="button" onClick={() => openMessage(m)}
              style={{
                ...listRow,
                background: selected?.id === m.id ? '#F0FDFA' : m.read ? '#FFFFFF' : '#F8FBFF',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {!m.read && <span style={unreadDot} aria-label="unread" />}
                <span style={{ fontWeight: m.read ? 600 : 800, color: '#0A2540', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.from_name || m.from_email}
                </span>
                <span style={toChip}>→ {mailboxLabel(m.mailbox)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' }}>{fmt(m.received_at)}</span>
              </div>
              <div style={{ fontWeight: m.read ? 500 : 700, color: '#0A2540', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.subject}
              </div>
              <div style={{ fontSize: 13, color: '#64748B', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.snippet}
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div style={{ ...s.card, minHeight: 260 }}>
          {!selected && <div style={{ color: '#94A3B8', fontSize: 14 }}>Select a message to read it.</div>}
          {selected && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ ...s.cardTitle, marginBottom: 6 }}>{selected.subject}</h3>
                  <div style={{ fontSize: 13, color: '#475569' }}>
                    <strong>{selected.from_name || selected.from_email}</strong> &lt;{selected.from_email}&gt;
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    to <strong>{mailboxLabel(selected.mailbox)}</strong> ({selected.mailbox})
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => toggleRead(selected)} disabled={busy === selected.id} style={ghostSmall}>
                    {selected.read ? 'Mark unread' : 'Mark read'}
                  </button>
                  <button type="button" onClick={() => archiveOrRestore(selected)} disabled={busy === selected.id} style={ghostSmall}>
                    {archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </div>

              {/* Thread */}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {thread.map((t) => (
                  <div key={t.id} style={{
                    borderRadius: 12, padding: 14,
                    border: '1px solid #E2E8F0',
                    background: t.direction === 'outbound' ? '#F0FDFA' : '#FFFFFF',
                  }}>
                    <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>
                      {t.direction === 'outbound'
                        ? `FriendPlace (${t.mailbox}) → ${t.to_email}`
                        : `${t.from_name || t.from_email} → ${t.mailbox}`}
                      <span style={{ marginLeft: 8 }}>· {fmt(t.received_at)}</span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#0A2540', lineHeight: 1.6 }}>
                      {t.text || t.snippet}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply */}
              <div style={{ marginTop: 16 }}>
                <label style={s.label}>Reply from {selected.mailbox}</label>
                <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write your reply…" style={{ ...(s.textarea as React.CSSProperties), minHeight: 120 }} />
                {notice && <div style={noticeBox}>{notice}</div>}
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={sendReply} disabled={sending || !replyText.trim()}
                    style={{ ...(s.primaryBtn as React.CSSProperties), opacity: sending || !replyText.trim() ? 0.6 : 1 }}>
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, title, count = 0 }: { active: boolean; onClick: () => void; label: string; title?: string; count?: number }) {
  const hasUnread = count > 0;
  return (
    <button type="button" onClick={onClick} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: active ? '1.5px solid #14B8A6' : hasUnread ? '1.5px solid #5EEAD4' : '1.5px solid #E2E8F0',
        background: active ? '#F0FDFA' : '#FFFFFF', color: active ? '#0F766E' : '#475569',
      }}>
      <span>{label}</span>
      {hasUnread && (
        <span style={{
          minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: active ? '#0F766E' : '#14B8A6', color: '#FFFFFF',
          fontSize: 11, fontWeight: 900, lineHeight: 1,
        }}>{count}</span>
      )}
    </button>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: active ? '1.5px solid #0A2540' : '1.5px solid #E2E8F0',
        background: active ? '#0A2540' : '#FFFFFF', color: active ? '#FFFFFF' : '#475569',
      }}>{label}</button>
  );
}

const errorBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 };
const noticeBox: React.CSSProperties = { background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#047857', borderRadius: 10, padding: 10, marginTop: 10, fontSize: 13 };
const emptyRow: React.CSSProperties = { padding: 24, color: '#94A3B8', fontSize: 14 };
const listRow: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid #EEF2F6', padding: '14px 16px', cursor: 'pointer' };
const unreadDot: React.CSSProperties = { width: 8, height: 8, borderRadius: 999, background: '#14B8A6', flexShrink: 0 };
const toChip: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#0F766E', background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' };
const ghostSmall: React.CSSProperties = { padding: '7px 12px', borderRadius: 10, border: '1.5px solid #CBD5E1', background: '#FFFFFF', color: '#334155', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const manageBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1.5px dashed #CBD5E1', background: '#FFFFFF', color: '#475569', marginLeft: 'auto' };
const mbPill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#0A2540', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 999, padding: '5px 6px 5px 12px' };
const mbPillX: React.CSSProperties = { border: 'none', background: '#E2E8F0', color: '#475569', width: 20, height: 20, borderRadius: 999, cursor: 'pointer', fontSize: 14, lineHeight: '18px' };
