'use client';

/**
 * Campaigns → New / Edit compose page.
 *
 * The whole compose flow lives here:
 *   1. Choose template + audience + subject/preheader/body
 *   2. See a live preview rendered with the first real recipient
 *   3. Save Draft (redirects to list) or Send Campaign (opens confirm modal)
 *
 * The confirm modal is deliberate: it shows the campaign name, audience,
 * recipient count, template and companion — one last chance to catch
 * mistakes before hitting the network.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { API_BASE } from '@/lib/api-base';
import {
  campaignsApi,
  emailPreviewsApi,
  segmentsApi,
  type Campaign,
  type CampaignAudienceFilter,
  type Segment,
} from '@/lib/cms-api';

type Template = 'announcement' | 'invitation' | 'welcome';

const TEMPLATE_META: Record<Template, { label: string; description: string; needsBody: boolean }> = {
  announcement: {
    label:       'Founding Member update',
    description: 'A general-purpose letter for keeping Founding Members in the loop.',
    needsBody:   true,
  },
  invitation: {
    label:       'Invitation',
    description: 'Personal invitation to join FriendPlace. Auto-advances recipient status to Invited.',
    needsBody:   false,
  },
  welcome: {
    label:       'Welcome',
    description: 'First-time welcome letter — usually sent automatically when someone joins.',
    needsBody:   false,
  },
};

export default function NewCampaignPage() {
  return (
    <AdminShell title="Compose campaign">
      <Suspense fallback={<div>Loading…</div>}>
        <ComposePanel />
      </Suspense>
    </AdminShell>
  );
}

function ComposePanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('id') || null;

  const [name, setName] = useState('');
  const [template, setTemplate] = useState<Template>('announcement');
  const [companion, setCompanion] = useState<'george' | 'georgia'>('george');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [statuses, setStatuses] = useState<Array<'registered' | 'invited' | 'joined'>>(['registered', 'invited']);
  const [tagsAny, setTagsAny] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  // CRM Phase 2C \u2014 recipient mode toggle. `segment` uses a saved
  // segment; `custom` falls back to the classic statuses + tags builder.
  const [recipientMode, setRecipientMode] = useState<'segment' | 'custom' | 'outreach' | 'manual' | 'individual'>(
    (searchParams?.get('segment_id') ? 'segment' : 'custom'),
  );
  const [segmentId, setSegmentId] = useState<string>(searchParams?.get('segment_id') || '');
  const [segments, setSegments] = useState<Array<{ id: string; name: string; emoji?: string | null; last_count?: number; description?: string | null }> | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; emoji?: string | null; count?: number; confidence: number }>>([]);

  // iter160a — new audience modes: outreach, manual list, individual.
  const [outreachCategory, setOutreachCategory] = useState('');
  const [outreachStatus,   setOutreachStatus]   = useState('');
  const [manualList,       setManualList]       = useState('');
  const [individualEmail,  setIndividualEmail]  = useState('');
  const [individualName,   setIndividualName]   = useState('');

  const [campaignId, setCampaignId] = useState<string | null>(editId);
  const [saving, setSaving] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string, ms = 2400) => { setToast(m); setTimeout(() => setToast(null), ms); };

  // Load existing draft if editing.
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const c = await campaignsApi.get(editId);
        setName(c.name || '');
        setTemplate((c.template || 'announcement') as Template);
        setCompanion((c.companion || 'george') as any);
        setSubject(c.subject || '');
        setPreheader(c.preheader || '');
        setTitle(c.title || '');
        setBodyMd(c.body_md || '');
        setCtaLabel(c.cta_label || '');
        setCtaUrl(c.cta_url || '');
        const st = (c.audience_filter?.statuses || []) as any;
        setStatuses(st.length ? st : ['registered', 'invited']);
        setTagsAny(c.audience_filter?.tags_any || []);

        // iter160a — restore ALL five audience modes so reopening a
        // draft doesn't silently downgrade an Outreach/manual/individual
        // campaign back to "Custom filter (Founding Members)".
        //
        // Precedence:
        //   1. audience_kind (canonical since iter160a)
        //   2. segment_id fallback (drafts from Phase 2C before kind
        //      existed)
        //   3. default -> 'custom'
        const af: any = c.audience_filter || {};
        const kind: string | undefined = af.audience_kind;
        if (kind === 'outreach_contacts') {
          setRecipientMode('outreach');
          setOutreachCategory(af.outreach?.category || '');
          setOutreachStatus(af.outreach?.status || '');
        } else if (kind === 'manual_list') {
          setRecipientMode('manual');
          // The API may return either the raw string the admin pasted
          // OR a normalised array of {email,name} — support both.
          if (typeof af.manual_recipients === 'string') {
            setManualList(af.manual_recipients);
          } else if (Array.isArray(af.manual_recipients)) {
            setManualList(af.manual_recipients.map((r: any) => (
              typeof r === 'string' ? r
                : r?.name ? `${r.name} | ${r.email || ''}`
                : (r?.email || '')
            )).filter(Boolean).join('\n'));
          }
        } else if (kind === 'individual') {
          setRecipientMode('individual');
          setIndividualEmail(af.recipient_email || '');
          setIndividualName(af.recipient_name || '');
        } else if (af.segment_id) {
          setSegmentId(af.segment_id);
          setRecipientMode('segment');
        } else {
          // Explicit fallback so re-opening a plain FM draft keeps
          // showing the Custom filter panel.
          setRecipientMode('custom');
        }
      } catch (e: any) {
        showToast(e?.message || 'Could not load campaign');
      }
    })();
  }, [editId]);

  // Debounced auto-save-as-draft, and auto-refresh audience count + preview
  const audienceFilter: CampaignAudienceFilter = useMemo(() => {
    // iter160a — 5 audience kinds sent as `audience_kind` on the filter.
    if (recipientMode === 'outreach') {
      return {
        audience_kind: 'outreach_contacts',
        outreach: {
          category: outreachCategory || undefined,
          status:   outreachStatus || undefined,
        },
      } as any;
    }
    if (recipientMode === 'manual') {
      return {
        audience_kind: 'manual_list',
        manual_recipients: manualList,
      } as any;
    }
    if (recipientMode === 'individual') {
      return {
        audience_kind: 'individual',
        recipient_email: individualEmail,
        recipient_name:  individualName,
      } as any;
    }
    return recipientMode === 'segment'
      ? {
          segment_id: segmentId || undefined,
          exclude_reserved: true,
          exclude_opted_out: true,
        }
      : {
          statuses,
          tags_any: tagsAny,
          exclude_reserved: true,
          exclude_opted_out: true,
        };
  }, [recipientMode, segmentId, statuses, tagsAny,
      outreachCategory, outreachStatus, manualList, individualEmail, individualName]);

  // Load saved segments once (for the picker) and refresh George's
  // suggestions as the draft's copy changes.
  useEffect(() => {
    (async () => {
      try {
        const r = await segmentsApi.list();
        setSegments(r.items.map((s) => ({
          id: s.id, name: s.name, emoji: s.emoji, last_count: s.last_count, description: s.description,
        })));
      } catch { /* non-fatal */ }
    })();
  }, []);

  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (recipientMode !== 'custom' && recipientMode !== 'segment') return;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      if (!subject && !bodyMd && !title) { setSuggestions([]); return; }
      try {
        const r = await segmentsApi.suggest({ subject, title, body_md: bodyMd, preheader });
        setSuggestions(r.suggestions);
      } catch { /* silent */ }
    }, 600);
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
  }, [subject, title, bodyMd, preheader, recipientMode]);

  const saveDraft = useCallback(async (silent = false): Promise<string | null> => {
    setSaving(true);
    try {
      const payload: Partial<Campaign> = {
        name: name || 'Untitled campaign',
        template, subject, preheader, companion,
        title, body_md: bodyMd,
        cta_label: ctaLabel, cta_url: ctaUrl,
        audience_filter: audienceFilter,
      };
      let c: Campaign;
      if (campaignId) {
        c = await campaignsApi.update(campaignId, payload);
      } else {
        c = await campaignsApi.create(payload);
        setCampaignId(c.id);
      }
      if (!silent) showToast('Draft saved');
      return c.id;
    } catch (e: any) {
      showToast(e?.message || 'Save failed');
      return null;
    } finally { setSaving(false); }
  }, [campaignId, name, template, subject, preheader, companion, title, bodyMd, ctaLabel, ctaUrl, audienceFilter]);

  // Refresh preview + audience count whenever the important fields change.
  // iter161 bug: the outreach / manual / individual selectors were missing
  // from this dependency array, so switching Outreach category or status
  // (or editing the manual list / individual email) never re-fired the
  // draft save + preview. The audience count would freeze on whatever
  // was computed the first time the effect ran (Garry, 25 Feb 2026:
  // "40 retirement villages imported, filter still shows 6").
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      // iter161 bug: previously this was `campaignId || await saveDraft(true)`
      // which short-circuited AFTER the first save — so subsequent
      // outreach/manual/individual edits never PATCHed the draft to the
      // backend, and `preview-audience` kept reading the stale filter.
      // Always save first (create OR update), then preview so the count
      // reflects the current in-memory filter.
      const id = await saveDraft(true);
      if (!id) return;
      try {
        const a = await campaignsApi.previewAudience(id);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(id);
        setPreviewHtml(r.html || '');
      } catch { /* ignore transient errors */ }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [
    name, template, subject, preheader, companion, title, bodyMd, ctaLabel, ctaUrl,
    // Founding-Member custom filter
    statuses, tagsAny,
    // Mode + saved segment
    recipientMode, segmentId,
    // iter161: Outreach / Manual / Individual selectors (previously missing)
    outreachCategory, outreachStatus,
    manualList,
    individualEmail, individualName,
    campaignId, saveDraft,
  ]);

  const doSend = async () => {
    if (!campaignId) {
      const id = await saveDraft(true);
      if (!id) return;
    }
    setSending(true);
    try {
      const r = await campaignsApi.send(campaignId!);
      const noun =
        recipientMode === 'individual' ? (r.targeted === 1 ? 'recipient' : 'recipients') :
        recipientMode === 'outreach'   ? (r.targeted === 1 ? 'organisation' : 'organisations') :
        recipientMode === 'manual'     ? (r.targeted === 1 ? 'address' : 'addresses') :
                                         (r.targeted === 1 ? 'Founding Member' : 'Founding Members');
      showToast(`Sending to ${r.targeted} ${noun}…`);
      setConfirmOpen(false);
      setTimeout(() => router.push(`/admin/campaigns/${campaignId}`), 1200);
    } catch (e: any) {
      showToast(e?.message || 'Send failed');
    } finally { setSending(false); }
  };

  const doSchedule = async (localValue: string) => {
    if (!campaignId) {
      const id = await saveDraft(true);
      if (!id) return;
    }
    if (!localValue) { showToast('Pick a date and time'); return; }
    // datetime-local returns YYYY-MM-DDTHH:MM in the user's local
    // timezone. Convert to a proper ISO string so the backend can
    // parse it unambiguously.
    let iso: string;
    try {
      iso = new Date(localValue).toISOString();
    } catch {
      showToast('That date/time is not valid');
      return;
    }
    setSending(true);
    try {
      await campaignsApi.schedule(campaignId!, iso);
      showToast('Campaign scheduled');
      setScheduleOpen(false);
      setTimeout(() => router.push('/admin/campaigns'), 800);
    } catch (e: any) {
      showToast(e?.message || 'Schedule failed');
    } finally { setSending(false); }
  };

  const toggleStatus = (s: 'registered' | 'invited' | 'joined') => {
    setStatuses(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tagsAny.includes(t)) { setTagInput(''); return; }
    setTagsAny([...tagsAny, t]);
    setTagInput('');
  };

  const meta = TEMPLATE_META[template];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 24 }}>
      {/* Compose column */}
      <div>
        <SectionCard title="Campaign name">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. August progress update"
            style={{ ...s.input, width: '100%' }} maxLength={200} />
        </SectionCard>

        <SectionCard title="Template">
          <select value={template} onChange={e => setTemplate(e.target.value as Template)}
            style={{ ...s.input, width: '100%' }}>
            {Object.entries(TEMPLATE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
          <div style={s.helper}>{meta.description}</div>
        </SectionCard>

        <SectionCard title="Signed by">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['george', 'georgia'] as const).map(c => (
              <button key={c} type="button" onClick={() => setCompanion(c)}
                style={{
                  ...s.ghostBtn, flex: 1,
                  background: companion === c ? '#0F766E' : '#FFFFFF',
                  color:      companion === c ? '#FFFFFF' : '#0A2540',
                  borderColor: companion === c ? '#0F766E' : '#CBD5E1',
                }}>
                {c === 'george' ? '🦋 George' : '🦋 Georgia'}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Subject & preheader">
          <label style={s.label}>Subject line</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Leave blank to use the template default"
            style={{ ...s.input, width: '100%' }} maxLength={200} />
          <label style={{ ...s.label, marginTop: 10 }}>Preheader (inbox preview)</label>
          <input value={preheader} onChange={e => setPreheader(e.target.value)}
            placeholder="Optional — the short line under the subject in the inbox"
            style={{ ...s.input, width: '100%' }} maxLength={200} />
        </SectionCard>

        {template === 'announcement' && (
          <SectionCard title="Letter contents">
            <label style={s.label}>Headline (h1 in the letter)</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. A gentle update from FriendPlace"
              style={{ ...s.input, width: '100%' }} maxLength={200} />
            <label style={{ ...s.label, marginTop: 10 }}>Body</label>
            <textarea value={bodyMd} onChange={e => setBodyMd(e.target.value)}
              placeholder="Write the letter. Blank lines start new paragraphs."
              style={{ ...s.textarea, minHeight: 180 }} maxLength={20000} />
            <label style={{ ...s.label, marginTop: 10 }}>Call-to-action (optional)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)}
                placeholder="Button label" style={{ ...s.input, flex: '1 1 0' }} maxLength={60} />
              <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)}
                placeholder="https://…" style={{ ...s.input, flex: '1.4 1 0' }} maxLength={500} />
            </div>
          </SectionCard>
        )}

        <SectionCard title="Audience">
          {/* CRM Phase 2C — Recipient mode toggle */}
          <label style={s.label}>Recipient</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {([
              { key: 'segment',    label: 'Saved segment',      hint: 'Pick a group you have already defined' },
              { key: 'custom',     label: 'Custom filter',      hint: 'Filter Founding Members by status + tags' },
              { key: 'outreach',   label: 'Outreach contacts',  hint: 'External orgs from Outreach CRM' },
              { key: 'manual',     label: 'Manual list',        hint: 'Paste addresses one per line' },
              { key: 'individual', label: 'Individual',         hint: 'One recipient only' },
            ] as const).map(opt => {
              const on = recipientMode === opt.key;
              return (
                <button key={opt.key} type="button" onClick={() => setRecipientMode(opt.key)}
                  data-testid={`audience-mode-${opt.key}`}
                  style={{
                    ...s.ghostBtn, flex: '1 1 180px', padding: '10px 12px', textAlign: 'left',
                    background: on ? '#F0FDFA' : '#FFFFFF',
                    color:      on ? '#0F766E' : '#0A2540',
                    borderColor: on ? '#0F766E' : '#CBD5E1', fontWeight: 700,
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  }}>
                  <span style={{ fontSize: 13 }}>{on ? '●' : '○'} {opt.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: on ? '#0F766E' : '#64748B' }}>{opt.hint}</span>
                </button>
              );
            })}
          </div>

          {/* iter160a — Outreach contacts mode */}
          {recipientMode === 'outreach' && (
            <div style={{ marginTop: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14 }}>
              <label style={s.label}>Category (optional)</label>
              <input style={s.input} value={outreachCategory}
                onChange={(e) => setOutreachCategory(e.target.value)}
                placeholder="e.g. retirement_village — leave blank for all" />
              <label style={s.label}>Status (optional)</label>
              <select style={s.input} value={outreachStatus} onChange={(e) => setOutreachStatus(e.target.value)}>
                <option value="">— any status —</option>
                <option value="not_contacted">Not contacted</option>
                <option value="contacted">Contacted</option>
                <option value="awaiting_reply">Awaiting our reply</option>
                <option value="replied">Replied</option>
                <option value="declined">Declined</option>
              </select>
              <p style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>
                Sends one personalised email to each organisation matching the filter. Manage the list under <a href="/admin/outreach" style={{ color: '#0F766E', fontWeight: 700 }}>Outreach</a>.
              </p>
            </div>
          )}

          {/* iter160a — Manual list mode */}
          {recipientMode === 'manual' && (
            <div style={{ marginTop: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14 }}>
              <label style={s.label}>Recipients — one per line</label>
              <textarea
                style={{ ...s.input, minHeight: 160, fontFamily: 'inherit', resize: 'vertical' }}
                value={manualList}
                onChange={(e) => setManualList(e.target.value)}
                placeholder={"jane@example.com\nJohn Smith | john@example.com\nHillside Village <reception@hillside.example.com>"}
                data-testid="manual-recipients-textarea"
              />
              <p style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
                Each recipient gets a <strong>separate</strong> email — nobody sees anyone else&rsquo;s address.
                Formats: <code>email</code>, <code>Name | email</code>, or <code>Name &lt;email&gt;</code>.
              </p>
            </div>
          )}

          {/* iter160a — Individual mode */}
          {recipientMode === 'individual' && (
            <div style={{ marginTop: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14 }}>
              <label style={s.label}>Recipient name</label>
              <input style={s.input} value={individualName}
                onChange={(e) => setIndividualName(e.target.value)} placeholder="Jane Smith" />
              <label style={s.label}>Recipient email</label>
              <input style={s.input} type="email" value={individualEmail}
                onChange={(e) => setIndividualEmail(e.target.value)} placeholder="jane@example.com" />
              <p style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>
                Tip: for a quick 1:1 reply from an enquiry, use the Reply button on the Enquiries page instead — it opens the simpler Send Email screen.
              </p>
            </div>
          )}

          {/* George's segment suggestions (only in segment mode & only when George found ideas) */}
          {recipientMode === 'segment' && suggestions.length > 0 && (
            <div style={{ marginTop: 14, padding: 10,
              background: '#F5F3FF', border: '1px dashed #C4B5FD', borderRadius: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                fontWeight: 800, color: '#6D28D9', marginBottom: 6 }}>
                🦋 George quietly thinks these fit
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {suggestions.map(sg => (
                  <button key={sg.id} type="button" onClick={() => setSegmentId(sg.id)}
                    style={{
                      ...s.ghostBtn, padding: '6px 10px', fontSize: 12, borderRadius: 999,
                      background: segmentId === sg.id ? '#EDE9FE' : '#FFFFFF',
                      color: '#5B21B6', borderColor: '#C4B5FD', fontWeight: 700,
                    }}>
                    {sg.emoji ? `${sg.emoji} ` : ''}{sg.name}
                    {typeof sg.count === 'number' ? ` · ${sg.count}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Segment mode — dropdown picker */}
          {recipientMode === 'segment' && (
            <div style={{ marginTop: 14 }}>
              <label style={s.label}>Segment</label>
              <select value={segmentId} onChange={e => setSegmentId(e.target.value)}
                style={{ ...s.input, width: '100%' }}>
                <option value="">— Choose a saved segment —</option>
                {(segments || []).map(sg => (
                  <option key={sg.id} value={sg.id}>
                    {sg.emoji ? `${sg.emoji} ` : ''}{sg.name}
                    {typeof sg.last_count === 'number' ? `  ·  ${sg.last_count} members` : ''}
                  </option>
                ))}
              </select>
              {segmentId && (() => {
                const sg = (segments || []).find(x => x.id === segmentId);
                if (!sg) return null;
                return (
                  <div style={{ ...s.helper, marginTop: 6 }}>
                    {sg.description || 'This segment’s live audience will be used at send time.'}
                    {' '}
                    <a href={`/admin/segments/${sg.id}`} target="_blank" rel="noreferrer"
                      style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
                      View →
                    </a>
                  </div>
                );
              })()}
              {segments && segments.length === 0 && (
                <div style={{ ...s.helper, marginTop: 6 }}>
                  No saved segments yet.{' '}
                  <a href="/admin/segments/new" target="_blank" rel="noreferrer"
                    style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>
                    Create your first segment →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Custom mode — classic statuses + tags builder */}
          {recipientMode === 'custom' && (
            <>
              <label style={{ ...s.label, marginTop: 14 }}>Status</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([
                  { key: 'registered', label: 'Registered (awaiting contact)' },
                  { key: 'invited',    label: 'Invited' },
                  { key: 'joined',     label: 'Joined' },
                ] as const).map(sv => {
                  const on = statuses.includes(sv.key as any);
                  return (
                    <button key={sv.key} type="button" onClick={() => toggleStatus(sv.key)}
                      style={{
                        ...s.ghostBtn, padding: '6px 12px', fontSize: 12,
                        background: on ? '#F0FDFA' : '#FFFFFF',
                        color:      on ? '#0F766E' : '#0A2540',
                        borderColor: on ? '#0F766E' : '#CBD5E1', fontWeight: 700,
                      }}>
                      {on ? '✓ ' : ''}{sv.label}
                    </button>
                  );
                })}
              </div>
              <div style={s.helper}>
                Leave all unticked to reach every Founding Member (except opt-outs and the two reserved slots).
              </div>

              <label style={{ ...s.label, marginTop: 14 }}>Tags (any match)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 8px',
                background: '#FFFFFF', border: '1.5px solid #CBD5E1', borderRadius: 12, minHeight: 40 }}>
                {tagsAny.map(t => (
                  <span key={t} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', background: '#E0F2FE', color: '#075985',
                    borderRadius: 999, fontSize: 11, fontWeight: 700,
                  }}>
                    {t}
                    <button type="button" onClick={() => setTagsAny(tagsAny.filter(x => x !== t))}
                      style={{ background: 'transparent', border: 'none', color: '#075985', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                  </span>
                ))}
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                  placeholder={tagsAny.length ? '' : 'Enter to add — e.g. sydney'}
                  style={{ border: 'none', outline: 'none', fontSize: 13, flex: '1 1 120px', minWidth: 120, background: 'transparent' }} />
              </div>
            </>
          )}

          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: '#0F766E', fontWeight: 700 }}>
              {recipientMode === 'segment' ? 'Recipients in this segment' : 'Recipients matching filter'}
            </span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#0F766E', fontVariantNumeric: 'tabular-nums' }}>
              {recipientMode === 'segment' && !segmentId ? '—' : (audienceCount === null ? '…' : audienceCount)}
            </span>
          </div>
        </SectionCard>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          {(() => {
            const missingSegment = recipientMode === 'segment' && !segmentId;
            const cannotSend = !campaignId || !audienceCount || audienceCount === 0 || missingSegment;
            return (
              <>
                <button type="button" onClick={() => void saveDraft()} disabled={saving}
                  style={{ ...s.ghostBtn, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button type="button" onClick={() => setScheduleOpen(true)}
                  disabled={cannotSend}
                  style={{
                    ...s.ghostBtn,
                    opacity: cannotSend ? 0.5 : 1,
                    cursor:  cannotSend ? 'not-allowed' : 'pointer',
                  }}>
                  ⏰ Schedule…
                </button>
                <button type="button" onClick={() => setConfirmOpen(true)}
                  disabled={cannotSend}
                  style={{
                    ...s.primaryBtn,
                    opacity: cannotSend ? 0.5 : 1,
                    cursor:  cannotSend ? 'not-allowed' : 'pointer',
                  }}>
                  Send campaign…
                </button>
                {missingSegment && (
                  <span style={{ color: '#B91C1C', fontSize: 12 }}>Pick a saved segment above to enable sending.</span>
                )}
                {!missingSegment && audienceCount === 0 && (
                  <span style={{ color: '#94A3B8', fontSize: 12 }}>Nothing to send — audience is empty.</span>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Preview column */}
      <div>
        <div style={{ position: 'sticky', top: 20 }}>
          <div style={{ ...s.label, marginBottom: 8 }}>Live preview</div>
          <div style={{
            border: '1px solid #E2E8F0', borderRadius: 18, overflow: 'hidden',
            background: '#FFFFFF', height: 720,
          }}>
            <iframe
              title="Campaign preview"
              srcDoc={previewHtml || '<div style="padding:24px;color:#94A3B8;font-family:sans-serif">Preview appears here as you compose.</div>'}
              sandbox=""
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>
          <div style={s.helper}>
            Personalised with the first real recipient in the audience — same rendering path the send worker uses.
          </div>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmModal
          name={name || 'Untitled campaign'}
          templateLabel={meta.label}
          companion={companion}
          audienceCount={audienceCount ?? 0}
          recipientMode={recipientMode}
          segment={recipientMode === 'segment'
            ? (segments || []).find(x => x.id === segmentId) || null
            : null}
          statuses={statuses}
          tagsAny={tagsAny}
          outreachCategory={outreachCategory}
          outreachStatus={outreachStatus}
          manualList={manualList}
          individualEmail={individualEmail}
          individualName={individualName}
          sending={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doSend()}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal
          name={name || 'Untitled campaign'}
          audienceCount={audienceCount ?? 0}
          recipientMode={recipientMode}
          sending={sending}
          onCancel={() => setScheduleOpen(false)}
          onConfirm={doSchedule}
        />
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E2E8F0',
      borderRadius: 16, padding: 18, marginBottom: 14,
    }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
        fontWeight: 800, color: '#0F766E', marginBottom: 12,
      }}>{title}</div>
      {children}
    </div>
  );
}

function ConfirmModal({
  name, templateLabel, companion, audienceCount, recipientMode, segment,
  statuses, tagsAny,
  outreachCategory, outreachStatus, manualList, individualEmail, individualName,
  sending, onCancel, onConfirm,
}: {
  name: string; templateLabel: string; companion: string; audienceCount: number;
  recipientMode: 'segment' | 'custom' | 'outreach' | 'manual' | 'individual';
  segment: { id: string; name: string; emoji?: string | null; last_count?: number; description?: string | null } | null;
  statuses: string[]; tagsAny: string[];
  outreachCategory: string; outreachStatus: string;
  manualList: string;
  individualEmail: string; individualName: string;
  sending: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  // Noun used for the recipient count + warning line. Keeps the copy
  // truthful for every audience mode instead of always saying
  // "Founding Member(s)".
  const noun =
    recipientMode === 'individual' ? { one: 'recipient',    many: 'recipients'    } :
    recipientMode === 'outreach'   ? { one: 'organisation', many: 'organisations' } :
    recipientMode === 'manual'     ? { one: 'address',      many: 'addresses'     } :
                                     { one: 'email',        many: 'emails'        };
  const manualPreview = (manualList || '')
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20,
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: 22, padding: 30,
        maxWidth: 520, width: '100%',
        boxShadow: '0 40px 80px rgba(15,23,42,0.35)',
      }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
          fontWeight: 800, color: '#0F766E',
        }}>Confirm campaign send</div>
        <h2 style={{ margin: '6px 0 20px 0', fontSize: 22, color: '#0A2540' }}>{name}</h2>

        <div style={rowLabel}>Audience</div>
        <div style={rowValue}>
          {recipientMode === 'segment' && (
            segment ? (
              <div>
                {segment.emoji ? `${segment.emoji} ` : ''}Saved segment: <strong>{segment.name}</strong>
                {segment.description ? (
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginTop: 4 }}>
                    {segment.description}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ color: '#B91C1C' }}>⚠ No segment chosen</div>
            )
          )}

          {recipientMode === 'custom' && (
            <>
              {statuses.length === 0 ? (
                <div>✓ All Founding Members</div>
              ) : (
                statuses.map(sv => (
                  <div key={sv}>✓ {sv.charAt(0).toUpperCase() + sv.slice(1)}</div>
                ))
              )}
              {tagsAny.map(t => <div key={t}>✓ Tag: {t}</div>)}
            </>
          )}

          {recipientMode === 'outreach' && (
            <>
              <div>🏢 Outreach organisations</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginTop: 4 }}>
                {outreachCategory
                  ? <>Category: <strong>{outreachCategory.replace(/_/g, ' ')}</strong></>
                  : <>Any category</>}
                {' · '}
                {outreachStatus
                  ? <>Status: <strong>{outreachStatus.replace(/_/g, ' ')}</strong></>
                  : <>Any status</>}
              </div>
            </>
          )}

          {recipientMode === 'manual' && (
            <>
              <div>📋 Manual list</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginTop: 4 }}>
                {manualPreview.length === 0
                  ? <span style={{ color: '#B91C1C' }}>⚠ List is empty</span>
                  : <>{manualPreview.length} {manualPreview.length === 1 ? 'address' : 'addresses'} pasted
                      {manualPreview.length <= 3 && (
                        <> · {manualPreview.join(', ')}</>
                      )}
                    </>}
              </div>
            </>
          )}

          {recipientMode === 'individual' && (
            <>
              <div>👤 Individual recipient</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginTop: 4 }}>
                {individualEmail
                  ? <><strong>{individualName || '(no name)'}</strong> · {individualEmail}</>
                  : <span style={{ color: '#B91C1C' }}>⚠ No recipient set</span>}
              </div>
            </>
          )}
        </div>

        <div style={rowLabel}>Recipients</div>
        <div style={{ ...rowValue, fontSize: 32, fontWeight: 900, color: '#0F766E' }}>
          {audienceCount}
        </div>

        <div style={rowLabel}>Template</div>
        <div style={rowValue}>{templateLabel}</div>

        <div style={rowLabel}>Companion</div>
        <div style={rowValue}>{companion === 'georgia' ? 'Georgia' : 'George'}</div>

        <div style={{
          marginTop: 20, padding: 14,
          background: '#FEF3C7', borderRadius: 12,
          fontSize: 13, color: '#92400E', fontWeight: 700,
        }}>
          This action will immediately send {audienceCount} {audienceCount === 1 ? noun.one : noun.many}.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={sending} style={s.ghostBtn}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={sending}
            style={{ ...s.primaryBtn, opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : 'Send campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({
  name, audienceCount, recipientMode, sending, onCancel, onConfirm,
}: {
  name: string; audienceCount: number;
  recipientMode: 'segment' | 'custom' | 'outreach' | 'manual' | 'individual';
  sending: boolean;
  onCancel: () => void;
  onConfirm: (localValue: string) => void;
}) {
  // Default to "one hour from now", rounded to the next 15 minutes.
  const [value, setValue] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    // datetime-local wants local time in YYYY-MM-DDTHH:MM (no tz)
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const recipientLabel =
    recipientMode === 'individual' ? (audienceCount === 1 ? 'recipient'    : 'recipients')    :
    recipientMode === 'outreach'   ? (audienceCount === 1 ? 'organisation' : 'organisations') :
    recipientMode === 'manual'     ? (audienceCount === 1 ? 'address'      : 'addresses')     :
    recipientMode === 'segment'    ? (audienceCount === 1 ? 'recipient'    : 'recipients')    :
                                     (audienceCount === 1 ? 'Founding Member' : 'Founding Members');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20,
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: 22, padding: 30,
        maxWidth: 480, width: '100%',
        boxShadow: '0 40px 80px rgba(15,23,42,0.35)',
      }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
          fontWeight: 800, color: '#3730A3',
        }}>Schedule campaign</div>
        <h2 style={{ margin: '6px 0 20px 0', fontSize: 22, color: '#0A2540' }}>{name}</h2>

        <div style={{ ...s.label, marginBottom: 6 }}>Send on</div>
        <input type="datetime-local" value={value}
          onChange={e => setValue(e.target.value)}
          style={{ ...s.input, width: '100%' }} />
        <div style={s.helper}>
          Times are in your local timezone. The campaign will wait quietly in the list
          until then, and can be edited or cancelled anytime beforehand.
        </div>

        <div style={{
          marginTop: 18, padding: 12,
          background: '#EEF2FF', borderRadius: 12,
          fontSize: 13, color: '#3730A3', fontWeight: 700,
        }}>
          When the time arrives, this will send to {audienceCount} {recipientLabel}.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={sending} style={s.ghostBtn}>Cancel</button>
          <button type="button" onClick={() => onConfirm(value)} disabled={sending}
            style={{ ...s.primaryBtn, opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Scheduling…' : '⏰ Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

const rowLabel: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  fontWeight: 800, color: '#64748B', marginTop: 14,
};
const rowValue: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: '#0A2540', marginTop: 4, lineHeight: 1.6,
};
