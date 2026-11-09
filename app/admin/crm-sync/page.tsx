'use client';

import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { campaignsApi, type Campaign } from '@/lib/cms-api';

/** Administrative reconciliation: preview first, explicit typed confirmation to apply. */
type MemberRow = { first_name?: string; number?: string; from?: string };
function Counts({ data }: { data?: Record<string, number> }) {
  const entries = Object.entries(data || {}).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return <span style={{ color: '#64748B' }}>None</span>;
  return <>{entries.map(([key, value]) =>
    <span key={key} style={{ marginRight: 14 }}>{key.replace(/_/g, ' ')}: <b>{value}</b></span>
  )}</>;
}
function MemberList({ rows }: { rows?: MemberRow[] }) {
  if (!rows?.length) return null;
  return (
    <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, padding: 10, marginTop: 10 }}>
      {rows.map((row, index) => (
        <div key={index} style={{ fontSize: 14, padding: '3px 0', color: '#0A2540' }}>
          {row.number || '—'} · {row.first_name || '(no name)'}{row.from ? ` · currently ${row.from}` : ''}
        </div>
      ))}
    </div>
  );
}
function ConfirmApply({ word, label, busy, onApply }: { word: string; label: string; busy: boolean; onApply: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
      <input style={{ ...s.input, maxWidth: 200 }} placeholder={`Type ${word}`} value={typed}
             onChange={event => setTyped(event.target.value)} aria-label={`Confirmation: ${word}`} />
      <button type="button" className="cms-btn-primary"
              style={{ ...s.primaryBtn, opacity: typed === word && !busy ? 1 : 0.5 }}
              disabled={typed !== word || busy} onClick={onApply}>
        {busy ? 'Applying…' : label}
      </button>
    </div>
  );
}

export default function CrmSyncPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [invitationPreview, setInvitationPreview] = useState<any>(null);
  const [invitationApplied, setInvitationApplied] = useState<any>(null);
  const [joinedPreview, setJoinedPreview] = useState<any>(null);
  const [joinedApplied, setJoinedApplied] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    campaignsApi.list().then(result => {
      const sent = (result.rows || []).filter(campaign => campaign.status === 'sent');
      setCampaigns(sent);
      if (sent.length) setCampaignId(sent[0].id);
    }).catch(err => setError(String(err?.message || err)));
  }, []);

  async function run(key: string, action: () => Promise<any>, save: (data: any) => void) {
    setBusy(key);
    setError('');
    try {
      const result = await action();
      save(result);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy('');
    }
  }

  return (
    <AdminShell title="CRM Status Sync">
      <p style={{ color: '#475569', fontSize: 16, maxWidth: 720, marginTop: -12 }}>
        Preview before applying a one-off correction. No emails are sent and no Founding Member
        numbers or M-numbers are changed. Joined and Opted Out are not downgraded.
      </p>
      {error && <div role="alert" style={{ ...s.card, borderColor: '#FCA5A5', color: '#B91C1C', marginBottom: 16 }}>{error}</div>}

      <div style={{ ...s.card, marginBottom: 20 }}>
        <h2 style={s.cardTitle}>1 · Mark successfully invited members as Invited</h2>
        <label style={s.label} htmlFor="sync-campaign">Sent campaign</label>
        <select id="sync-campaign" style={{ ...s.input, maxWidth: 520 }} value={campaignId}
                onChange={event => {
                  setCampaignId(event.target.value);
                  setInvitationPreview(null);
                  setInvitationApplied(null);
                }}>
          {campaigns.length === 0 && <option value="">No sent campaigns found</option>}
          {campaigns.map(campaign => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}{campaign.finished_at ? ` · ${campaign.finished_at.slice(0, 10)}` : ''}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="cms-btn-ghost" style={s.ghostBtn} disabled={!campaignId || !!busy}
                  onClick={() => run('invitation-preview', () => campaignsApi.inviteSyncPreview(campaignId), data => {
                    setInvitationPreview(data);
                    setInvitationApplied(null);
                  })}>
            {busy === 'invitation-preview' ? 'Checking…' : 'Preview changes'}
          </button>
        </div>
        {invitationPreview && (
          <div style={{ marginTop: 14, fontSize: 15, color: '#0A2540', lineHeight: 1.7 }}>
            <div>Email records: <b>{invitationPreview.recipient_records}</b> · successful: <b>{invitationPreview.successful}</b></div>
            <div>Not counted (bounced / failed / Do Not Email): <Counts data={invitationPreview.not_successful} /></div>
            <div>Already another status: <Counts data={invitationPreview.already_other_status} /></div>
            <div style={{ fontSize: 17, marginTop: 6 }}>Will change Registered → Invited: <b>{invitationPreview.will_change}</b></div>
            <MemberList rows={invitationPreview.to_invite} />
            {invitationPreview.will_change > 0 && !invitationApplied && (
              <ConfirmApply key={campaignId + '-invitation'} word="INVITE" label="Apply Invited status"
                            busy={!!busy} onApply={() => run('invitation-apply', () => campaignsApi.inviteSyncApply(campaignId), setInvitationApplied)} />
            )}
          </div>
        )}
        {invitationApplied && <div role="status" style={{ marginTop: 12, color: '#047857', fontWeight: 700 }}>
          Done — {invitationApplied.changed} marked Invited.
        </div>}
      </div>

      <div style={s.card}>
        <h2 style={s.cardTitle}>2 · Mark verified app members as Joined</h2>
        <p style={s.helper}>Run after step 1. Joined takes priority over Invited. This option needs the separate Joined backend deployment.</p>
        <button type="button" className="cms-btn-ghost" style={s.ghostBtn} disabled={!!busy}
                onClick={() => run('joined-preview', campaignsApi.joinedSyncPreview, data => {
                  setJoinedPreview(data);
                  setJoinedApplied(null);
                })}>
          {busy === 'joined-preview' ? 'Checking…' : 'Preview changes'}
        </button>
        {joinedPreview && (
          <div style={{ marginTop: 14, fontSize: 15, color: '#0A2540', lineHeight: 1.7 }}>
            <div style={{ fontSize: 17 }}>Will change to Joined: <b>{joinedPreview.will_change_to_joined}</b>
              {' '}· link only: <b>{joinedPreview.link_only}</b></div>
            <div>Skipped for safety: <Counts data={joinedPreview.skipped} /></div>
            {joinedPreview.number_mismatch_review?.length > 0 && (
              <div style={{ color: '#B45309', marginTop: 6 }}>
                Number mismatches (not changed — review before approving):
                {joinedPreview.number_mismatch_review.map((member: any, index: number) => (
                  <div key={index}>· {member.first_name}: registration {member.registration_number}, app {member.account_number}</div>
                ))}
              </div>
            )}
            <MemberList rows={joinedPreview.members} />
            {(joinedPreview.will_change_to_joined + joinedPreview.link_only) > 0 && !joinedApplied && (
              <ConfirmApply word="JOINED" label="Apply Joined status" busy={!!busy}
                            onApply={() => run('joined-apply', campaignsApi.joinedSyncApply, setJoinedApplied)} />
            )}
          </div>
        )}
        {joinedApplied && <div role="status" style={{ marginTop: 12, color: '#047857', fontWeight: 700 }}>
          Done — {joinedApplied.changed_to_joined} marked Joined, {joinedApplied.records_linked} linked to app accounts.
        </div>}
      </div>
    </AdminShell>
  );
}
