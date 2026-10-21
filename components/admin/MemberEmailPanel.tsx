'use client';
/**
 * Member Communications — individual admin → member email (Oct 2026).
 * Used inside any member Details screen (app accounts: kind="user",
 * Founding Member registrations: kind="founder").
 *
 * From (authorised FriendPlace mailboxes, default support@) · To (member's
 * current address) · Category · Template reuse · Subject · Message (existing
 * RichTextEditor) → Preview → final From/To/Subject confirmation → Send.
 * Sending never changes the member's status, FMN or permissions; a Formal
 * warning is a label only. Email History lists every message permanently.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { getToken, clearAuth } from '@/lib/cms-auth';
import { API_BASE } from '@/lib/api-base';

type Kind = 'user' | 'founder';
type Sender = { address: string; name: string; label: string; default: boolean };
type Opt = { value: string; label: string };
type Tpl = { id: string; name?: string; subject?: string; title?: string; body_md?: string };
type Msg = {
  id: string; created_at: string; from_email?: string; recipient: string; subject: string; category: string;
  body_md: string; sent_by_email?: string; status: string; error?: string | null;
  events?: { type: string; at: string; detail?: string }[];
};

async function call(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {};
  if (body != null) headers['Content-Type'] = 'application/json';
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(`${API_BASE}/api/cms${path}`, {
    method, headers, body: body != null ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (res.status === 401) clearAuth();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = json?.detail;
    const err: any = new Error(typeof d === 'string' ? d : d?.message || `Request failed (${res.status})`);
    err.code = d?.code;
    throw err;
  }
  return json;
}

// The letter renderer (shared with campaigns) takes markdown-lite:
// \*\*bold\*\*, \*italic\*, [text]\(url), "- " bullets, blank-line paragraphs.
function htmlToMd(html: string): string {
  if (typeof window === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent || '';
    if (!(n instanceof HTMLElement)) return '';
    const inner = Array.from(n.childNodes).map(inline).join('');
    switch (n.tagName) {
      case 'STRONG': case 'B': return inner.trim() ? `\*\*${inner}\*\*` : inner;
      case 'EM': case 'I': return inner.trim() ? `\*${inner}\*` : inner;
      case 'A': return `[${inner}]\(${n.getAttribute('href') || ''})`;
      case 'BR': return '\n';
      default: return inner;
    }
  };
  const blocks: string[] = [];
  Array.from(doc.body.childNodes).forEach(n => {
    if (n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL')) {
      blocks.push(Array.from(n.children).map(li => `- ${inline(li).trim()}`).join('\n'));
    } else {
      const t = inline(n).trim();
      if (t) blocks.push(t);
    }
  });
  return blocks.join('\n\n');
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\\[([^\\]]+)\\]\\(((?:https?:|mailto:)[^)\s]+)\\)/g, '<a href="$2">$1</a>');
  return (md || '').split(/\n\s\*\n/).map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s\*[-\*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inl(l.replace(/^\s\*[-\*]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inl).join('<br>')}</p>`;
  }).join('');
}

const SIGNOFFS = [
  { value: 'team', label: 'The FriendPlace Team' },
  { value: 'george', label: 'George' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'garry', label: 'Garry (Founder)' },
  { value: 'none', label: 'Leave blank (no sign-off)' },
];

const newToken = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STATUS_COLOR: Record<string, string> = {
  sent: '#0F766E', delivered: '#166534', opened: '#166534', clicked: '#166534', delayed: '#B45309',
  bounced: '#B91C1C', complained: '#B91C1C', failed: '#B91C1C', sending: '#64748B',
};
const box: React.CSSProperties = { marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E2E8F0' };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 13, background: '#FFFFFF', boxSizing: 'border-box' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 800, color: '#334155', margin: '10px 0 4px' };
const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  padding: '9px 16px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
  border: primary ? 'none' : '1.5px solid #0D9488', background: disabled ? '#CBD5E1' : primary ? '#0D9488' : '#FFFFFF',
  color: primary ? '#FFFFFF' : '#0F766E',
});

export function MemberEmailPanel({ kind, memberId, memberEmail }: { kind: Kind; memberId: string; memberEmail?: string | null }) {
  const [mode, setMode] = useState<'none' | 'compose' | 'history'>('none');
  const [opts, setOpts] = useState<{ categories: Opt[]; senders: Sender[]; templates: Tpl[]; default_sender: string } | null>(null);
  const [fromEmail, setFromEmail] = useState('');
  const [category, setCategory] = useState('general');
  const [signer, setSigner] = useState('team');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [token, setToken] = useState(newToken());
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<Msg[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const catLabel = useMemo(() => Object.fromEntries((opts?.categories || []).map(c => [c.value, c.label])), [opts]);

  const loadOpts = useCallback(async () => {
    if (opts) return;
    try {
      const o = await call('GET', '/member-email/options');
      setOpts(o);
      setFromEmail(o.default_sender && o.senders.some((x: Sender) => x.address === o.default_sender) ? o.default_sender : (o.senders[0]?.address || ''));
    } catch (e: any) { setMsg(e.message); }
  }, [opts]);

  const loadHistory = useCallback(async () => {
    try { setHistory((await call('GET', `/member-email/${kind}/${memberId}/history`)).emails || []); }
    catch (e: any) { setMsg(e.message); }
  }, [kind, memberId]);

  useEffect(() => { if (mode === 'compose') void loadOpts(); if (mode === 'history') void loadHistory(); }, [mode, loadOpts, loadHistory]);

  const payload = (extra: Record<string, any> = {}) => ({
    from_email: fromEmail, category, subject, body_md: htmlToMd(bodyHtml), signer, client_token: token, ...extra,
  });

  const applyTemplate = (id: string) => {
    const t = opts?.templates.find(x => x.id === id);
    if (!t) return;
    if (!subject.trim()) setSubject(t.subject || t.title || '');
    setBodyHtml(mdToHtml(t.body_md || ''));
  };

  const doPreview = async () => {
    setBusy(true); setMsg(null);
    try { setPreviewHtml((await call('POST', `/member-email/${kind}/${memberId}/preview`, payload())).html); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const doSend = async () => {
    const body = htmlToMd(bodyHtml);
    if (!subject.trim() || !body.trim()) { setMsg('Please add a subject and a message.'); return; }
    setBusy(true); setMsg(null);
    try {
      const p = await call('POST', `/member-email/${kind}/${memberId}/preview`, payload());
      let confirmDup = false;
      if (p.duplicate_recent) {
        confirmDup = window.confirm('An identical email was sent to this member in the last 10 minutes.\n\nSend it again anyway?');
        if (!confirmDup) return;
      }
      const ok = window.confirm(
        `Send this email?\n\nFrom:  ${p.from_name} <${p.from_email}>\nTo:      ${p.recipient}\nSubject: ${p.subject}\nCategory: ${p.category_label}\n\n` +
        `This does not change the member's account, status or Founding Member number.`,
      );
      if (!ok) return;
      const r = await call('POST', `/member-email/${kind}/${memberId}/send`, payload({ confirm_duplicate: confirmDup }));
      setMsg(r.duplicate ? '✓ Already sent — no duplicate email was sent.' : `✓ Sent to ${r.email.recipient} from ${r.email.from_email}.`);
      setSubject(''); setBodyHtml(''); setPreviewHtml(null); setCategory('general'); setSigner('team'); setToken(newToken());
      setHistory(null);
    } catch (e: any) {
      setMsg(`Couldn't send: ${e.message}`);
      if (e.code !== 'duplicate_recent') setToken(newToken());
    } finally { setBusy(false); }
  };

  return (
    <div style={box} data-testid={`member-email-panel-${memberId}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#0A2540', marginRight: 'auto' }}>Member communications</div>
        <button data-testid={`member-email-send-${memberId}`} style={btn(mode === 'compose')} onClick={() => { setMsg(null); setMode(mode === 'compose' ? 'none' : 'compose'); }}>✉️ Send Email</button>
        <button data-testid={`member-email-history-${memberId}`} style={btn(mode === 'history')} onClick={() => { setMsg(null); setMode(mode === 'history' ? 'none' : 'history'); }}>🕘 Email History</button>
      </div>

      {msg && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: msg.startsWith('✓') ? '#166534' : '#B91C1C' }}>{msg}</div>}

      {mode === 'compose' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <div>
              <label style={label}>From</label>
              <select data-testid="member-email-from" value={fromEmail} onChange={e => setFromEmail(e.target.value)} style={input}>
                {(opts?.senders || []).map(x => <option key={x.address} value={x.address}>{x.name} &lt;{x.address}&gt;</option>)}
              </select>
            </div>
            <div>
              <label style={label}>To</label>
              <input value={memberEmail || '(no email on record)'} readOnly style={{ ...input, background: '#F8FAFC' }} />
            </div>
            <div>
              <label style={label}>Category</label>
              <select data-testid="member-email-category" value={category} onChange={e => setCategory(e.target.value)} style={input}>
                {(opts?.categories || []).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Sign-off</label>
              <select data-testid="member-email-signer" value={signer} onChange={e => setSigner(e.target.value)} style={input}>
                {SIGNOFFS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Start from an existing message (optional)</label>
              <select defaultValue="" onChange={e => { applyTemplate(e.target.value); e.target.value = ''; }} style={input}>
                <option value="">— Choose a campaign / template —</option>
                {(opts?.templates || []).map(t => <option key={t.id} value={t.id}>{t.name || t.subject || t.title || t.id}</option>)}
              </select>
            </div>
          </div>
          <label style={label}>Subject</label>
          <input data-testid="member-email-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} style={input} />
          <label style={label}>Message</label>
          <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Write your message…" minHeight={180} />
          <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
            Sent in the FriendPlace letter design with the sign-off chosen above. Bold, italic, links and bullet lists are kept.
            {signer === 'none' && ' No sign-off is added — include your own closing in the message.'}
          </div>
          {category === 'formal_warning' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '8px 10px' }}>
              Formal warning — recorded permanently in this member&apos;s Email History. It does not suspend or restrict the account.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button style={btn(false, busy)} disabled={busy} onClick={() => void doPreview()}>Preview</button>
            <button data-testid="member-email-submit" style={btn(true, busy || !memberEmail)} disabled={busy || !memberEmail} onClick={() => void doSend()}>
              {busy ? 'Working…' : 'Send Email'}
            </button>
          </div>
          {previewHtml && (
            <iframe title="Email preview" srcDoc={previewHtml} sandbox="" style={{ width: '100%', height: 520, marginTop: 12, border: '1px solid #E2E8F0', borderRadius: 10 }} />
          )}
        </div>
      )}

      {mode === 'history' && (
        <div style={{ marginTop: 10 }}>
          {!history ? <div style={{ fontSize: 12.5, color: '#64748B' }}>Loading…</div> : history.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#64748B' }}>No emails have been sent to this member from MCGS.</div>
          ) : history.map(h => (
            <div key={h.id} style={{ borderTop: '1px solid #F1F5F9', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpenId(openId === h.id ? null : h.id)}>
                {h.category === 'formal_warning' && <span style={{ fontSize: 11, fontWeight: 900, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '1px 6px' }}>⚠️ FORMAL WARNING</span>}
                <span style={{ fontWeight: 800, color: '#0A2540', fontSize: 13 }}>{h.subject}</span>
                <span style={{ fontSize: 11.5, color: STATUS_COLOR[h.status] || '#64748B', fontWeight: 800, textTransform: 'capitalize' }}>{h.status}</span>
                <span style={{ fontSize: 11.5, color: '#64748B', marginLeft: 'auto' }}>{fmt(h.created_at)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                {catLabel[h.category] || h.category} · From {h.from_email || '—'} → {h.recipient} · by {h.sent_by_email || '—'}
              </div>
              {openId === h.id && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: '#334155', whiteSpace: 'pre-wrap', background: '#F8FAFC', borderRadius: 8, padding: 10 }}>
                  {h.body_md}
                  {h.error && <div style={{ color: '#B91C1C', marginTop: 6 }}>Error: {h.error}</div>}
                  {(h.events || []).length > 0 && (
                    <div style={{ marginTop: 6, color: '#64748B' }}>
                      {(h.events || []).map((e, i) => <div key={i}>{fmt(e.at)} — {e.type.replace('email.', '')}{e.detail ? `: ${e.detail}` : ''}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}