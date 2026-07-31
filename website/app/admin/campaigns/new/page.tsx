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
  type Campaign,
  type CampaignAudienceFilter,
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
      } catch (e: any) {
        showToast(e?.message || 'Could not load campaign');
      }
    })();
  }, [editId]);

  // Debounced auto-save-as-draft, and auto-refresh audience count + preview
  const audienceFilter: CampaignAudienceFilter = useMemo(() => ({
    statuses,
    tags_any: tagsAny,
    exclude_reserved: true,
    exclude_opted_out: true,
  }), [statuses, tagsAny]);

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const id = campaignId || await saveDraft(true);
      if (!id) return;
      try {
        const a = await campaignsApi.previewAudience(id);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(id);
        setPreviewHtml(r.html || '');
      } catch { /* ignore transient errors */ }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [name, template, subject, preheader, companion, title, bodyMd, ctaLabel, ctaUrl, statuses, tagsAny, campaignId, saveDraft]);

  const doSend = async () => {
    if (!campaignId) {
      const id = await saveDraft(true);
      if (!id) return;
    }
    setSending(true);
    try {
      const r = await campaignsApi.send(campaignId!);
      showToast(`Sending to ${r.targeted} Founding Member(s)…`);
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
          <label style={s.label}>Status</label>
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

          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: '#0F766E', fontWeight: 700 }}>Recipients matching filter</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#0F766E', fontVariantNumeric: 'tabular-nums' }}>
              {audienceCount === null ? '…' : audienceCount}
            </span>
          </div>
        </SectionCard>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void saveDraft()} disabled={saving}
            style={{ ...s.ghostBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={() => setScheduleOpen(true)}
            disabled={!campaignId || !audienceCount || audienceCount === 0}
            style={{
              ...s.ghostBtn,
              opacity: (!campaignId || !audienceCount || audienceCount === 0) ? 0.5 : 1,
              cursor:  (!campaignId || !audienceCount || audienceCount === 0) ? 'not-allowed' : 'pointer',
            }}>
            ⏰ Schedule…
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)}
            disabled={!campaignId || !audienceCount || audienceCount === 0}
            style={{
              ...s.primaryBtn,
              opacity: (!campaignId || !audienceCount || audienceCount === 0) ? 0.5 : 1,
              cursor:  (!campaignId || !audienceCount || audienceCount === 0) ? 'not-allowed' : 'pointer',
            }}>
            Send campaign…
          </button>
          {audienceCount === 0 && (
            <span style={{ color: '#94A3B8', fontSize: 12 }}>Nothing to send — audience is empty.</span>
          )}
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
          statuses={statuses}
          tagsAny={tagsAny}
          sending={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doSend()}
        />
      )}

      {scheduleOpen && (
        <ScheduleModal
          name={name || 'Untitled campaign'}
          audienceCount={audienceCount ?? 0}
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
  name, templateLabel, companion, audienceCount, statuses, tagsAny, sending, onCancel, onConfirm,
}: {
  name: string; templateLabel: string; companion: string; audienceCount: number;
  statuses: string[]; tagsAny: string[]; sending: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
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
          {statuses.length === 0 ? (
            <div>✓ All Founding Members</div>
          ) : (
            statuses.map(sv => (
              <div key={sv}>✓ {sv.charAt(0).toUpperCase() + sv.slice(1)}</div>
            ))
          )}
          {tagsAny.map(t => <div key={t}>✓ Tag: {t}</div>)}
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
          This action will immediately send {audienceCount} {audienceCount === 1 ? 'email' : 'emails'}.
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
  name, audienceCount, sending, onCancel, onConfirm,
}: {
  name: string; audienceCount: number; sending: boolean;
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
          When the time arrives, this will send to {audienceCount} {audienceCount === 1 ? 'Founding Member' : 'Founding Members'}.
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
