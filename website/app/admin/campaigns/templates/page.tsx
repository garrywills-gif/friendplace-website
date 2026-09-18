'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';

type SavedCampaignTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  body_html?: string;
  created_at: string;
  updated_at: string;
};

const STORAGE_KEY = 'friendplace.mcgs.campaignTemplates.v1';
const APPLY_KEY = 'friendplace.mcgs.campaignTemplateToApply.v1';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function plainTextToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function sanitiseEmailHtml(input: string) {
  if (typeof window === 'undefined') return input;
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'DIV', 'SPAN']);

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const keepHref = child.tagName === 'A' && attr.name === 'href';
        if (!keepHref) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute('href');
      }
      walk(child);
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

function htmlToPlainText(html: string) {
  if (typeof window === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.innerText || doc.body.textContent || '').trim();
}

export default function CampaignTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<SavedCampaignTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState('/admin/campaigns');
  const [returningToCampaign, setReturningToCampaign] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer && referrer.origin === window.location.origin && referrer.pathname === '/admin/campaigns/new') {
        setReturnTo(`${referrer.pathname}${referrer.search}`);
        setReturningToCampaign(true);
      }
    } catch {
      // If the referrer cannot be read, fall back to the campaign list.
    }

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

  const setEditorContent = (html: string) => {
    const safe = sanitiseEmailHtml(html);
    setBodyHtml(safe);
    setBody(htmlToPlainText(safe));
    if (editorRef.current) editorRef.current.innerHTML = safe;
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSubject('');
    setBody('');
    setBodyHtml('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const saveTemplate = () => {
    const cleanName = name.trim();
    const cleanSubject = subject.trim();
    const cleanBody = body.trim();
    const cleanHtml = sanitiseEmailHtml(bodyHtml || plainTextToHtml(cleanBody));
    if (!cleanName || !cleanBody) return;

    const now = new Date().toISOString();
    if (editingId) {
      setTemplates(current => current.map(item => item.id === editingId
        ? { ...item, name: cleanName, subject: cleanSubject, body: cleanBody, body_html: cleanHtml, updated_at: now }
        : item));
    } else {
      setTemplates(current => [{
        id: makeId(),
        name: cleanName,
        subject: cleanSubject,
        body: cleanBody,
        body_html: cleanHtml,
        created_at: now,
        updated_at: now,
      }, ...current]);
    }
    resetForm();
  };

  const editTemplate = (template: SavedCampaignTemplate) => {
    const html = template.body_html || plainTextToHtml(template.body);
    setEditingId(template.id);
    setName(template.name);
    setSubject(template.subject);
    setBody(template.body);
    setBodyHtml(html);
    window.setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = html;
    }, 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeTemplate = (template: SavedCampaignTemplate) => {
    if (!window.confirm(`Delete template “${template.name}”?`)) return;
    setTemplates(current => current.filter(item => item.id !== template.id));
    if (editingId === template.id) resetForm();
  };

  const useTemplate = (template: SavedCampaignTemplate) => {
    if (!returningToCampaign) return;
    try {
      window.sessionStorage.setItem(APPLY_KEY, JSON.stringify({
        returnTo,
        subject: template.subject || '',
        body: template.body || '',
        body_html: sanitiseEmailHtml(template.body_html || plainTextToHtml(template.body)),
      }));
    } catch {
      return;
    }
    router.push(returnTo);
  };

  const flashCopied = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied(current => current === key ? null : current), 1600);
  };

  const copyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    flashCopied(key);
  };

  const copyEmail = async (template: SavedCampaignTemplate) => {
    const key = `${template.id}-body`;
    const html = sanitiseEmailHtml(template.body_html || plainTextToHtml(template.body));
    const plain = template.body;

    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      flashCopied(key);
    } catch {
      await navigator.clipboard.writeText(plain);
      flashCopied(key);
    }
  };

  const updateFromEditor = () => {
    const html = sanitiseEmailHtml(editorRef.current?.innerHTML || '');
    setBodyHtml(html);
    setBody(htmlToPlainText(html));
  };

  return (
    <AdminShell title="Campaign Templates">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <p style={{ margin: 0, color: '#475569', maxWidth: 720, lineHeight: 1.6 }}>
            Keep your best campaign emails here, then use one directly in the campaign you are working on.
          </p>
          <p style={{ margin: '6px 0 0', color: '#94A3B8', fontSize: 12 }}>
            Saved privately in this browser on this device. Bold, italic, lists and links are preserved when pasted here.
          </p>
        </div>
        <button type="button" onClick={() => router.push(returnTo)} style={{ ...s.ghostBtn }}>
          {returningToCampaign ? '← Back to Campaign' : '← Campaigns'}
        </button>
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
        <div style={richToolbar}>
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { document.execCommand('bold'); updateFromEditor(); }} style={formatBtn}><strong>B</strong></button>
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { document.execCommand('italic'); updateFromEditor(); }} style={formatBtn}><em>I</em></button>
          <span style={{ color: '#94A3B8', fontSize: 12 }}>Paste formatted email text here — bold will stay bold.</span>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={updateFromEditor}
          onPaste={() => window.setTimeout(updateFromEditor, 0)}
          data-placeholder="Paste the email you want to keep here…"
          style={richEditor}
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
          {sortedTemplates.map(template => {
            const previewHtml = sanitiseEmailHtml(template.body_html || plainTextToHtml(template.body));
            return (
              <article key={template.id} style={templateCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 420px' }}>
                    <div style={{ fontWeight: 900, fontSize: 18, color: '#0A2540' }}>{template.name}</div>
                    {template.subject && (
                      <div style={{ marginTop: 6, color: '#334155', fontSize: 14 }}><strong>Subject:</strong> {template.subject}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {returningToCampaign && (
                      <button type="button" onClick={() => useTemplate(template)} style={useBtn}>Use this template</button>
                    )}
                    {template.subject && (
                      <button type="button" onClick={() => void copyText(template.subject, `${template.id}-subject`)} style={smallBtn}>
                        {copied === `${template.id}-subject` ? 'Copied ✓' : 'Copy subject'}
                      </button>
                    )}
                    <button type="button" onClick={() => void copyEmail(template)} style={smallBtn}>
                      {copied === `${template.id}-body` ? 'Copied ✓' : 'Copy email'}
                    </button>
                    <button type="button" onClick={() => editTemplate(template)} style={smallBtn}>Edit</button>
                    <button type="button" onClick={() => removeTemplate(template)} style={deleteBtn}>Delete</button>
                  </div>
                </div>

                <div style={bodyPreview} dangerouslySetInnerHTML={{ __html: previewHtml }} />
                <div style={{ marginTop: 10, color: '#94A3B8', fontSize: 11 }}>
                  Updated {new Date(template.updated_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </article>
            );
          })}
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

const richToolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  border: '1.5px solid #CBD5E1',
  borderBottom: 'none',
  borderRadius: '12px 12px 0 0',
  background: '#F8FAFC',
};

const formatBtn: React.CSSProperties = {
  width: 32,
  height: 30,
  borderRadius: 7,
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0A2540',
  cursor: 'pointer',
  fontSize: 14,
};

const richEditor: React.CSSProperties = {
  minHeight: 240,
  padding: '14px',
  borderRadius: '0 0 12px 12px',
  border: '1.5px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#0A2540',
  fontSize: 15,
  lineHeight: 1.6,
  outline: 'none',
  overflowY: 'auto',
};

const bodyPreview: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  borderRadius: 14,
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
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

const useBtn: React.CSSProperties = {
  ...smallBtn,
  background: '#0F766E',
  color: '#FFFFFF',
  borderColor: '#0F766E',
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