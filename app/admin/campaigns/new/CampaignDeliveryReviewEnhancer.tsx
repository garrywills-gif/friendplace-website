'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '@/lib/api-base';
import { clearAuth, getToken } from '@/lib/cms-auth';

type AudienceRecipient = {
  id?: string | null;
  email: string;
  first_name?: string;
  founder_number?: number;
};

type RecipientRender = {
  subject: string;
  html: string;
  text: string;
  recipient: {
    id?: string | null;
    email: string;
    first_name?: string;
    founder_number?: number;
    companion?: string;
  };
  attachment?: { filename?: string } | null;
};

async function campaignPost<T>(campaignId: string, suffix: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(
    `${API_BASE}/api/cms/campaigns/${encodeURIComponent(campaignId)}/${suffix}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  );
  if (res.status === 401) clearAuth();
  const text = await res.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: text }; }
  if (!res.ok) {
    throw new Error(payload?.detail || payload?.error || `Request failed (${res.status})`);
  }
  return payload as T;
}

function campaignIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('id');
}

export function CampaignDeliveryReviewEnhancer(): ReactElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'review' | 'render' | null>(null);
  const [message, setMessage] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [audienceCount, setAudienceCount] = useState(0);
  const [sample, setSample] = useState<AudienceRecipient[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [rendered, setRendered] = useState<RecipientRender | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let mountHost: HTMLDivElement | null = null;

    setCampaignId(campaignIdFromUrl());

    const attach = () => {
      if (cancelled || mountHost) return;
      const iframe = document.querySelector('iframe[title="Campaign preview"]') as HTMLIFrameElement | null;
      const previewBox = iframe?.parentElement;
      const sticky = previewBox?.parentElement;
      if (!iframe || !previewBox || !sticky) {
        frame = requestAnimationFrame(attach);
        return;
      }
      mountHost = document.createElement('div');
      mountHost.dataset.campaignDeliveryReview = '1';
      sticky.appendChild(mountHost);
      setHost(mountHost);
    };

    attach();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      mountHost?.remove();
      setHost(null);
    };
  }, []);

  if (!host) return null;

  const sendTest = async () => {
    if (!campaignId) {
      setMessage('Save this draft, then reopen it to send a safe test copy.');
      return;
    }
    setBusy('test');
    setMessage('');
    try {
      const r = await campaignPost<{
        ok: boolean; to: string; subject: string; message_id?: string; error?: string;
      }>(campaignId, 'test-send');
      if (!r.ok) throw new Error(r.error || 'Test send failed');
      setMessage(`✓ Test sent only to ${r.to}`);
    } catch (e: any) {
      setMessage(e?.message || 'Test send failed');
    } finally {
      setBusy(null);
    }
  };

  const openReview = async () => {
    if (!campaignId) {
      setMessage('Save this draft, then reopen it to review personalised recipients.');
      return;
    }
    setBusy('review');
    setMessage('');
    try {
      const r = await campaignPost<{ count: number; sample: AudienceRecipient[] }>(campaignId, 'preview-audience');
      const rows = r.sample || [];
      setAudienceCount(r.count || 0);
      setSample(rows);
      setReviewOpen(true);
      if (rows[0]?.email) {
        setSelectedEmail(rows[0].email);
        await renderRecipient(rows[0].email, campaignId);
      } else {
        setRendered(null);
      }
    } catch (e: any) {
      setMessage(e?.message || 'Could not load recipient review');
    } finally {
      setBusy(null);
    }
  };

  const renderRecipient = async (email: string, id = campaignId) => {
    if (!id || !email) return;
    setBusy('render');
    try {
      const r = await campaignPost<RecipientRender>(id, 'render-recipient', { email });
      setRendered(r);
    } catch (e: any) {
      setMessage(e?.message || 'Could not render that recipient');
      setRendered(null);
    } finally {
      setBusy(null);
    }
  };

  const buttonStyle = {
    borderRadius: 10,
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  } as const;

  const controls = (
    <div style={{ marginTop: 12, padding: 12, border: '1px solid #D7E3E3', borderRadius: 14, background: '#F8FFFE' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0F766E', marginBottom: 8 }}>
        Final email check
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={busy !== null}
          style={{ ...buttonStyle, border: '1px solid #0F766E', background: '#0F766E', color: '#FFFFFF', opacity: busy ? 0.65 : 1 }}
        >
          {busy === 'test' ? 'Sending test…' : '✉ Send test to me'}
        </button>
        <button
          type="button"
          onClick={() => void openReview()}
          disabled={busy !== null}
          style={{ ...buttonStyle, border: '1px solid #0F766E', background: '#FFFFFF', color: '#0F766E', opacity: busy ? 0.65 : 1 }}
        >
          {busy === 'review' ? 'Loading…' : '👀 Review emails'}
        </button>
      </div>
      <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.45, color: '#64748B' }}>
        Test sends are backend-guarded and never use the campaign audience. Recipient review does not send anything.
      </div>
      {message && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45, color: message.startsWith('✓') ? '#166534' : '#92400E', fontWeight: 700 }}>
          {message}
        </div>
      )}
    </div>
  );

  const modal = reviewOpen && typeof document !== 'undefined' ? createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,0.62)', padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(980px, 96vw)', height: 'min(820px, 92vh)', background: '#FFFFFF', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(15,23,42,0.35)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#0A2540' }}>Review personalised email</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
              {sample.length < audienceCount
                ? `Showing ${sample.length} of ${audienceCount} resolved recipients — no email is sent from this screen.`
                : `${audienceCount} resolved recipient${audienceCount === 1 ? '' : 's'} — no email is sent from this screen.`}
            </div>
          </div>
          <button type="button" onClick={() => setReviewOpen(false)} style={{ ...buttonStyle, border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0A2540' }}>Close</button>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#64748B', marginBottom: 5 }}>Recipient</label>
          <select
            value={selectedEmail}
            disabled={!sample.length || busy === 'render'}
            onChange={e => {
              const email = e.target.value;
              setSelectedEmail(email);
              void renderRecipient(email);
            }}
            style={{ width: '100%', maxWidth: 520, border: '1px solid #CBD5E1', borderRadius: 10, padding: '9px 10px', background: '#FFFFFF', color: '#0A2540' }}
          >
            {sample.map((r, i) => (
              <option key={`${r.email}-${i}`} value={r.email}>
                {r.first_name || '(no name)'} · {r.email}{r.founder_number ? ` · #${String(r.founder_number).padStart(4, '0')}` : ''}
              </option>
            ))}
          </select>
          {sample.length < audienceCount && (
            <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>
              The backend currently exposes only the first 10 recipients in audience preview. The remaining {Math.max(0, audienceCount - sample.length)} are still included in the real campaign send; they just cannot be selected here yet.
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {busy === 'render' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.75)', color: '#0F766E', fontWeight: 800 }}>Rendering personalised copy…</div>
          )}
          {rendered ? (
            <>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', fontSize: 12, color: '#475569' }}>
                <strong>To:</strong> {rendered.recipient?.email} &nbsp; · &nbsp; <strong>Subject:</strong> {rendered.subject}
                {rendered.attachment?.filename ? <> &nbsp; · &nbsp; 📎 {rendered.attachment.filename}</> : null}
              </div>
              <iframe title="Personalised campaign recipient review" sandbox="" srcDoc={rendered.html || ''} style={{ width: '100%', height: 'calc(100% - 38px)', border: 0 }} />
            </>
          ) : (
            <div style={{ padding: 28, color: '#64748B' }}>No recipient preview available.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  ) as unknown as ReactElement : null;

  return (
    <>
      {createPortal(controls, host) as unknown as ReactElement}
      {modal}
    </>
  );
}
