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
import { clearAuth, getToken } from '@/lib/cms-auth';
import {
  campaignsApi,
  emailPreviewsApi,
  segmentsApi,
  type Campaign,
  type CampaignAudienceFilter,
  type Segment,
} from '@/lib/cms-api';

type Template = 'announcement' | 'community_outreach' | 'invitation' | 'welcome';

// iter164o: `community_outreach` is a UI-only variant. It shares the
// backend `announcement` template rendering, but the composer defaults
// change (team sign-off, no Founding-Member framing) so an outreach
// campaign isn't mislabelled as "Founding Member update". Server-side
// nothing new to teach — the renderer already omits the Founder pill
// when the recipient has no founder_number.
const TEMPLATE_META: Record<Template, {
  label: string; description: string; needsBody: boolean;
  serverTemplate: 'announcement' | 'invitation' | 'welcome';
  defaultSigner: 'george' | 'georgia' | 'team' | 'none';
  defaultTitle: string;
  // iter164q wiring for iter164p backend fields.
  defaultGreeting: string;
  defaultShowBadge: boolean;
}> = {
  announcement: {
    label:         'Founding Member update',
    description:   'A general-purpose letter for keeping Founding Members in the loop.',
    needsBody:     true,
    serverTemplate:'announcement',
    defaultSigner: 'george',
    defaultTitle:  'A note from FriendPlace',
    defaultGreeting: 'Dear [Contact name],',
    defaultShowBadge: true,
  },
  community_outreach: {
    label:         'Community / Outreach update',
    description:   'Business/community outreach — retirement villages, partners, and non-member contacts. Signed by The FriendPlace Team.',
    needsBody:     true,
    serverTemplate:'announcement',
    defaultSigner: 'team',
    defaultTitle:  'A note from FriendPlace',
    defaultGreeting: 'Dear [Contact name],',
    defaultShowBadge: false,
  },
  invitation: {
    label:       'Invitation',
    description: 'Personal invitation to join FriendPlace. Auto-advances recipient status to Invited.',
    needsBody:   false,
    serverTemplate:'invitation',
    defaultSigner: 'george',
    defaultTitle:  '',
    defaultGreeting: 'Dear [Contact name],',
    defaultShowBadge: true,
  },
  welcome: {
    label:       'Welcome',
    description: 'First-time welcome letter — usually sent automatically when someone joins.',
    needsBody:   false,
    serverTemplate:'welcome',
    defaultSigner: 'george',
    defaultTitle:  '',
    defaultGreeting: 'Dear [Contact name],',
    defaultShowBadge: true,
  },
};

// iter164o: signer options. `team` is the default for
// community/outreach; `none` is available for campaigns whose body
// already contains its own closing (prevents the duplicate-sign-off
// bug where "Warm regards, The FriendPlace Team" appeared twice).
type Signer = 'team' | 'george' | 'georgia' | 'none';
const SIGNER_OPTIONS: { value: Signer; label: string }[] = [
  { value: 'team',    label: 'The FriendPlace Team' },
  { value: 'george',  label: '🦋 George' },
  { value: 'georgia', label: '🦋 Georgia' },
  { value: 'none',    label: 'No additional sign-off' },
];

// iter164r: real Campaign Composer PDF attachments. The backend stores one
// PDF on the draft and keeps `attach_file` as a separate, explicit send flag.
// Keeping those two ideas separate is deliberate: uploading a flyer does NOT
// mean it will automatically be attached to outgoing mail.
type CampaignAttachmentMeta = {
  filename: string;
  content_type?: string;
  size?: number;
  uploaded_at?: string;
};

const CAMPAIGN_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

function attachmentMetaFrom(value: any): CampaignAttachmentMeta | null {
  const a = value?.attachment ?? value;
  if (!a || !a.filename) return null;
  return {
    filename: String(a.filename),
    content_type: a.content_type || a.mime_type || 'application/pdf',
    size: Number(a.size ?? a.size_bytes ?? 0) || 0,
    uploaded_at: a.uploaded_at || undefined,
  };
}

