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
  type EmailMessageStatus,
  type EmailSendingHealth,
} from '@/lib/cms-api';

type Companion = 'george' | 'georgia';
type Mode = 'light' | 'dark';

export default function AdminEmailsPage() {
  return (
    <AdminShell title="Email templates">
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
        dashboardUrl?: string | null;
        live?: EmailMessageStatus | null;
        timeline: Array<{ label: string; tone: 'success' | 'pending' | 'error' | 'unknown'; at: string }>;
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

  // Sending health — polled once on mount + refreshed after every send
  const [health, setHealth] = useState<EmailSendingHealth | null>(null);
  const refreshHealth = useCallback(async () => {
    try {
      const h = await emailPreviewsApi.sendingHealth();
      setHealth(h);
    } catch {
      // Non-fatal — the sidebar just shows "unavailable" in that case.
    }
  }, []);
  useEffect(() => { void refreshHealth(); }, [refreshHealth]);

  // Live status polling — after a Send Test succeeds, we poll every
  // 2s for up to 30s (or until the message reaches a terminal state).
  // Each poll appends to a small in-memory timeline so operators can
  // see how long each hop took (Accepted → Sent → Delivered / etc.).
  const pollAbort = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => () => {
    if (pollAbort.current) pollAbort.current.cancelled = true;
  }, []);

  const beginStatusPoll = useCallback((messageId: string) => {
    if (pollAbort.current) pollAbort.current.cancelled = true;
    const token = { cancelled: false };
    pollAbort.current = token;
    const started = Date.now();
    const MAX_MS = 30_000;
    const INTERVAL_MS = 2_000;
    const terminal = new Set(['delivered', 'bounced', 'rejected', 'complained', 'opened', 'clicked']);

    let seenLabels = new Set<string>();
    const tick = async () => {
      if (token.cancelled) return;
      try {
        const live = await emailPreviewsApi.status(messageId);
        setSendStatus((prev) => {
          if (prev.kind !== 'success' || prev.messageId !== messageId) return prev;
          const nextTimeline = [...prev.timeline];
          if (live.status_label && !seenLabels.has(live.status_label)) {
            seenLabels.add(live.status_label);
            nextTimeline.push({
              label: live.status_label,
              tone: live.status_tone,
              at: new Date().toISOString(),
            });
          }
          return { ...prev, live, timeline: nextTimeline };
        });
        if (live.last_event && terminal.has(live.last_event)) {
          void refreshHealth();
          return;
        }
      } catch {
        // swallow; keep polling
      }
      if (Date.now() - started >= MAX_MS) {
        void refreshHealth();
        return;
      }
      setTimeout(() => { void tick(); }, INTERVAL_MS);
    };
    // First poll immediately (no wait) so operators see "Accepted"
    // land instantly, then hand off to the ticker.
    void tick();
  }, [refreshHealth]);

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
        const seed = {
          kind: 'success' as const,
          recipient: r.recipient,
          subject: r.subject,
          sender: r.sender,
          messageId: r.message_id,
          httpStatus: r.http_status ?? null,
          deliveryNote: r.delivery_note ?? null,
          dashboardUrl: r.dashboard_url ?? `https://resend.com/emails/${r.message_id}`,
          live: null,
          timeline: [
            { label: 'Accepted', tone: 'pending' as const, at: new Date().toISOString() },
          ],
        };
        setSendStatus(seed);
        // Kick off the live poll immediately.
        beginStatusPoll(r.message_id);
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
        </div>
      </aside>

      {/* ── Right pane: controls + previews ───────────────────── */}
      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Sending Health — at-a-glance email system indicator */}
          <SendingHealthPanel health={health} onRefresh={refreshHealth} />

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
              {(() => {
                const live = sendStatus.live;
                const isDelivered = live?.last_event === 'delivered' || live?.last_event === 'opened' || live?.last_event === 'clicked';
                const isFailed = live?.last_event === 'bounced' || live?.last_event === 'rejected' || live?.last_event === 'complained';
                const heading = isDelivered ? 'Delivered ✓' : isFailed ? (live?.status_label || 'Failed') : 'Sending…';
                const headingColor = isDelivered ? '#0F766E' : isFailed ? '#991B1B' : '#0F766E';
                return <p style={{ margin: 0, color: headingColor, fontWeight: 800, fontSize: 15 }}>{heading}</p>;
              })()}

              {/* Timeline of status transitions */}
              {sendStatus.timeline.length > 0 && (
                <div style={{ marginTop: 12, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {sendStatus.timeline.map((step, idx) => {
                    const t = new Date(step.at);
                    const timeStr = t.toLocaleTimeString([], { hour12: false });
                    const toneColor = step.tone === 'success' ? '#0F766E' : step.tone === 'error' ? '#991B1B' : step.tone === 'pending' ? '#B45309' : '#64748B';
                    const toneBg = step.tone === 'success' ? '#F0FDFA' : step.tone === 'error' ? '#FEF2F2' : step.tone === 'pending' ? '#FEFCE8' : '#F1F5F9';
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {idx > 0 && <span style={{ color: '#94A3B8', fontSize: 13 }}>→</span>}
                        <span style={{
                          padding: '4px 10px', borderRadius: 999, background: toneBg,
                          color: toneColor, fontSize: 12, fontWeight: 700,
                          border: `1px solid ${toneColor}22`,
                        }}>
                          {step.label}
                          <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 500 }}>{timeStr}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 14px', fontSize: 13, color: '#0F766E' }}>
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
                <div>
                  <code style={{ ...inlineCode, fontSize: 11 }}>{sendStatus.messageId}</code>
                  {sendStatus.dashboardUrl && (
                    <a
                      href={sendStatus.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        marginLeft: 10, fontSize: 12, fontWeight: 700,
                        color: '#0F766E', textDecoration: 'none',
                      }}
                    >
                      View in Resend →
                    </a>
                  )}
                </div>
                {sendStatus.live?.ses_message_id && (
                  <>
                    <div style={{ fontWeight: 700 }}>Envelope-ID</div>
                    <div><code style={{ ...inlineCode, fontSize: 10 }}>{sendStatus.live.ses_message_id}</code></div>
                  </>
                )}
              </div>

              {sendStatus.live?.last_event === 'bounced' || sendStatus.live?.last_event === 'rejected' ? (
                <p style={{
                  margin: '14px 0 0 0', padding: '10px 12px',
                  background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8,
                  color: '#7F1D1D', fontSize: 12, lineHeight: 1.55,
                }}>
                  <strong>{sendStatus.live.status_label}.</strong> {sendStatus.live.error || 'Resend reported a delivery failure. Open "View in Resend →" above for the full event log with the bounce reason.'}
                </p>
              ) : sendStatus.live?.last_event === 'delivered' ? (
                <p style={{
                  margin: '14px 0 0 0', padding: '10px 12px',
                  background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8,
                  color: '#065F46', fontSize: 12, lineHeight: 1.55,
                }}>
                  <strong>Delivered to {sendStatus.recipient}.</strong> The recipient mail server accepted the message. If it&rsquo;s not visible in the inbox, check Spam / Junk, Quarantine, or any forwarding / filter rules — same-domain sends are frequently spam-filtered.
                </p>
              ) : (
                <p style={{
                  margin: '14px 0 0 0', padding: '10px 12px',
                  background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 8,
                  color: '#78350F', fontSize: 12, lineHeight: 1.55,
                }}>
                  Polling delivery status every 2 s for up to 30 s. Message states usually resolve within a few seconds.
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


// ─── Sending Health panel ───────────────────────────────────────────────
//
// At-a-glance indicator for the email system, per Garry's brief:
//   🟢 Email System Healthy    — everything green
//   🟠 Needs Attention         — sending works but a check is warning
//   🔴 Broken                  — sending is failing
//
// Individual checks render below the headline so an operator can see
// exactly WHICH check flipped the light — no need to open logs.
function SendingHealthPanel({
  health,
  onRefresh,
}: {
  health: EmailSendingHealth | null;
  onRefresh: () => void;
}) {
  if (!health) {
    return (
      <div style={{
        background: '#FFFFFF', border: '1px solid #E2E8F0',
        borderRadius: 14, padding: 16, color: '#64748B', fontSize: 13,
      }}>
        Checking email system health&hellip;
      </div>
    );
  }
  const overallStyles = {
    healthy: {
      icon: '🟢',
      title: 'Email System Healthy',
      color: '#065F46',
      bg: '#ECFDF5',
      border: '#A7F3D0',
    },
    needs_attention: {
      icon: '🟠',
      title: 'Needs Attention',
      color: '#78350F',
      bg: '#FEFCE8',
      border: '#FDE68A',
    },
    broken: {
      icon: '🔴',
      title: 'Email System Broken',
      color: '#7F1D1D',
      bg: '#FEF2F2',
      border: '#FCA5A5',
    },
  }[health.overall];

  const iconFor = (state: 'healthy' | 'needs_attention' | 'broken') => (
    state === 'healthy' ? '✓' : state === 'needs_attention' ? '⚠' : '⨯'
  );
  const colorFor = (state: 'healthy' | 'needs_attention' | 'broken') => (
    state === 'healthy' ? '#0F766E' : state === 'needs_attention' ? '#B45309' : '#991B1B'
  );

  return (
    <div style={{
      background: overallStyles.bg, border: `1px solid ${overallStyles.border}`,
      borderRadius: 14, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 22 }}>{overallStyles.icon}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: overallStyles.color }}>
            {overallStyles.title}
          </div>
          <div style={{ fontSize: 12, color: overallStyles.color, opacity: 0.75, marginTop: 2 }}>
            Sending to <strong>{health.recipient}</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            padding: '6px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.6)',
            border: `1px solid ${overallStyles.border}`,
            color: overallStyles.color, fontWeight: 700, fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Refresh
        </button>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
        {health.checks.map((c, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
            <span style={{ color: colorFor(c.state), fontWeight: 800, minWidth: 14 }}>{iconFor(c.state)}</span>
            <div style={{ flex: 1, color: overallStyles.color }}>
              <span style={{ fontWeight: 700 }}>{c.label}</span>
              {c.detail && <span style={{ marginLeft: 6, opacity: 0.75 }}>· {c.detail}</span>}
              {c.dashboard_url && (
                <a
                  href={c.dashboard_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginLeft: 8, color: colorFor(c.state), fontWeight: 700, textDecoration: 'none', fontSize: 12 }}
                >
                  View →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
