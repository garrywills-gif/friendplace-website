'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { cmsApi, type EventRow, type EventSponsor, type EventRsvp } from '@/lib/cms-api';

const AU_TZS = [
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Hobart', 'Australia/Darwin',
];

export default function EventEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [event, setEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<null | 'cover' | { kind: 'sponsor'; idx: number }>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [rsvpCounts, setRsvpCounts] = useState<{ going: number; waitlist: number }>({ going: 0, waitlist: 0 });
  // Cancel-event modal state. Kept local to this page — a full-blown
  // confirm-dialog primitive isn't worth building for one destructive
  // action. Two-step (reason → confirm) gives a natural undo window.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const e = await cmsApi.getEvent(id);
        setEvent(e);
        const r = await cmsApi.listRsvps(id);
        setRsvps(r.items || []);
        setRsvpCounts(r.counts);
      } catch (e: any) {
        if (e?.message?.includes('not found')) setNotFound(true);
        else setToast(e?.message || 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, [id]);

  const update = (patch: Partial<EventRow>) => {
    setEvent(prev => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };
  const updateSponsor = (idx: number, patch: Partial<EventSponsor>) => {
    if (!event) return;
    const next = [...(event.sponsors || [])];
    next[idx] = { ...next[idx], ...patch };
    update({ sponsors: next });
  };
  const addSponsor = () => update({ sponsors: [...(event?.sponsors || []), { name: '', logo_url: '', website_url: '' }] });
  const removeSponsor = (idx: number) => update({ sponsors: (event?.sponsors || []).filter((_, i) => i !== idx) });

  const save = async (extra?: Partial<EventRow>): Promise<EventRow | null> => {
    if (!event) return null;
    setSaving(true);
    try {
      const patch: Partial<EventRow> = {
        title: event.title, description: event.description, body_html: event.body_html,
        cover_image_url: event.cover_image_url, starts_at: event.starts_at, ends_at: event.ends_at,
        timezone: event.timezone, is_online: event.is_online,
        venue_name: event.venue_name, venue_address: event.venue_address, venue_url: event.venue_url,
        meeting_url: event.meeting_url, capacity: event.capacity, rsvp_deadline_at: event.rsvp_deadline_at,
        cost_type: event.cost_type, cost_display: event.cost_display,
        organiser_name: event.organiser_name, organiser_contact: event.organiser_contact,
        accessibility_info: event.accessibility_info, sponsors: event.sponsors,
        status: event.status, hidden: event.hidden, ...(extra || {}),
      };
      const updated = await cmsApi.updateEvent(event.id, patch);
      setEvent(updated); setDirty(false);
      flash('Saved');
      return updated;
    } catch (e: any) { flash(`Save failed: ${e?.message || ''}`, 3200); return null; }
    finally { setSaving(false); }
  };

  const flash = (m: string, ms = 2000) => { setToast(m); setTimeout(() => setToast(null), ms); };

  const publish = async () => {
    if (!event) return;
    if (!event.title.trim()) { flash('Add a title before publishing', 2600); return; }
    if (!event.starts_at) { flash('Add a start date/time before publishing', 2600); return; }
    await save({ status: 'published', hidden: false });
    flash('Published — visible on the website');
  };
  const unpublish = async () => { await save({ status: 'draft' }); flash('Moved back to draft'); };

  const doCancelEvent = async () => {
    if (!event) return;
    setCancelling(true);
    try {
      const res = await cmsApi.cancelEvent(event.id, cancelReason.trim() || undefined);
      // Reflect the new status locally without another round-trip.
      setEvent(prev => prev ? { ...prev, status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: cancelReason.trim() } : prev);
      // Refresh the roster so cancelled RSVP pills appear straight away.
      try {
        const r = await cmsApi.listRsvps(event.id);
        setRsvps(r.items || []);
        setRsvpCounts(r.counts);
      } catch { /* non-fatal */ }
      const label = res.emailed === 1 ? '1 attendee' : `${res.emailed} attendees`;
      flash(res.emailed > 0 ? `Event cancelled — emailed ${label}` : 'Event cancelled', 3200);
      setCancelOpen(false);
      setCancelReason('');
    } catch (e: any) {
      flash(`Cancel failed: ${e?.message || 'unknown error'}`, 3200);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <AdminShell title="Event"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;
  if (notFound || !event) return (
    <AdminShell title="Not found">
      <p style={{ color: '#475569' }}>That event doesn&apos;t exist.</p>
      <Link href="/admin/events" className="cms-btn-primary" style={{ ...s.primaryBtn, textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>← Back to events</Link>
    </AdminShell>
  );

  const isPublished = event.status === 'published';
  const isCancelled = event.status === 'cancelled';
  const totalActiveRsvps = rsvpCounts.going + rsvpCounts.waitlist;

  return (
    <AdminShell>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Link href="/admin/events" style={{ color: '#14B8A6', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← All events</Link>
          <h1 style={{ fontSize: 28, color: '#0A2540', fontWeight: 900, margin: '6px 0 0' }}>{event.title || 'Untitled event'}</h1>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill status={event.status} hidden={!!event.hidden} />
            <span style={{ fontSize: 12, color: '#94A3B8', letterSpacing: '0.03em' }}>
              Created {formatDate(event.created_at)} · Last updated {formatDate(event.updated_at)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={() => setPreviewOpen(true)}>👁️ Preview</button>
          <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, opacity: saving ? 0.65 : 1 }} disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : dirty ? 'Save draft' : 'Saved ✓'}
          </button>
          {isCancelled
            ? <span style={{ padding: '10px 14px', borderRadius: 12, background: '#FEE2E2', color: '#991B1B', fontWeight: 800, fontSize: 13 }}>Event cancelled</span>
            : isPublished
              ? <>
                  <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={unpublish}>Move to draft</button>
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
                  >
                    Cancel event
                  </button>
                </>
              : <button type="button" className="cms-btn-primary" style={s.primaryBtn} onClick={publish}>🚀 Publish</button>}
        </div>
      </div>

      {/* Cancelled banner — surfaces the reason + cancelled-at so
          admins revisiting a cancelled event see the full record. */}
      {isCancelled && (
        <div style={{ marginBottom: 20, padding: 20, borderRadius: 16, background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#991B1B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>
            Cancelled {event.cancelled_at ? `· ${formatDate(event.cancelled_at)}` : ''}
          </div>
          {event.cancellation_reason ? (
            <div style={{ fontSize: 14, color: '#7F1D1D', lineHeight: 1.6 }}>
              &ldquo;{event.cancellation_reason}&rdquo;
            </div>
          ) : (
            <div style={{ fontSize: 14, color: '#7F1D1D', lineHeight: 1.6 }}>
              This event has been cancelled. All attendees have been emailed.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 24, alignItems: 'flex-start' }}>
        {/* LEFT column */}
        <div>
          {/* Basics */}
          <div style={s.card}>
            <label style={s.label}>Title</label>
            <input className="cms-input" style={{ ...s.input, fontSize: 17, fontWeight: 700 }}
                   value={event.title} onChange={e => update({ title: e.target.value })} placeholder="Sunday walk at Merewether Beach" />
            <div style={{ height: 12 }} />
            <label style={s.label}>Short description</label>
            <textarea className="cms-textarea" style={{ ...s.textarea, minHeight: 60 }}
                      value={event.description} onChange={e => update({ description: e.target.value })}
                      placeholder="A gentle 45-minute walk along the beach with morning tea after." />
            <div style={s.helper}>Shown on the events grid. Keep it warm and short.</div>
          </div>

          {/* When */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>When</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 200px', gap: 12 }}>
              <div>
                <label style={s.label}>Start</label>
                <input className="cms-input" style={s.input} type="datetime-local"
                       value={toLocalInput(event.starts_at)} onChange={e => update({ starts_at: fromLocalInput(e.target.value) })} />
              </div>
              <div>
                <label style={s.label}>End (optional)</label>
                <input className="cms-input" style={s.input} type="datetime-local"
                       value={toLocalInput(event.ends_at)} onChange={e => update({ ends_at: fromLocalInput(e.target.value) })} />
              </div>
              <div>
                <label style={s.label}>Timezone</label>
                <select className="cms-input" style={{ ...s.input, background: '#FFFFFF' }}
                        value={event.timezone || 'Australia/Sydney'} onChange={e => update({ timezone: e.target.value })}>
                  {AU_TZS.map(t => <option key={t} value={t}>{t.replace('Australia/', '')}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Where */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Where</h2>
            <ToggleRow label="Online event" hint={event.is_online ? 'Uses the meeting link below' : 'In person at a venue'}
                       checked={!!event.is_online} onChange={v => update({ is_online: v })} />
            <div style={{ height: 12 }} />
            {event.is_online ? (
              <>
                <label style={s.label}>Meeting URL</label>
                <input className="cms-input" style={s.input} value={event.meeting_url || ''}
                       onChange={e => update({ meeting_url: e.target.value })} placeholder="https://…" />
              </>
            ) : (
              <>
                <label style={s.label}>Venue name</label>
                <input className="cms-input" style={s.input} value={event.venue_name || ''}
                       onChange={e => update({ venue_name: e.target.value })} placeholder="Merewether Surf Club" />
                <div style={{ height: 12 }} />
                <label style={s.label}>Full address</label>
                <input className="cms-input" style={s.input} value={event.venue_address || ''}
                       onChange={e => update({ venue_address: e.target.value })} placeholder="1 Henderson Pde, Merewether NSW 2291" />
                <div style={{ height: 12 }} />
                <label style={s.label}>Venue / map URL (optional)</label>
                <input className="cms-input" style={s.input} value={event.venue_url || ''}
                       onChange={e => update({ venue_url: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
              </>
            )}
          </div>

          {/* Details (rich text) */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Full details</h2>
            <RichTextEditor value={event.body_html || ''} onChange={html => update({ body_html: html })}
                            placeholder="Tell people what to expect…" minHeight={220} />
          </div>

          {/* Practicalities */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Practicalities</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>Capacity</label>
                <input className="cms-input" style={s.input} type="number" min={0}
                       value={event.capacity ?? ''} placeholder="Unlimited"
                       onChange={e => update({ capacity: e.target.value === '' ? null : Number(e.target.value) })} />
                <div style={s.helper}>Leave blank for unlimited. Extra RSVPs go on the waitlist.</div>
              </div>
              <div>
                <label style={s.label}>RSVP deadline (optional)</label>
                <input className="cms-input" style={s.input} type="datetime-local"
                       value={toLocalInput(event.rsvp_deadline_at)}
                       onChange={e => update({ rsvp_deadline_at: fromLocalInput(e.target.value) })} />
              </div>
            </div>
            <div style={{ height: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>Cost</label>
                <select className="cms-input" style={{ ...s.input, background: '#FFFFFF' }}
                        value={event.cost_type} onChange={e => update({ cost_type: e.target.value as 'free' | 'paid' })}>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div>
                <label style={s.label}>Displayed as</label>
                <input className="cms-input" style={s.input} value={event.cost_display || ''}
                       onChange={e => update({ cost_display: e.target.value })}
                       placeholder={event.cost_type === 'paid' ? '$15 per person' : 'Free'} />
              </div>
            </div>
            <div style={{ height: 12 }} />
            <label style={s.label}>Accessibility notes</label>
            <textarea className="cms-textarea" style={{ ...s.textarea, minHeight: 60 }}
                      value={event.accessibility_info || ''}
                      onChange={e => update({ accessibility_info: e.target.value })}
                      placeholder="Wheelchair accessible path, seating available, quiet break area…" />
          </div>

          {/* Organiser */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Organiser</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>Name</label>
                <input className="cms-input" style={s.input} value={event.organiser_name || ''}
                       onChange={e => update({ organiser_name: e.target.value })} placeholder="Margaret" />
              </div>
              <div>
                <label style={s.label}>Contact (email or phone)</label>
                <input className="cms-input" style={s.input} value={event.organiser_contact || ''}
                       onChange={e => update({ organiser_contact: e.target.value })} placeholder="margaret@friendplace.com.au" />
              </div>
            </div>
          </div>

          {/* Sponsors repeater */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Sponsors</h2>
            {(event.sponsors || []).length === 0 && <p style={{ color: '#94A3B8', margin: 0, marginBottom: 12 }}>No sponsors yet.</p>}
            {(event.sponsors || []).map((sp, i) => (
              <div key={i} style={{ padding: 12, border: '1px solid #F1F5F9', borderRadius: 12, marginBottom: 10, display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 10, background: '#F1F5F9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 20 }}>
                  {sp.logo_url
                     
                    ? <img src={sp.logo_url.startsWith('http') ? sp.logo_url : `${process.env.NEXT_PUBLIC_API_URL || 'https://george-mcgs-cms.preview.emergentagent.com'}${sp.logo_url}`} alt={sp.name || 'Sponsor logo'} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} />
                    : '🏷️'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input className="cms-input" style={{ ...s.input, padding: '8px 10px', fontSize: 13 }} placeholder="Sponsor name" value={sp.name || ''} onChange={e => updateSponsor(i, { name: e.target.value })} />
                  <input className="cms-input" style={{ ...s.input, padding: '8px 10px', fontSize: 13 }} placeholder="Website URL" value={sp.website_url || ''} onChange={e => updateSponsor(i, { website_url: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12 }} onClick={() => setPickerFor({ kind: 'sponsor', idx: i })}>{sp.logo_url ? 'Change logo' : 'Add logo'}</button>
                  <button type="button" className="cms-btn-danger" style={{ ...s.dangerBtn, padding: '6px 10px', fontSize: 12 }} onClick={() => removeSponsor(i)}>Remove</button>
                </div>
              </div>
            ))}
            <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={addSponsor}>+ Add sponsor</button>
          </div>
        </div>

        {/* RIGHT column */}
        <div>
          {/* Cover image */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Cover image</h2>
            <CoverWell url={event.cover_image_url || ''} title={event.title} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="cms-btn-primary" style={{ ...s.primaryBtn, padding: '10px 16px', fontSize: 13, flex: 1 }} onClick={() => setPickerFor('cover')}>
                {event.cover_image_url ? 'Change image' : 'Pick from library'}
              </button>
              {event.cover_image_url && <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '10px 12px', fontSize: 13 }} onClick={() => update({ cover_image_url: '' })}>Remove</button>}
            </div>
          </div>

          {/* Visibility */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Visibility</h2>
            <ToggleRow label="Draft / Published" hint={event.status === 'published' ? 'Live on the website' : 'Not yet published'}
                       checked={event.status === 'published'} onChange={v => update({ status: v ? 'published' : 'draft' })} />
            <div style={{ height: 12 }} />
            <ToggleRow label="Hidden" hint={event.hidden ? 'Temporarily hidden even if published' : 'Visible when published'}
                       checked={!!event.hidden} onChange={v => update({ hidden: v })} />
          </div>

          {/* RSVP roster */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>RSVPs</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <RsvpStat label="Going" value={rsvpCounts.going} tone="teal" cap={event.capacity} />
              <RsvpStat label="Waitlist" value={rsvpCounts.waitlist} tone="amber" />
            </div>
            {rsvps.length === 0 ? (
              <p style={{ color: '#94A3B8', fontSize: 13, margin: 0 }}>
                No RSVPs yet. Public RSVP form ships in the next update — for now you can add people manually with the button below.
              </p>
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {rsvps.map(r => (
                  <div key={r.id} style={{ padding: '8px 10px', borderRadius: 10, background: '#F8FAFC', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name || r.email || 'Anonymous'}
                      </div>
                      {r.email && <div style={{ fontSize: 11, color: '#94A3B8' }}>{r.email}</div>}
                    </div>
                    <RsvpStatusPill status={r.status} />
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, width: '100%' }}
                      onClick={async () => {
                        const name = window.prompt('Name');
                        if (!name) return;
                        const email = window.prompt('Email (optional)') || '';
                        try {
                          const created = await cmsApi.addRsvp(event.id, { name, email });
                          setRsvps(prev => [...prev, created]);
                          const r = await cmsApi.listRsvps(event.id);
                          setRsvpCounts(r.counts);
                          flash(created.status === 'waitlist' ? 'Added to waitlist' : 'Added');
                        } catch (e: any) { flash(e?.message || 'Failed', 3000); }
                      }}>
                + Add RSVP manually
              </button>
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={(url) => {
          if (pickerFor === 'cover') update({ cover_image_url: url });
          else if (pickerFor && typeof pickerFor === 'object' && pickerFor.kind === 'sponsor') {
            updateSponsor(pickerFor.idx, { logo_url: url });
          }
          setPickerFor(null);
        }}
      />
      {previewOpen && <EventPreviewModal event={event} onClose={() => setPreviewOpen(false)} />}

      {/* Cancel-event modal. Two-step so admins don't destructively-
          email dozens of attendees by accident. The reason field is
          optional but strongly encouraged — it lands inside the
          outbound email verbatim. */}
      {cancelOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !cancelling && setCancelOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#FFFFFF', borderRadius: 20, maxWidth: 520, width: '100%', padding: 24, boxShadow: '0 20px 60px rgba(15,23,42,0.35)' }}
          >
            <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#991B1B', fontWeight: 800, textTransform: 'uppercase' }}>
              Cancel this event
            </div>
            <h2 style={{ margin: '6px 0 8px', fontSize: 22, color: '#0A2540', fontWeight: 900 }}>
              {event.title}
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: '#475569', lineHeight: 1.6 }}>
              {totalActiveRsvps === 0
                ? "No RSVPs yet — this only marks the event cancelled. You can still edit or re-publish."
                : totalActiveRsvps === 1
                  ? "1 attendee will receive a cancellation email with a CANCEL calendar update."
                  : `${totalActiveRsvps} attendees will receive a cancellation email with a CANCEL calendar update.`}
              {' '}This can&rsquo;t be undone easily — the event stays visible with a &ldquo;cancelled&rdquo; banner.
            </p>

            <label style={{ ...s.label, marginTop: 4 }}>Reason (shown in the email — optional)</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder='e.g. "Unfortunately our host is unwell. We&rsquo;ll reschedule soon."'
              rows={4}
              maxLength={500}
              disabled={cancelling}
              style={{ ...s.input, width: '100%', resize: 'vertical', minHeight: 100 }}
            />
            <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 2 }}>
              {cancelReason.length}/500
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                disabled={cancelling}
                className="cms-btn-ghost"
                style={s.ghostBtn}
              >
                Keep event
              </button>
              <button
                type="button"
                onClick={doCancelEvent}
                disabled={cancelling}
                style={{ padding: '10px 18px', borderRadius: 12, border: 'none', background: cancelling ? '#94A3B8' : '#DC2626', color: '#FFFFFF', fontWeight: 900, fontSize: 14, cursor: cancelling ? 'default' : 'pointer' }}
              >
                {cancelling ? 'Cancelling…' : totalActiveRsvps > 0 ? `Yes, cancel & email ${totalActiveRsvps}` : 'Yes, cancel event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

/* ---------- helpers & sub-components ---------- */

function CoverWell({ url, title }: { url: string; title: string }) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://george-mcgs-cms.preview.emergentagent.com';
  const abs = url ? (url.startsWith('http') ? url : `${BASE}${url}`) : '';
  return (
    <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden',
                  background: abs ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#FFFFFF', fontSize: 40 }}>
      {abs ? (
         
        <img src={abs} alt={title || 'Cover'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : '📅'}
    </div>
  );
}

function StatusPill({ status, hidden }: { status: string; hidden: boolean }) {
  const base: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' };
  if (status === 'cancelled') return <span style={{ ...base, background: '#FEE2E2', color: '#991B1B' }}>Cancelled</span>;
  if (status !== 'published') return <span style={{ ...base, background: '#FEF3C7', color: '#92400E' }}>Draft</span>;
  if (hidden) return <span style={{ ...base, background: '#F1F5F9', color: '#475569' }}>Hidden</span>;
  return <span style={{ ...base, background: '#DCFCE7', color: '#166534' }}>Published</span>;
}

function RsvpStatusPill({ status }: { status: 'going' | 'waitlist' | 'cancelled' }) {
  const map: Record<string, { bg: string; c: string; label: string }> = {
    going: { bg: '#DCFCE7', c: '#166534', label: 'Going' },
    waitlist: { bg: '#FEF3C7', c: '#92400E', label: 'Waitlist' },
    cancelled: { bg: '#F1F5F9', c: '#475569', label: 'Cancelled' },
  };
  const m = map[status] || map.going;
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', background: m.bg, color: m.c }}>{m.label}</span>;
}

function RsvpStat({ label, value, tone, cap }: { label: string; value: number; tone: 'teal' | 'amber'; cap?: number | null }) {
  const isTeal = tone === 'teal';
  return (
    <div style={{ flex: 1, padding: 12, borderRadius: 12,
                  background: isTeal ? '#F0FDFA' : '#FFFBEB',
                  border: `1px solid ${isTeal ? 'rgba(20,184,166,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: isTeal ? '#0F766E' : '#92400E' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#0A2540', marginTop: 2 }}>
        {value}{cap ? <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 700 }}> / {cap}</span> : null}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      <span style={{ width: 40, height: 24, borderRadius: 999, background: checked ? '#14B8A6' : '#CBD5E1', position: 'relative', flexShrink: 0, transition: 'background-color 180ms ease' }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 180ms ease' }} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: '#0A2540' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#64748B', marginTop: 2 }}>{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
    </label>
  );
}

function EventPreviewModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://george-mcgs-cms.preview.emergentagent.com';
  const cover = event.cover_image_url ? (event.cover_image_url.startsWith('http') ? event.cover_image_url : `${BASE}${event.cover_image_url}`) : null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ background: 'rgba(255,255,255,0.94)', padding: '10px 16px', borderRadius: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0A2540' }}>
          <span>👁️ Preview — how visitors will see this</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#0A2540', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <article style={{ background: '#FFFFFF', borderRadius: 20, overflow: 'hidden', border: '1px solid #E2E8F0', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
          {cover && (
             
            <img src={cover} alt={event.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
          )}
          <div style={{ padding: 28 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0A2540', margin: 0, letterSpacing: '-0.01em' }}>{event.title || 'Untitled event'}</h1>
            <div style={{ marginTop: 10, color: '#475569', fontSize: 15 }}>
              📅 {formatEventPreview(event.starts_at, event.timezone)}
              {event.venue_name && <> · 📍 {event.venue_name}</>}
              {event.is_online && <> · 💻 Online</>}
              &nbsp;·&nbsp;{event.cost_display}
            </div>
            {event.description && <p style={{ marginTop: 16, fontSize: 17, color: '#334155', lineHeight: 1.6 }}>{event.description}</p>}
            {event.body_html && <div className="fp-event-body" style={{ marginTop: 16, fontSize: 15, color: '#334155', lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: event.body_html }} />}
            {(event.accessibility_info || event.organiser_name) && (
              <div style={{ marginTop: 24, padding: 16, background: '#F8FAFC', borderRadius: 12, fontSize: 14, color: '#475569' }}>
                {event.organiser_name && <div>🧑 Organised by <strong>{event.organiser_name}</strong>{event.organiser_contact && <> · {event.organiser_contact}</>}</div>}
                {event.accessibility_info && <div style={{ marginTop: 6 }}>♿ {event.accessibility_info}</div>}
              </div>
            )}
            {(event.sponsors || []).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 10 }}>Proudly supported by</div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  {event.sponsors.map((sp, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F1F5F9', padding: '8px 14px', borderRadius: 999 }}>
                      {sp.logo_url && (
                         
                        <img src={sp.logo_url.startsWith('http') ? sp.logo_url : `${BASE}${sp.logo_url}`} alt={sp.name || ''} style={{ height: 20, objectFit: 'contain' }} />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>{sp.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

// ---- datetime helpers ----
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatEventPreview(iso: string | undefined, tz = 'Australia/Sydney'): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  try {
    return d.toLocaleString('en-AU', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch { return d.toLocaleString('en-AU'); }
}
