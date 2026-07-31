'use client';

/**
 * Admin ▸ Emails ▸ Template preview & test-send
 *
 * A single-pane, one-purpose console for reviewing every FriendPlace
 * transactional email in the same room:
 *   • All five templates in a left rail (Welcome / Waitlist /
 *     Invitation / Password reset / Support ack).
 *   • Editable subject + preheader for whichever is selected.
 *   • For personal emails: a George ↔ Georgia toggle so we can see
 *     both companions' voices land in exactly the same shell.
 *   • Desktop AND mobile viewport previews rendered side-by-side in
 *     iframes so we can spot layout issues before we hit send.
 *   • Light AND dark mode preview (dark simulates Gmail dark theme:
 *     the shell stays white because email clients preserve that,
 *     but the surrounding chrome flips so we can eyeball contrast).
 *   • Responsive validation panel — subject length, preheader
 *     length, "personal signer named" — must pass before Send Test
 *     is enabled.
 *   • One-click "Send test to hello@friendplace.com.au" with a
 *     [TEST] prefix on the subject so it can never be confused with
 *     a real production email.
 *
 * All rendering happens server-side via `/api/cms/email-previews/*`
 * so the same HTML that gets sent through Resend is what you see in
 * the iframe. There's no separate "preview renderer" that can drift.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { getToken } from '@/lib/cms-auth';
import { API_BASE } from '@/lib/api-base';
import {
  emailPreviewsApi,
  type EmailPreviewList,
  type EmailTemplateMeta,
  type EmailRenderResponse,
} from '@/lib/cms-api';

type Companion = 'george' | 'georgia';
type Mode = 'light' | 'dark';

export default function AdminEmailsPage() {
  return (
    <AdminShell title="Emails">
      <EmailsPanel />
    </AdminShell>
  );
}

function EmailsPanel() {
  const [list, setList] = useState<EmailPreviewList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('welcome');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [companion, setCompanion] = useState<Companion>('george');
  const [mode, setMode] = useState<Mode>('light');
  const [rendered, setRendered] = useState<EmailRenderResponse | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<
    | { kind: 'idle' }
    | {
        kind: 'success';
        recipient: string;
        subject: string;
        sender?: string;
        messageId?: string | null;
        httpStatus?: number | null;
        deliveryNote?: string | null;
      }
    | {
        kind: 'error';
        message: string;
        httpStatus?: number | null;
        errorCode?: string | null;
        recipient?: string;
        subject?: string;
      }
  >({ kind: 'idle' });

  // ── Initial load ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await emailPreviewsApi.list();
        if (cancelled) return;
        setList(data);
        // Prime the fields from the first template's defaults so the
        // panel is immediately editable.
        const first = data.templates[0];
        if (first) {
          setSelectedName(first.name);
          setSubject(first.default_subject);
          setPreheader(first.default_preheader);
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'Failed to load templates');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo<EmailTemplateMeta | undefined>(
    () => list?.templates.find((t) => t.name === selectedName),
    [list, selectedName],
  );

  // ── When the selection changes, reset editable fields to the
  //    template's defaults so the panel doesn't carry over one
  //    template's subject to another accidentally. Companion is
  //    preserved across selections (visitor's chosen guide is a
  //    single global preference, not per-template). ───────────────
  useEffect(() => {
    if (!selected) return;
    setSubject(selected.default_subject);
    setPreheader(selected.default_preheader);
    setRendered(null);
    setSendStatus({ kind: 'idle' });
  }, [selected?.name]);

  // ── Debounced server render whenever a field changes ──────────
  // The server owns rendering (same code path as production sends)
  // so the iframe preview is always exact. We debounce ~250ms so
  // typing in the subject field doesn't spam the backend.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await emailPreviewsApi.render(selected.name, {
          companion: selected.category === 'personal' ? companion : undefined,
          subject,
          preheader,
        });
        setRendered(r);
        setRenderError(null);
      } catch (e: any) {
        setRenderError(e?.message || 'Failed to render');
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [selected?.name, selected?.category, subject, preheader, companion]);

  // ── Validation ─────────────────────────────────────────────────
  // Hard bounds informed by mail-client norms (Gmail truncates
  // subjects at ~70 chars on desktop, ~40 on mobile; preheader
  // fully truncates around 100). These are treated as warnings not
  // blockers, but the Send button won't fire while there's an
  // *error* (empty subject, missing signer in personal, etc.).
  const validation = useMemo(() => {
    const issues: Array<{ level: 'error' | 'warn' | 'ok'; msg: string }> = [];
    const subj = subject.trim();
    const pre = preheader.trim();
    if (!subj) issues.push({ level: 'error', msg: 'Subject cannot be empty.' });
    else if (subj.length > 78) issues.push({ level: 'warn', msg: `Subject is ${subj.length} chars — Gmail truncates around 70.` });
    else issues.push({ level: 'ok', msg: `Subject length: ${subj.length} chars` });
    if (!pre) issues.push({ level: 'warn', msg: 'Preheader is empty — inbox previews will fall back to the first body line.' });
    else if (pre.length > 100) issues.push({ level: 'warn', msg: `Preheader is ${pre.length} chars — clients truncate around 90.` });
    else issues.push({ level: 'ok', msg: `Preheader length: ${pre.length} chars` });
    if (selected?.category === 'personal') {
      const wanted = companion === 'georgia' ? 'Georgia' : 'George';
      if (rendered && !rendered.html.includes(`>${wanted}<`)) {
        issues.push({ level: 'error', msg: `Signer "${wanted}" is missing from the rendered letter.` });
      } else if (rendered) {
        issues.push({ level: 'ok', msg: `Signed by ${wanted}.` });
      }
    }
    const hasError = issues.some((i) => i.level === 'error');
    return { issues, hasError };
  }, [subject, preheader, selected, companion, rendered]);

  // ── Send test ──────────────────────────────────────────────────
  const onSend = useCallback(async () => {
    if (!selected || validation.hasError) return;
    setSending(true);
    setSendStatus({ kind: 'idle' });
    try {
      const r = await emailPreviewsApi.send(selected.name, {
        companion: selected.category === 'personal' ? companion : undefined,
        subject,
        preheader,
      });
      // Honest success guard: only report "Sent" when the backend
      // both flagged ok=true AND Resend returned a message ID. A
      // missing message ID means the API refused the request
      // (network hiccup, sender validation, etc.) — never claim
      // success in that case.
      if (r.ok && r.message_id) {
        setSendStatus({
          kind: 'success',
          recipient: r.recipient,
          subject: r.subject,
          sender: r.sender,
          messageId: r.message_id,
          httpStatus: r.http_status ?? null,
          deliveryNote: r.delivery_note ?? null,
        });
      } else {
        setSendStatus({
          kind: 'error',
          message: r.reason || 'Resend did not return a message ID.',
          httpStatus: r.http_status ?? null,
          errorCode: r.error_code ?? null,
          recipient: r.recipient,
          subject: r.subject,
        });
      }
    } catch (e: any) {
      setSendStatus({ kind: 'error', message: e?.message || 'Send failed.' });
    } finally {
      setSending(false);
    }
  }, [selected, subject, preheader, companion, validation.hasError]);

  // ── Iframe URL — server-rendered HTML, gated by JWT via query ──
  const iframeSrc = useMemo(() => {
    if (!selected) return '';
    const token = getToken() || '';
    const qs = new URLSearchParams({
      token,
      subject,
      preheader,
    });
    if (selected.category === 'personal') qs.set('companion', companion);
    return `${API_BASE}/api/cms/email-previews/${selected.name}.html?${qs.toString()}`;
  }, [selected, subject, preheader, companion]);

  // ── Renders ─────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
        <p style={{ margin: 0, color: '#991B1B', fontWeight: 700 }}>Couldn&rsquo;t load templates</p>
        <p style={{ marginTop: 8, marginBottom: 0, color: '#7F1D1D', fontSize: 14 }}>{loadError}</p>
      </div>
    );
  }

  if (!list) {
    return <p style={{ color: '#64748B' }}>Loading templates&hellip;</p>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
      {/* ── Left rail: template list ──────────────────────────── */}
      <aside style={{ ...card, padding: '12px 0', position: 'sticky', top: 24 }}>
        <div style={{ padding: '10px 16px 6px', color: '#64748B', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Templates
        </div>
        {list.templates.map((t) => {
          const active = t.name === selectedName;
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => setSelectedName(t.name)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                background: active ? '#F0FDFA' : 'transparent',
                borderLeft: `3px solid ${active ? '#14B8A6' : 'transparent'}`,
                border: 0,
                borderLeftWidth: 3,
                borderLeftStyle: 'solid',
                borderLeftColor: active ? '#14B8A6' : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 14 }}>{t.label}</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                {t.category === 'personal' ? 'Personal · Companion' : 'Operational · Team'}
              </div>
            </button>
          );
        })}
        <div style={{ padding: '14px 16px 8px', borderTop: '1px solid #E2E8F0', marginTop: 6, fontSize: 12, color: '#64748B' }}>
          Test recipient
          <div style={{ marginTop: 4, color: '#0A2540', fontWeight: 700 }}>{list.recipient}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: list.resend_configured ? '#0F766E' : '#B45309' }}>
            {list.resend_configured ? '● Resend configured' : '⚠ Resend not configured'}
          </div>
        </div>
      </aside>

      {/* ── Right pane: controls + previews ───────────────────── */}
      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Header + description */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 22, color: '#0A2540', fontWeight: 900 }}>{selected.label}</h2>
              <span style={pill(selected.category === 'personal' ? '#F0FDFA' : '#EEF2FF', selected.category === 'personal' ? '#0F766E' : '#3730A3')}>
                {selected.category === 'personal' ? 'Personal · signed by companion' : 'Operational · signed by team'}
              </span>
            </div>
            <p style={{ margin: '10px 0 0 0', color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
              {selected.description}
            </p>
          </div>

          {/* Editable fields */}
          <div style={card}>
            <FieldRow label="Subject" hint="Shown in the inbox row. Aim for ≤ 70 characters.">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                style={inputStyle}
                spellCheck
              />
            </FieldRow>

            <FieldRow label="Preview text (preheader)" hint="The tiny line next to the subject in most inboxes. ≤ 90 chars.">
              <input
                type="text"
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                style={inputStyle}
                spellCheck
              />
            </FieldRow>

            {selected.category === 'personal' && (
              <FieldRow label="Signed by" hint="Which companion is writing this letter.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <ToggleBtn
                    active={companion === 'george'}
                    onClick={() => setCompanion('george')}
                    label="George"
                  />
                  <ToggleBtn
                    active={companion === 'georgia'}
                    onClick={() => setCompanion('georgia')}
                    label="Georgia"
                  />
                </div>
              </FieldRow>
            )}

            <FieldRow label="Preview mode" hint="Simulates dark-theme email clients (Gmail dark, iOS Mail dark).">
              <div style={{ display: 'flex', gap: 8 }}>
                <ToggleBtn active={mode === 'light'} onClick={() => setMode('light')} label="Light" />
                <ToggleBtn active={mode === 'dark'} onClick={() => setMode('dark')} label="Dark" />
              </div>
            </FieldRow>
          </div>

          {/* Validation */}
          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0A2540' }}>Responsive validation</h3>
              <span style={pill(
                validation.hasError ? '#FEF2F2' : '#F0FDFA',
                validation.hasError ? '#991B1B' : '#0F766E',
              )}>
                {validation.hasError ? 'Fix before sending' : 'Ready to send'}
              </span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {validation.issues.map((it, idx) => (
                <li key={idx} style={{
                  fontSize: 13,
                  color: it.level === 'error' ? '#991B1B' : it.level === 'warn' ? '#B45309' : '#0F766E',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <span aria-hidden style={{ fontSize: 12 }}>
                    {it.level === 'error' ? '⨯' : it.level === 'warn' ? '⚠' : '✓'}
                  </span>
                  {it.msg}
                </li>
              ))}
              {renderError && (
                <li style={{ fontSize: 13, color: '#991B1B' }}>⨯ Render error: {renderError}</li>
              )}
            </ul>
          </div>

          {/* Preview iframes */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0A2540' }}>
                  Desktop &amp; mobile preview
                </h3>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                  Server-rendered — this is exactly what Resend will deliver.
                </div>
              </div>
              {rendered && (
                <div style={{ fontSize: 12, color: '#64748B', textAlign: 'right' }}>
                  <div><strong style={{ color: '#0A2540' }}>Subject:</strong> {rendered.subject}</div>
                  <div style={{ marginTop: 2 }}><strong style={{ color: '#0A2540' }}>Preheader:</strong> {rendered.preheader}</div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
              {/* Desktop */}
              <PreviewFrame label="Desktop · 720w" mode={mode} widthPx={720} heightPx={780} src={iframeSrc} />
              {/* Mobile */}
              <PreviewFrame label="Mobile · 375w" mode={mode} widthPx={375} heightPx={780} src={iframeSrc} />
            </div>
          </div>

          {/* Send test */}
          <div style={{
            ...card,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 14, color: '#475569', maxWidth: 520 }}>
              This will send a <code style={inlineCode}>[TEST]</code>-prefixed copy of the current preview
              to <strong style={{ color: '#0A2540' }}>{list.recipient}</strong> via Resend. Nothing else is affected.
            </div>
            <button
              type="button"
              onClick={onSend}
              disabled={sending || validation.hasError || !list.resend_configured}
              style={{
                ...primaryBtn,
                opacity: (sending || validation.hasError || !list.resend_configured) ? 0.55 : 1,
                cursor: (sending || validation.hasError || !list.resend_configured) ? 'not-allowed' : 'pointer',
              }}
            >
              {sending ? 'Sending…' : `Send test to ${list.recipient}`}
            </button>
          </div>

          {sendStatus.kind === 'success' && (
            <div style={{ ...card, background: '#F0FDFA', borderColor: '#99F6E4' }}>
              <p style={{ margin: 0, color: '#0F766E', fontWeight: 800, fontSize: 15 }}>
                Resend accepted the message ✓
              </p>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 14px', fontSize: 13, color: '#0F766E' }}>
                <div style={{ fontWeight: 700 }}>Subject</div>
                <div><code style={inlineCode}>{sendStatus.subject}</code></div>
                <div style={{ fontWeight: 700 }}>To</div>
                <div><strong>{sendStatus.recipient}</strong></div>
                {sendStatus.sender && <>
                  <div style={{ fontWeight: 700 }}>From</div>
                  <div>{sendStatus.sender}</div>
                </>}
                <div style={{ fontWeight: 700 }}>HTTP status</div>
                <div>{sendStatus.httpStatus ?? '—'}</div>
                <div style={{ fontWeight: 700 }}>Message ID</div>
                <div><code style={{ ...inlineCode, fontSize: 11 }}>{sendStatus.messageId}</code></div>
              </div>
              {sendStatus.deliveryNote && (
                <p style={{
                  margin: '14px 0 0 0',
                  padding: '10px 12px',
                  background: '#FEFCE8',
                  border: '1px solid #FDE68A',
                  borderRadius: 8,
                  color: '#78350F',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}>
                  <strong>Note:</strong> {sendStatus.deliveryNote} If the
                  email does not appear in the inbox, check the Resend
                  dashboard for <code style={{ ...inlineCode, fontSize: 11 }}>{sendStatus.messageId}</code> — status will be
                  one of <em>Sent · Queued · Delivered · Bounced · Rejected</em>.
                  Common causes of a Sent-but-not-received: spam/junk
                  folder, DMARC/SPF misalignment, or the mailbox filtering
                  same-domain sends.
                </p>
              )}
            </div>
          )}
          {sendStatus.kind === 'error' && (
            <div style={{ ...card, background: '#FEF2F2', borderColor: '#FCA5A5' }}>
              <p style={{ margin: 0, color: '#991B1B', fontWeight: 800, fontSize: 15 }}>
                Send failed
              </p>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 14px', fontSize: 13, color: '#7F1D1D' }}>
                <div style={{ fontWeight: 700 }}>Error</div>
                <div>{sendStatus.message}</div>
                {sendStatus.errorCode && <>
                  <div style={{ fontWeight: 700 }}>Error code</div>
                  <div><code style={inlineCode}>{sendStatus.errorCode}</code></div>
                </>}
                {typeof sendStatus.httpStatus === 'number' && <>
                  <div style={{ fontWeight: 700 }}>HTTP status</div>
                  <div>{sendStatus.httpStatus}</div>
                </>}
                {sendStatus.recipient && <>
                  <div style={{ fontWeight: 700 }}>Attempted to</div>
                  <div>{sendStatus.recipient}</div>
                </>}
                {sendStatus.subject && <>
                  <div style={{ fontWeight: 700 }}>Subject</div>
                  <div><code style={inlineCode}>{sendStatus.subject}</code></div>
                </>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Small subcomponents ────────────────────────────────────────────────
function FieldRow({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ marginTop: 4, fontSize: 12, color: '#94A3B8' }}>{hint}</div>}
    </div>
  );
}

function ToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px',
        borderRadius: 999,
        border: `1.5px solid ${active ? '#14B8A6' : '#CBD5E1'}`,
        background: active ? '#F0FDFA' : '#FFFFFF',
        color: active ? '#0F766E' : '#475569',
        fontWeight: 700,
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function PreviewFrame({
  label, mode, widthPx, heightPx, src,
}: { label: string; mode: Mode; widthPx: number; heightPx: number; src: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <div style={{
        borderRadius: 14,
        background: mode === 'dark' ? '#1F2937' : '#F1F5F9',
        padding: 12,
        border: `1px solid ${mode === 'dark' ? '#334155' : '#E2E8F0'}`,
        transition: 'background 220ms ease, border-color 220ms ease',
      }}>
        <iframe
          key={`${src}-${widthPx}`}     /* force reflow when width changes */
          src={src}
          title={label}
          style={{
            width: widthPx,
            maxWidth: '100%',
            height: heightPx,
            border: '0',
            display: 'block',
            margin: '0 auto',
            background: '#FFFFFF',
            borderRadius: 8,
            boxShadow: mode === 'dark'
              ? '0 6px 20px rgba(0,0,0,0.45)'
              : '0 4px 14px rgba(15, 23, 42, 0.06)',
          }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 14,
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid #CBD5E1',
  borderRadius: 10,
  fontSize: 14,
  fontFamily: 'inherit',
  color: '#0A2540',
  outlineColor: '#14B8A6',
};

const primaryBtn: React.CSSProperties = {
  padding: '12px 20px',
  borderRadius: 10,
  background: '#14B8A6',
  color: '#FFFFFF',
  fontWeight: 800,
  fontSize: 14,
  border: 0,
  fontFamily: 'inherit',
  boxShadow: '0 6px 16px rgba(20, 184, 166, 0.25)',
};

const inlineCode: React.CSSProperties = {
  background: '#F1F5F9',
  padding: '2px 6px',
  borderRadius: 6,
  fontFamily: '"SF Mono", Menlo, Consolas, monospace',
  fontSize: 12,
  color: '#0A2540',
};

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 700,
  };
}
