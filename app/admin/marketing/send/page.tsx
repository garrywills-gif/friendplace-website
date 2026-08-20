'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  marketingApi,
  flyersApi,
  type MarketingTemplate,
  type MarketingPreviewOut,
  type FlyerTemplate,
} from '@/lib/cms-api';

type FormState = {
  template_id: string;
  recipient_name: string;
  recipient_email: string;
  recipient_type: 'person' | 'organisation';
  organisation_name: string;
  suburb: string;
  subject_override: string;
  additional_message: string;
  flyer_key: string;
  flyer_layout: string;
  flyer_venue: string;
};

const INITIAL_STATE: FormState = {
  template_id: 'friendplace_intro',
  recipient_name: '',
  recipient_email: '',
  recipient_type: 'person',
  organisation_name: '',
  suburb: '',
  subject_override: '',
  additional_message: '',
  flyer_key: '',
  flyer_layout: 'poster_a4',
  flyer_venue: '',
};

export default function SendMarketingEmailPage() {
  const searchParams = useSearchParams();
  
  const [templates, setTemplates] = useState<MarketingTemplate[]>([]);
  const [flyerTpls, setFlyerTpls] = useState<FlyerTemplate[]>([]);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [preview, setPreview] = useState<MarketingPreviewOut | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{
    kind: 'ok' | 'err';
    msg: string;
  } | null>(null);
  useEffect(() => {
    const email = searchParams?.get('email') || '';
    const name = searchParams?.get('name') || '';
    const subject = searchParams?.get('subject') || '';
    const templateId = searchParams?.get('template_id') || '';

    if (!email && !name && !subject && !templateId) return;

    setForm((prev) => ({
      ...prev,
      recipient_email: email || prev.recipient_email,
      recipient_name: name || prev.recipient_name,
      subject_override: subject || prev.subject_override,
      template_id: templateId || prev.template_id,
    }));
  }, [searchParams]);  
  useEffect(() => {
    (async () => {
      try {
        const [t, f] = await Promise.all([
          marketingApi.listTemplates(),
          flyersApi.list({ status: 'published' }),
        ]);

        setTemplates(t.templates);
        setFlyerTpls(f.templates || []);
      } catch (e: any) {
        setToast({
          kind: 'err',
          msg: `Couldn’t load templates: ${e?.message || e}`,
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.flyer_key) return;

    const ft = flyerTpls.find((f) => f.key === form.flyer_key);

    if (ft && !ft.supported_layouts.includes(form.flyer_layout)) {
      setForm((prev) => ({
        ...prev,
        flyer_layout: ft.default_layout,
      }));
    }
  }, [form.flyer_key, form.flyer_layout, flyerTpls]);

  const previewKey = useMemo(() => JSON.stringify(form), [form]);

  useEffect(() => {
    if (!form.template_id) return;

    let alive = true;

    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      setPreviewErr(null);

      try {
        const flyerAttach = form.flyer_key
          ? {
              template_key: form.flyer_key,
              layout: form.flyer_layout || 'poster_a4',
             field_values: form.flyer_venue
  ? { venue: form.flyer_venue }
  : undefined,
            }
          : null;

        const p = await marketingApi.preview({
          template_id: form.template_id,
          recipient_name: form.recipient_name,
          recipient_email: form.recipient_email,
          recipient_type: form.recipient_type,
          organisation_name: form.organisation_name,
          suburb: form.suburb,
          subject_override: form.subject_override || null,
          additional_message: form.additional_message,
          flyer: flyerAttach,
        });

        if (!alive) return;

        setPreview(p);
      } catch (e: any) {
        if (!alive) return;

        setPreviewErr(e?.message || String(e));
        setPreview(null);
      } finally {
        if (alive) {
          setPreviewBusy(false);
        }
      }
    }, 300);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [previewKey, form]);

  const canSend =
    form.template_id &&
    form.recipient_email.includes('@') &&
    !sending;

  const selectedFlyer = flyerTpls.find(
    (f) => f.key === form.flyer_key,
  );

  const send = async () => {
    if (!canSend) return;

    setSending(true);
    setToast(null);

    try {
      const flyerAttach = form.flyer_key
        ? {
            template_key: form.flyer_key,
            layout: form.flyer_layout || 'poster_a4',
            field_values: form.flyer_venue
              ? { venue: form.flyer_venue }
         : undefined,
          }
        : null;

      const r = await marketingApi.send({
        template_id: form.template_id,
        recipient_name: form.recipient_name,
        recipient_email: form.recipient_email,
        recipient_type: form.recipient_type,
        organisation_name: form.organisation_name,
        suburb: form.suburb,
        subject_override: form.subject_override || null,
        additional_message: form.additional_message,
        flyer: flyerAttach,
      });

      if (r.ok) {
        setToast({
          kind: 'ok',
          msg: `Sent to ${r.recipient_email}. Message id ${r.message_id}.`,
        });

        setForm((prev) => ({
          ...INITIAL_STATE,
          template_id: prev.template_id,
          flyer_key: prev.flyer_key,
          flyer_layout: prev.flyer_layout,
          flyer_venue: prev.flyer_venue,
        }));
      } else {
        setToast({
          kind: 'err',
          msg: `Send failed: ${r.error || 'unknown error'} (${r.error_code || 'unknown'})`,
        });
      }
    } catch (e: any) {
      setToast({
        kind: 'err',
        msg: `Send failed: ${e?.message || e}`,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminShell title="Send Email">
      <p style={crumbs}>
        <Link href="/admin/crm" style={crumbLink}>
          CRM
        </Link>
        {' › '}Marketing{' › '}Send Email — send one polished FriendPlace email
        in under a minute. Attach a flyer if you like.
      </p>

      <div style={layout}>
        <div style={formCol}>
          <div style={card}>
            <h3 style={cardTitle}>Recipient</h3>

            <label style={label}>Type</label>

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {(['person', 'organisation'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      recipient_type: v,
                    })
                  }
                  style={{
                    ...pill,
                    background:
                      form.recipient_type === v
                        ? '#0D9488'
                        : '#F1F5F9',
                    color:
                      form.recipient_type === v
                        ? '#FFFFFF'
                        : '#0F172A',
                    borderColor:
                      form.recipient_type === v
                        ? '#0D9488'
                        : '#E2E8F0',
                  }}
                >
                  {v === 'person' ? 'Person' : 'Organisation'}
                </button>
              ))}
            </div>

            {form.recipient_type === 'organisation' && (
              <>
                <label style={label}>
                  Organisation name{' '}
                  <span style={muted}>
                    (required for org)
                  </span>
                </label>

                <input
                  style={input}
                  value={form.organisation_name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      organisation_name: e.target.value,
                    })
                  }
                  placeholder="Hillside Retirement Village"
                />
              </>
            )}

            <label style={label}>Contact name</label>

            <input
              style={input}
              value={form.recipient_name}
              onChange={(e) =>
                setForm({
                  ...form,
                  recipient_name: e.target.value,
                })
              }
              placeholder={
                form.recipient_type === 'organisation'
                  ? 'e.g. reception team'
                  : 'e.g. Jane Smith'
              }
            />

            <label style={label}>
              Email address <span style={required}>*</span>
            </label>

            <input
              style={input}
              type="email"
              value={form.recipient_email}
              onChange={(e) =>
                setForm({
                  ...form,
                  recipient_email: e.target.value,
                })
              }
              placeholder="jane@example.com"
            />

            {form.recipient_type === 'organisation' && (
              <>
                <label style={label}>Suburb</label>

                <input
                  style={input}
                  value={form.suburb}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      suburb: e.target.value,
                    })
                  }
                  placeholder="Kellyville"
                />
              </>
            )}
          </div>

          <div style={card}>
            <h3 style={cardTitle}>Message</h3>

            <label style={label}>Template</label>

            <select
              style={input}
              value={form.template_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  template_id: e.target.value,
                })
              }
            >
              {templates
                .filter(
                  (t) =>
                    t.audience === 'any' ||
                    t.audience === form.recipient_type,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>

            <p style={helpText}>
              {
                templates.find(
                  (t) => t.id === form.template_id,
                )?.description || ''
              }
            </p>

            <label style={label}>
              Subject{' '}
              <span style={muted}>
                (optional — template picks a default)
              </span>
            </label>

            <input
              style={input}
              value={form.subject_override}
              onChange={(e) =>
                setForm({
                  ...form,
                  subject_override: e.target.value,
                })
              }
              placeholder="Leave blank to use the template default"
            />

            <label style={label}>
              Additional message{' '}
              <span style={muted}>(optional)</span>
            </label>

            <textarea
              style={{
                ...input,
                minHeight: 120,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
              value={form.additional_message}
              onChange={(e) =>
                setForm({
                  ...form,
                  additional_message: e.target.value,
                })
              }
              placeholder="Anything you’d like to add — blank lines create paragraphs."
            />
          </div>

          <div style={card}>
            <h3 style={cardTitle}>
              Flyer attachment{' '}
              <span style={muted}>(optional)</span>
            </h3>

            <label style={label}>Flyer</label>

            <select
              style={input}
              value={form.flyer_key}
              onChange={(e) =>
                setForm({
                  ...form,
                  flyer_key: e.target.value,
                })
              }
            >
              <option value="">— no flyer —</option>

              {flyerTpls.map((ft) => (
                <option key={ft.key} value={ft.key}>
                  {ft.name}
                </option>
              ))}
            </select>

            {selectedFlyer && (
              <>
                <label style={label}>Layout / size</label>

                <select
                  style={input}
                  value={form.flyer_layout}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flyer_layout: e.target.value,
                    })
                  }
                >
                  {selectedFlyer.supported_layouts.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>

                <label style={label}>
                  Venue / host{' '}
                  <span style={muted}>(optional)</span>
                </label>

                <input
                  style={input}
                  value={form.flyer_venue}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flyer_venue: e.target.value,
                    })
                  }
                  placeholder="e.g. Hillside Retirement Village"
                />

                <p style={helpText}>
                  The flyer will be attached as PDF, sized to{' '}
                  {form.flyer_layout}.
                </p>
              </>
            )}
          </div>

          <div style={sendBar}>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              style={{
                ...sendBtn,
                opacity: canSend ? 1 : 0.5,
                cursor: canSend
                  ? 'pointer'
                  : 'not-allowed',
              }}
              data-testid="send-email-button"
            >
              {sending ? 'Sending…' : 'Send email'}
            </button>

            <Link
              href="/admin/marketing/history"
              style={historyLink}
            >
              View send history →
            </Link>
          </div>

          {toast && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 10,
                background:
                  toast.kind === 'ok'
                    ? '#DCFCE7'
                    : '#FEE2E2',
                color:
                  toast.kind === 'ok'
                    ? '#166534'
                    : '#991B1B',
                border: `1px solid ${
                  toast.kind === 'ok'
                    ? '#86EFAC'
                    : '#FECACA'
                }`,
                fontSize: 13,
                fontWeight: 600,
              }}
              data-testid="send-email-toast"
            >
              {toast.msg}
            </div>
          )}
        </div>

        <div style={previewCol}>
          <div
            style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
            }}
          >
            <div style={previewHeader}>
              <span style={previewHeaderLabel}>
                Live preview
              </span>

              <span style={previewHeaderMeta}>
                {previewBusy
                  ? 'refreshing…'
                  : preview?.subject || '—'}
              </span>
            </div>

            {previewErr ? (
              <div
                style={{
                  padding: 16,
                  color: '#991B1B',
                  fontSize: 13,
                }}
              >
                Preview failed: {previewErr}
              </div>
            ) : (
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={
                  preview?.html ||
                  '<p style="padding:24px;color:#94A3B8;font-family:sans-serif;">Fill in the form to see your email…</p>'
                }
                style={{
                  width: '100%',
                  height: 720,
                  border: 'none',
                  background: '#0A2540',
                }}
              />
            )}

            {preview?.flyer && (
              <div style={flyerMeta}>
                📎 Attachment:{' '}
                <strong>
                  {preview.flyer.filename}
                </strong>{' '}
                <span style={muted}>
                  (
                  {Math.round(
                    (preview.flyer.size_bytes || 0) /
                      1024,
                  )}{' '}
                  KB PDF)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns:
    'minmax(320px, 480px) minmax(0, 1fr)',
  gap: 20,
  alignItems: 'start',
};

const crumbs: React.CSSProperties = {
  margin: '4px 0 20px',
  color: '#475569',
  fontSize: 13,
  lineHeight: 1.5,
};

const crumbLink: React.CSSProperties = {
  color: '#0F766E',
  textDecoration: 'none',
  fontWeight: 700,
};

const formCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const previewCol: React.CSSProperties = {
  position: 'sticky',
  top: 16,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 800,
  color: '#0A2540',
  marginBottom: 12,
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#475569',
  marginTop: 10,
  marginBottom: 4,
};

const helpText: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  color: '#64748B',
  lineHeight: 1.5,
};

const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #E2E8F0',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  color: '#0F172A',
  background: '#FFFFFF',
};

const pill: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  border: '1px solid #E2E8F0',
  cursor: 'pointer',
};

const sendBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  marginTop: 4,
};

const sendBtn: React.CSSProperties = {
  background: '#0D9488',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 12,
  padding: '12px 28px',
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: '0.02em',
};

const historyLink: React.CSSProperties = {
  fontSize: 13,
  color: '#0F766E',
  fontWeight: 700,
  textDecoration: 'none',
};

const previewHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  borderBottom: '1px solid #E2E8F0',
  background: '#F8FAFC',
};

const previewHeaderLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#0F766E',
};

const previewHeaderMeta: React.CSSProperties = {
  fontSize: 12,
  color: '#0F172A',
  fontWeight: 700,
  maxWidth: '65%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const flyerMeta: React.CSSProperties = {
  padding: '10px 16px',
  borderTop: '1px solid #E2E8F0',
  background: '#F8FAFC',
  fontSize: 13,
  color: '#334155',
};

const muted: React.CSSProperties = {
  color: '#94A3B8',
  fontWeight: 500,
  fontSize: 11,
};

const required: React.CSSProperties = {
  color: '#DC2626',
};