function formatAttachmentSize(bytes?: number): string {
  const n = Number(bytes || 0);
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function attachmentRequest(
  campaignId: string,
  suffix = '',
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(
    `${API_BASE}/api/cms/campaigns/${encodeURIComponent(campaignId)}/attachment${suffix}`,
    { ...init, headers, cache: 'no-store' },
  );
  if (res.status === 401) clearAuth();
  return res;
}

async function attachmentError(res: Response, fallback: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  if (!text) return new Error(fallback);
  try {
    const parsed = JSON.parse(text);
    return new Error(parsed?.detail || parsed?.error || fallback);
  } catch {
    return new Error(text || fallback);
  }
}

async function getCampaignAttachment(campaignId: string): Promise<CampaignAttachmentMeta | null> {
  const res = await attachmentRequest(campaignId);
  if (res.status === 404) return null;
  if (!res.ok) throw await attachmentError(res, `Could not load attachment (${res.status})`);
  return attachmentMetaFrom(await res.json());
}

async function uploadCampaignAttachment(campaignId: string, file: File): Promise<CampaignAttachmentMeta> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await attachmentRequest(campaignId, '', { method: 'POST', body: fd });
  if (!res.ok) throw await attachmentError(res, `Upload failed (${res.status})`);
  const meta = attachmentMetaFrom(await res.json().catch(() => ({})));
  return meta || {
    filename: file.name,
    content_type: file.type || 'application/pdf',
    size: file.size,
  };
}

async function deleteCampaignAttachment(campaignId: string): Promise<void> {
  const res = await attachmentRequest(campaignId, '', { method: 'DELETE' });
  if (!res.ok) throw await attachmentError(res, `Could not remove attachment (${res.status})`);
}

