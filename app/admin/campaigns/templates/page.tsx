'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';

type SavedCampaignTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
};

const STORAGE_KEY = 'friendplace.mcgs.campaignTemplates.v1';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function CampaignTemplatesPage() {
  const [templates, setTemplates] = useState<SavedCampaignTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setTemplates(JSON.parse(raw));
    } catch {
      // If local storage is unavailable, keep the page usable for this session.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // Best effort only; page remains usable in-memory.
    }
  }, [templates, loaded]);

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [templates],
  );

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSubject('');
    setBody('');
  };

  const saveTemplate = () => {
    const cleanName = name.trim();
    const cleanSubject = subject.trim();
    const cleanBody = body.trim();
    if (!cleanName || !cleanBody) return;

    const now = new Date().toISOString();
    if (editingId) {
      setTemplates(current => current.map(item => item.id === editingId
        ? { ...item, name: cleanName, subject: cleanSubject, body: cleanBody, updated_at: now }
        : item));
    } else {
      setTemplates(current => [{
        id: makeId(),
        name: cleanName,
        subject: cleanSubject,
        body: cleanBody,
        created_at: now,
        updated_at: now,
      }, ...current]);
    }
    resetForm();
  };

  const editTemplate = (template: SavedCampaignTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setSubject(template.subject);
    setBody(template.body);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeTemplate = (template: SavedCampaignTemplate) => {
    if (!window.confirm(`Delete template “${template.name}”?`)) return;
    setTemplates(current => current.filter(item => item.id !== template.id));
    if (editingId === template.id) resetForm();
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(current => current === key ? null : current), 1600);
  };

  return (
    <AdminShell title="Campaign Templates">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <p style={{ margin: 0, color: '#475569', maxWidth: 720, lineHeight: 1.6 }}>
            Keep your best campaign emails here, then copy the subject or email body whenever you create a new campaign.
          </p>
          <p style={{ margin: '6px 0 0', color: '#94A3B8', fontSize: 12 }}>
            Saved privately in this browser on this device.
          </p>
        </div>
        <Link href="/admin/campaigns" style={{ ...s.ghostBtn, textDecoration: 'none' }}>← Campaigns</Link>
      </div>

      <div style={{ ...s.card, marginBottom: 22 }}>
        <h2 style={{ ...s.cardTitle, marginBottom: 18 }}>{editingId ? 'Edit template' : 'Save a template'}</h2>

        <label style={s.label}>Template name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Retirement village outreach — no attachment"
          style={{ ...s.input, marginBottom: 16 }}
        />

        <label style={s.label}>Subject</label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Something your residents may enjoy — FriendPlace"
          style={{ ...s.input, marginBottom: 16 }}
        />

        <label style={s.label}>Email body</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Paste the email you want to keep here…"
          style={{ ...s.textarea, minHeight: 240, lineHeight: 1.6 }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          {editingId && (
            <button type="button" onClick={resetForm} style={s.ghostBtn}>Cancel</button>
          )}
          <button
            type="button"
            onClick={saveTemplate}
            disabled={!name.trim() || !body.trim()}
            style={{ ...s.primaryBtn, opacity: !name.trim() || !body.trim() ? 0.55 : 1 }}
          >
            {editingId ? 'Save changes' : 'Save template'}
          </button>
        </div>
      </div>

      {!loaded ? (
        <div style={empty}>Loading templates…</div>
      ) : sortedTemplates.length === 0 ? (
        <div style={empty}>
          <div style={{ fontSize: 42 }}>✉️</div>
          <div style={{ marginTop: 10, fontWeight: 900, color: '#0A2540' }}>No saved templates yet.</div>
          <div style={{ marginTop: 4, color: '#64748B', fontSize: 13 }}>Paste your first good campaign email above and it will stay here ready to reuse.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {sortedTemplates.map(template => (
            <article key={template.id} style={templateCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 420px' }}>
                  <div style={{ fontWeight: 900, fontSize: 18, color: '#0A2540' }}>{template.name}</div>
                  {template.subject && (
                    <div style={{ marginTop: 6, color: '#334155', fontSize: 14 }}><strong>Subject:</strong> {template.subject}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {template.subject && (
                    <button type="button" onClick={() => void copyText(template.subject, `${template.id}-subject`)} style={smallBtn}>
                      {copied === `${template.id}-subject` ? 'Copied ✓' : 'Copy subject'}
                    </button>
                  )}
                  <button type="button" onClick={() => void copyText(template.body, `${template.id}-body`)} style={smallBtn}>
                    {copied === `${template.id}-body` ? 'Copied ✓' : 'Copy email'}
                  </button>
                  <button type="button" onClick={() => editTemplate(template)} style={smallBtn}>Edit</button>
                  <button type="button" onClick={() => removeTemplate(template)} style={deleteBtn}>Delete</button>
                </div>
              </div>

              <div style={bodyPreview}>{template.body}</div>
              <div style={{ marginTop: 10, color: '#94A3B8', fontSize: 11 }}>
                Updated {new Date(template.updated_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </article>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

const templateCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 18,
  padding: 22,
  boxShadow: '0 5px 18px rgba(15,23,42,0.04)',
};

const bodyPreview: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  borderRadius: 14,
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  whiteSpace: 'pre-wrap',
  color: '#334155',
  lineHeight: 1.6,
  fontSize: 13,
  maxHeight: 220,
  overflow: 'auto',
};

const smallBtn: React.CSSProperties = {
  padding: '8px 11px',
  borderRadius: 9,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0F766E',
  fontWeight: 800,
  fontSize: 12,
  cursor: 'pointer',
};

const deleteBtn: React.CSSProperties = {
  ...smallBtn,
  color: '#B91C1C',
  borderColor: '#FECACA',
};

const empty: React.CSSProperties = {
  padding: 36,
  textAlign: 'center',
  border: '1px dashed #CBD5E1',
  borderRadius: 18,
  background: '#FFFFFF',
  color: '#64748B',
};