async function openCampaignAttachment(campaignId: string, filename: string): Promise<void> {
  const res = await attachmentRequest(campaignId, '/download');
  if (!res.ok) throw await attachmentError(res, `Could not download attachment (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.download = filename || 'campaign-attachment.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  // iter164o: signer expanded from {george, georgia} to
  // {team, george, georgia, none}. `team` is the default for
  // community/outreach; `none` skips any trailing sign-off so a body
  // that already contains its own closing isn't followed by a
  // duplicate boilerplate.
  const [companion, setCompanion] = useState<Signer>('george');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  // iter164o: initial title default is the friendly headline the
  // renderer used to silently insert. Placing the default in the field
  // makes it visible and editable; clearing the field now genuinely
  // means "no headline" instead of quietly restoring the default at
  // preview / send time.
  const [title, setTitle] = useState('A note from FriendPlace');
  const [bodyMd, setBodyMd] = useState('');
  // iter164q wiring for iter164p backend fields.
  //
  // greeting is a nullable string:
  //   null      -> field never touched by user; the payload passes
  //                the composer's default (see TEMPLATE_META) on save,
  //                which mirrors what the backend would render anyway.
  //   ""        -> user deliberately cleared the field. Empty greeting.
  //   any text  -> literal greeting; "[Contact name]" is substituted
  //                per-recipient by the backend at send time.
  const [greeting, setGreeting] = useState<string>('Dear [Contact name],');
  // showFounderBadge is initialised to the announcement default (ON).
  // The template <select> onChange below flips it for outreach.
  const [showFounderBadge, setShowFounderBadge] = useState<boolean>(true);
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
  const [attachment, setAttachment] = useState<CampaignAttachmentMeta | null>(null);
  const [attachFile, setAttachFile] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string, ms = 2400) => { setToast(m); setTimeout(() => setToast(null), ms); };

  // Load existing draft if editing.
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const c = await campaignsApi.get(editId);
        setName(c.name || '');
        // iter164o: `announcement` is the backend template shared by
        // the Founding-Member and Community/Outreach UI variants.
        // Choose the UI variant by the saved signer OR by audience —
        // outreach audiences bias toward the Community label.
        const backendT = (c.template || 'announcement') as string;
        const savedSigner = (c.companion || 'george') as Signer;
        const savedKindHint = (c.audience_filter as any)?.audience_kind || '';
        let uiT: Template = (backendT === 'announcement' ? 'announcement' : (backendT as Template));
        if (backendT === 'announcement' && (savedSigner === 'team' || savedKindHint === 'outreach')) {
          uiT = 'community_outreach';
        }
        setTemplate(uiT);
        setCompanion(savedSigner);
        setSubject(c.subject || '');
        setPreheader(c.preheader || '');
        // iter164o: honour the saved title verbatim (empty means the
        // author cleared it — do NOT silently substitute the default).
        setTitle(c.title ?? '');
        setBodyMd(c.body_md || '');
        // iter164q: hydrate the new fields.
        //   • saved `greeting` may be null (legacy) or "" (deliberately
        //     cleared) — both must survive round-trip. If undefined
        //     (older payload with no field), fall back to the template
        //     default so the composer still shows something.
        if (typeof c.greeting === 'string') {
          setGreeting(c.greeting);
        } else if (c.greeting === null) {
          setGreeting('');
        } else {
          setGreeting(TEMPLATE_META[uiT]?.defaultGreeting ?? 'Dear [Contact name],');
        }
        //   • saved `show_founder_badge` may be true/false/null.
        //     null (legacy) -> use template default.
        if (typeof c.show_founder_badge === 'boolean') {
          setShowFounderBadge(c.show_founder_badge);
        } else {
          setShowFounderBadge(TEMPLATE_META[uiT]?.defaultShowBadge ?? true);
        }
        setCtaLabel(c.cta_label || '');
        setCtaUrl(c.cta_url || '');
        setAttachFile(Boolean((c as any).attach_file));
        try {
          const savedAttachment = await getCampaignAttachment(editId);
          setAttachment(savedAttachment);
          if (!savedAttachment) setAttachFile(false);
        } catch {
          // Attachment metadata is non-fatal to opening the composer.
          // Keep the campaign's saved attach_file flag intact so a
          // temporary metadata request failure never silently changes it.
        }
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

  // Build the current audience payload in memory. This is used only when an
  // admin deliberately saves/sends/schedules; it must never trigger a save.
  const audienceFilter: CampaignAudienceFilter = useMemo(() => {
    if (recipientMode === 'outreach') {
      return {
        audience_kind: 'outreach_contacts',
        outreach: {
          category: outreachCategory || undefined,
          status: outreachStatus || undefined,
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
        recipient_name: individualName,
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

  // Load saved segments once for the picker.
  useEffect(() => {
    (async () => {
      try {
        const r = await segmentsApi.list();
        setSegments(r.items.map((seg) => ({
          id: seg.id,
          name: seg.name,
          emoji: seg.emoji,
          last_count: seg.last_count,
          description: seg.description,
        })));
      } catch { /* non-fatal */ }
    })();
  }, []);

  // George's segment suggestions are read-only assistance and do not save the
  // campaign. Keeping this separate protects the no-autosave invariant.
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

  // Explicit persistence path. Called only from Save Draft, Send, or Schedule.
  const saveDraft = useCallback(async (silent = false): Promise<string | null> => {
    setSaving(true);
    try {
      const serverTemplate = TEMPLATE_META[template]?.serverTemplate || 'announcement';
      const payload: Partial<Campaign> & { attach_file?: boolean } = {
        name: name || 'Untitled campaign',
        template: serverTemplate,
        subject,
        preheader,
        companion,
        title,
        body_md: bodyMd,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        audience_filter: audienceFilter,
        greeting,
        show_founder_badge: showFounderBadge,
        attach_file: attachFile,
      };
      let c: Campaign;
      if (campaignId) {
        c = await campaignsApi.update(campaignId, payload);
      } else {
        c = await campaignsApi.create(payload);
        setCampaignId(c.id);
      }
      // Explicit saves must refresh the persisted preview immediately.
      // This is NOT autosave: it only runs after Save / Send / Schedule has
      // deliberately persisted the campaign. It also fixes existing drafts
      // where campaignId does not change, so the [campaignId] preview effect
      // would otherwise keep showing stale CTA/copy.
      try {
        const a = await campaignsApi.previewAudience(c.id);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(c.id);
        setPreviewHtml(r.html || '');
      } catch { /* saving succeeded; preview refresh is non-fatal */ }
      if (!silent) showToast('Draft saved');
      return c.id;
    } catch (e: any) {
      showToast(e?.message || 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }, [campaignId, name, template, subject, preheader, companion, title, bodyMd,
      ctaLabel, ctaUrl, audienceFilter, greeting, showFounderBadge, attachFile]);

  // CAMPAIGN_INVARIANT: NO_AUTOSAVE
  // Opening or editing a campaign is READ-ONLY until the admin deliberately
  // chooses Save draft, Send campaign, or Schedule. This prevents initial
  // Founding-Member defaults racing the async draft hydration and overwriting
  // a saved Outreach/manual/individual audience.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!campaignId) {
      setAudienceCount(null);
      setPreviewHtml('');
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const a = await campaignsApi.previewAudience(campaignId);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(campaignId);
        setPreviewHtml(r.html || '');
      } catch { /* ignore transient preview errors */ }
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [campaignId]);

  const doSend = async () => {
    // CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SEND
    const id = await saveDraft(true);
    if (!id) return;
    setSending(true);
    try {
      const r = await campaignsApi.send(id);
      const noun =
        recipientMode === 'individual' ? (r.targeted === 1 ? 'recipient' : 'recipients') :
        recipientMode === 'outreach'   ? (r.targeted === 1 ? 'organisation' : 'organisations') :
        recipientMode === 'manual'     ? (r.targeted === 1 ? 'address' : 'addresses') :
                                         (r.targeted === 1 ? 'Founding Member' : 'Founding Members');
      showToast(`Sending to ${r.targeted} ${noun}…`);
      setConfirmOpen(false);
      setTimeout(() => router.push(`/admin/campaigns/${id}`), 1200);
    } catch (e: any) {
      showToast(e?.message || 'Send failed');
    } finally { setSending(false); }
  };

  const doSchedule = async (localValue: string) => {
    if (!localValue) { showToast('Pick a date and time'); return; }
    // CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SCHEDULE
    const id = await saveDraft(true);
    if (!id) return;
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
      await campaignsApi.schedule(id, iso);
      showToast('Campaign scheduled');
      setScheduleOpen(false);
      setTimeout(() => router.push('/admin/campaigns'), 800);
    } catch (e: any) {
      showToast(e?.message || 'Schedule failed');
    } finally { setSending(false); }
  };

  const handleAttachmentUpload = async (file: File | null) => {
    if (!file) return;
    const looksPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!looksPdf) {
      showToast('Please choose a PDF file');
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      return;
    }
    if (file.size > CAMPAIGN_ATTACHMENT_MAX_BYTES) {
      showToast('PDF must be 5 MB or smaller');
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      return;
    }

    // CAMPAIGN_INVARIANT: ATTACHMENT_DOES_NOT_AUTOSAVE_COPY
    if (!campaignId) {
      showToast('Save the draft first, then upload the PDF');
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      return;
    }
    const id = campaignId;
    setAttachmentBusy(true);
    try {
      const saved = await uploadCampaignAttachment(id, file);
      setAttachment(saved);
      showToast(
        attachFile
          ? 'PDF replaced — it will remain attached when sent'
          : 'PDF saved with draft — sending it is still OFF',
        3200,
      );
    } catch (e: any) {
      showToast(e?.message || 'PDF upload failed');
    } finally {
      setAttachmentBusy(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const handleAttachmentRemove = async () => {
    if (!campaignId || !attachment) return;
    setAttachmentBusy(true);
    try {
      await deleteCampaignAttachment(campaignId);
      // Be explicit even if the backend delete route also clears it.
      await campaignsApi.update(campaignId, { attach_file: false } as any);
      setAttachment(null);
      setAttachFile(false);
      showToast('PDF removed from draft');
    } catch (e: any) {
      showToast(e?.message || 'Could not remove PDF');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const handleAttachmentOpen = async () => {
    if (!campaignId || !attachment) return;
    setAttachmentBusy(true);
    try {
      await openCampaignAttachment(campaignId, attachment.filename);
    } catch (e: any) {
      showToast(e?.message || 'Could not open PDF');
    } finally {
      setAttachmentBusy(false);
    }
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
          <select value={template} onChange={e => {
            const next = e.target.value as Template;
            const prev = template;
            setTemplate(next);
            // iter164o: switching template resets the sign-off to the
            // template's default (george for founder, team for outreach)
            // AND pre-fills the title if the field is empty. Explicit
            // user edits are preserved.
            const meta = TEMPLATE_META[next];
            const prevMeta = TEMPLATE_META[prev];
            if (meta) {
              setCompanion(meta.defaultSigner);
              if (!title.trim() && meta.defaultTitle) setTitle(meta.defaultTitle);
              // iter164q: apply the new template's greeting/badge
              // defaults, but only when the current values still match
              // the previous template's defaults (i.e. the user hasn't
              // deliberately overridden them). This prevents an
              // accidental switch from wiping a hand-crafted greeting
              // or a manually-flipped badge choice.
              if (prevMeta && greeting === prevMeta.defaultGreeting) {
                setGreeting(meta.defaultGreeting);
              }
              if (prevMeta && showFounderBadge === prevMeta.defaultShowBadge) {
                setShowFounderBadge(meta.defaultShowBadge);
              }
            }
          }}
            style={{ ...s.input, width: '100%' }}>
            {Object.entries(TEMPLATE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
          <div style={s.helper}>{meta.description}</div>
        </SectionCard>

        <SectionCard title="Signed by">
          {/* iter164o: 4 signer options. `team` is the friendly default
              for community/outreach campaigns; `none` lets a body that
              already contains its own closing avoid the duplicate
              boilerplate that appeared previously. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {SIGNER_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => setCompanion(opt.value)}
                style={{
                  ...s.ghostBtn,
                  background:  companion === opt.value ? '#0F766E' : '#FFFFFF',
                  color:       companion === opt.value ? '#FFFFFF' : '#0A2540',
                  borderColor: companion === opt.value ? '#0F766E' : '#CBD5E1',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginTop: 8, lineHeight: 1.4 }}>
            The renderer appends the selected closing under your body.
            If your body already ends with its own closing (e.g. "Warm
            regards, …"), it will be replaced automatically so recipients
            see exactly one sign-off.
          </p>
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

        {(template === 'announcement' || template === 'community_outreach') && (
          <SectionCard title="Letter contents">
            <label style={s.label}>Headline (h1 in the letter)</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Leave blank for no headline"
              style={{ ...s.input, width: '100%' }} maxLength={200} />

            {/* iter164q: Greeting / Addressee. Users can edit or clear
                completely (empty string means "no greeting line"). The
                literal token [Contact name] is substituted per-recipient
                at send time by the backend. */}
            <label style={{ ...s.label, marginTop: 10 }}>Greeting / Addressee</label>
            <input value={greeting} onChange={e => setGreeting(e.target.value)}
              placeholder='e.g. "Dear [Contact name]," or leave blank for no greeting'
              style={{ ...s.input, width: '100%' }} maxLength={200} />
            <p style={{ fontSize: 12, color: '#64748B', marginTop: 4, lineHeight: 1.4 }}>
              Use <code>[Contact name]</code> to auto-fill each recipient's first
              name. Leave blank to send with no greeting line at all.
            </p>

            {/* iter164q: Show Founding Member badge. Community/Outreach
                defaults to OFF; Founding Member update defaults to ON.
                Template switching updates this only when the current
                value still matches the previous template's default. */}
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              marginTop: 12, cursor: 'pointer', userSelect: 'none',
              fontSize: 14, color: '#0A2540',
            }}>
              <input type="checkbox" checked={showFounderBadge}
                onChange={e => setShowFounderBadge(e.target.checked)}
                style={{ width: 16, height: 16 }} />
              <span>Show <b>Founding Member #xxxx</b> badge</span>
            </label>
            <p style={{ fontSize: 12, color: '#64748B', marginTop: 4, lineHeight: 1.4 }}>
              When on, recipients who have a Founding Member number see a small badge
              under the greeting. Turn off for community / outreach where recipients
              aren't Founding Members yet.
            </p>

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

        <SectionCard title="PDF attachment (optional)">
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>
            Upload one PDF up to 5 MB. It is saved with this campaign draft, but
            <strong> it will not be attached to outgoing emails unless you turn that on below.</strong>
          </p>

          <label style={s.label}>{attachment ? 'Replace PDF' : 'Choose PDF'}</label>
          <input
            ref={attachmentInputRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={attachmentBusy}
            onChange={e => void handleAttachmentUpload(e.target.files?.[0] || null)}
            data-testid="campaign-attachment-input"
            style={{ ...s.input, width: '100%', padding: 10 }}
          />

          {attachmentBusy && (
            <div style={{ ...s.helper, marginTop: 6 }}>Working with PDF…</div>
          )}

          {attachment && (
            <div style={{
              marginTop: 12, padding: 12,
              background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12,
            }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0A2540' }}>
                    📄 {attachment.filename}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {formatAttachmentSize(attachment.size) || 'PDF'}
                    {attachment.uploaded_at ? ` · saved ${new Date(attachment.uploaded_at).toLocaleString()}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => void handleAttachmentOpen()}
                    disabled={attachmentBusy} style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12 }}>
                    Open PDF
                  </button>
                  <button type="button" onClick={() => void handleAttachmentRemove()}
                    disabled={attachmentBusy} style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12, color: '#B91C1C' }}>
                    Remove
                  </button>
                </div>
              </div>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                marginTop: 14, cursor: attachmentBusy ? 'not-allowed' : 'pointer',
                fontSize: 13, color: '#0A2540', fontWeight: 700,
              }}>
                <input
                  type="checkbox"
                  checked={attachFile}
                  disabled={attachmentBusy}
                  onChange={e => setAttachFile(e.target.checked)}
                  data-testid="campaign-attach-file-toggle"
                  style={{ width: 17, height: 17, marginTop: 1 }}
                />
                <span>Attach this PDF to outgoing emails</span>
              </label>

              <div style={{
                marginTop: 8, padding: '9px 11px', borderRadius: 10,
                background: attachFile ? '#FEF3C7' : '#ECFDF5',
                color: attachFile ? '#92400E' : '#166534',
                fontSize: 12, lineHeight: 1.45, fontWeight: 650,
              }}>
                {attachFile
                  ? 'ON — each recipient will receive this PDF as an attachment. Attachments can slightly affect deliverability.'
                  : 'OFF — the PDF stays saved with the draft but will not be sent. This is the default.'}
              </div>
            </div>
          )}

          {!attachment && (
            <div style={{ ...s.helper, marginTop: 7 }}>
              PDF only · maximum 5 MB · sending as an attachment stays OFF until you choose otherwise.
            </div>
          )}
        </SectionCard>

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
              {/*
                iter161b: category is a labelled dropdown with human-friendly
                labels ("Retirement village") that stores the canonical
                snake_case key ("retirement_village"). Backend also
                normalises free-form input, so future clients typing
                "retirement village" still match — this UI just avoids
                typing altogether.
              */}
              <select style={s.input} value={outreachCategory}
                onChange={(e) => setOutreachCategory(e.target.value)}
                data-testid="outreach-category-select">
                <option value="">— any category —</option>
                <option value="retirement_village">Retirement village</option>
                <option value="community_centre">Community centre</option>
                <option value="library_council">Library</option>
                <option value="council">Council</option>
                <option value="club">Club</option>
                <option value="church">Church</option>
                <option value="aged_care">Aged care</option>
                <option value="advocacy_group">Advocacy group</option>
                <option value="other">Other</option>
              </select>
              <label style={s.label}>Status (optional)</label>
              <select style={s.input} value={outreachStatus} onChange={(e) => setOutreachStatus(e.target.value)}
                data-testid="outreach-status-select">
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
                  { key: 'registered', label: 'Registered (awaiting invitation)' },
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
          <div style={{ ...s.label, marginBottom: 8 }}>Saved preview</div>
          <div style={{
            border: '1px solid #E2E8F0', borderRadius: 18, overflow: 'hidden',
            background: '#FFFFFF', height: 720,
          }}>
            <iframe
              title="Campaign preview"
              srcDoc={previewHtml || '<div style="padding:24px;color:#94A3B8;font-family:sans-serif">Preview appears here as you compose.</div>'}
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>
          <div style={s.helper}>
            Shows the last saved draft, personalised with a real recipient. Save draft to refresh it.
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
          attachment={attachment}
          attachFile={attachFile}
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
  attachment, attachFile,
  sending, onCancel, onConfirm,
}: {
  name: string; templateLabel: string; companion: string; audienceCount: number;
  recipientMode: 'segment' | 'custom' | 'outreach' | 'manual' | 'individual';
  segment: { id: string; name: string; emoji?: string | null; last_count?: number; description?: string | null } | null;
  statuses: string[]; tagsAny: string[];
  outreachCategory: string; outreachStatus: string;
  manualList: string;
  individualEmail: string; individualName: string;
  attachment: CampaignAttachmentMeta | null;
  attachFile: boolean;
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
                  ? <>Category: <strong>{humanCategoryLabel(outreachCategory)}</strong></>
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

        <div style={rowLabel}>Signed by</div>
        <div style={rowValue}>{
          companion === 'team'    ? 'The FriendPlace Team' :
          companion === 'georgia' ? 'Georgia' :
          companion === 'none'    ? 'No additional sign-off' :
                                    'George'
        }</div>

        <div style={rowLabel}>PDF attachment</div>
        <div style={rowValue}>
          {!attachment
            ? 'None'
            : attachFile
              ? `📎 ${attachment.filename} — WILL be attached`
              : `📄 ${attachment.filename} — saved only, NOT attached`}
        </div>

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

// iter161b (25 Feb 2026): show human-friendly labels in the confirm
// modal ("Retirement village") rather than the raw snake_case key.
// The backend still stores/queries the canonical key.
function humanCategoryLabel(key: string): string {
  if (!key) return '';
  const parts = key.replace(/-/g, '_').split('_').filter(Boolean);
  if (parts.length === 0) return '';
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(),
          ...rest.map(p => p.toLowerCase())].join(' ');
}
