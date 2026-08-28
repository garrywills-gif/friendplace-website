'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  outreachApi,
  type OutreachOrg,
  type OutreachOrgIn,
  type OutreachStatus,
} from '@/lib/cms-api';
import { outreachArchiveApi } from '@/lib/outreach-archive-api';

const STATUS_LABELS: Record<OutreachStatus, string> = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  awaiting_reply: 'Awaiting our reply',
  replied: 'Replied',
  joined: 'Joined',
  declined: 'Declined',
  bounced: 'Bounced',
  unsubscribed: 'Unsubscribed',
};

const SHEETJS_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

type OutreachView = 'active' | 'archived';

type ImportRow = OutreachOrgIn & {
  rowNumber: number;
  valid: boolean;
  duplicate: boolean;
  issue?: string;
};

type ImportSkip = {
  rowNumber: number;
  organisation_name: string;
  email: string;
  issue: string;
};

type ImportResult = {
  imported: number;
  skipped: ImportSkip[];
};

type RawSheetRow = Record<string, unknown>;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function valueFor(row: RawSheetRow, ...names: string[]): string {
  const wanted = new Set(names.map(normaliseHeader));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normaliseHeader(key))) return text(value);
  }
  return '';
}

function mapStatus(raw: string): OutreachStatus {
  const value = normaliseHeader(raw);
  if (!value || value === 'notsent' || value === 'notcontacted') return 'not_contacted';
  if (value === 'contacted' || value === 'sent' || value === 'emailsent') return 'contacted';
  if (value === 'awaitingreply' || value === 'awaitingourreply') return 'awaiting_reply';
  if (value === 'replied' || value === 'replyreceived') return 'replied';
  if (value === 'joined') return 'joined';
  if (value === 'declined' || value === 'notinterested') return 'declined';
  if (value === 'bounced') return 'bounced';
  if (value === 'unsubscribed') return 'unsubscribed';
  return 'not_contacted';
}

function buildNotes(row: RawSheetRow): string {
  const notes = valueFor(row, 'Notes');
  const extras = [
    ['Role', valueFor(row, 'Role')],
    ['Address', valueFor(row, 'Address')],
    ['Source', valueFor(row, 'Source')],
    ['Date sent', valueFor(row, 'Date Sent', 'DateSent')],
    ['Reply', valueFor(row, 'Reply')],
    ['Follow-up', valueFor(row, 'Follow-up', 'Follow up', 'Followup')],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  return [notes, ...extras].filter(Boolean).join('\n');
}

async function ensureSheetJs(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Spreadsheet import is only available in the browser.');
  const existing = (window as any).XLSX;
  if (existing) return existing;

  await new Promise<void>((resolve, reject) => {
    const current = document.querySelector<HTMLScriptElement>(`script[src="${SHEETJS_SRC}"]`);
    if (current) {
      current.addEventListener('load', () => resolve(), { once: true });
      current.addEventListener('error', () => reject(new Error('Could not load spreadsheet reader.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SHEETJS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load spreadsheet reader.'));
    document.head.appendChild(script);
  });

  const loaded = (window as any).XLSX;
  if (!loaded) throw new Error('Spreadsheet reader loaded but did not initialise.');
  return loaded;
}

export default function OutreachPage() {
  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<OutreachView>('active');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showSkippedContacts, setShowSkippedContacts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = {
        q: q.trim() || undefined,
        status: status ? (status as OutreachStatus) : undefined,
        category: category || undefined,
        limit: 500,
      };

      const result = view === 'archived'
        ? await outreachArchiveApi.list(params)
        : await outreachApi.list(params);

      setRows(result.organisations || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load outreach organisations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status, category, view]);

  const categories = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => r.category).filter(Boolean)),
    ).sort();
  }, [rows]);

  const validImportRows = useMemo(
    () => importRows.filter((row) => row.valid && !row.duplicate),
    [importRows],
  );

  const skippedImportRows = importRows.length - validImportRows.length;

  const handleSpreadsheet = async (file: File) => {
    setError(null);
    setImportResult(null);
    setShowSkippedContacts(false);
    setImportRows([]);
    setImportFileName(file.name);

    try {
      const XLSX = await ensureSheetJs();
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('The spreadsheet has no worksheets.');

      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: '',
        raw: false,
      }) as RawSheetRow[];

      if (!rawRows.length) throw new Error('The first worksheet is empty.');

      const existingEmails = new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean));
      const fileEmails = new Set<string>();

      const mapped: ImportRow[] = rawRows.map((row, index) => {
        const organisationName = valueFor(row, 'Village', 'Organisation', 'Organization', 'Organisation Name', 'Village Name');
        const email = valueFor(row, 'Email', 'Email Address');
        const key = email.toLowerCase();
        const duplicate = Boolean(key && (existingEmails.has(key) || fileEmails.has(key)));
        if (key) fileEmails.add(key);

        let issue = '';
        if (!organisationName) issue = 'Missing village/organisation name';
        else if (!email) issue = 'Missing email';
        else if (!/^\S+@\S+\.\S+$/.test(email)) issue = 'Invalid email';
        else if (duplicate) issue = 'Email already exists';

        return {
          rowNumber: index + 2,
          organisation_name: organisationName,
          email,
          contact_name: valueFor(row, 'Contact', 'Contact Name', 'Name'),
          phone: valueFor(row, 'Phone', 'Telephone', 'Mobile'),
          category: 'retirement_village',
          tags: ['retirement_village', 'spreadsheet_import'],
          suburb: valueFor(row, 'Suburb'),
          state: valueFor(row, 'State'),
          notes: buildNotes(row),
          status: mapStatus(valueFor(row, 'Status')),
          valid: !issue,
          duplicate,
          issue: issue || undefined,
        };
      });

      setImportRows(mapped);
    } catch (e: any) {
      setImportRows([]);
      setError(e?.message || 'Could not read that spreadsheet.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runImport = async () => {
    if (!validImportRows.length || importing) return;

    setImporting(true);
    setError(null);
    setImportResult(null);
    setShowSkippedContacts(false);

    let created = 0;
    const skipped: ImportSkip[] = importRows
      .filter((row) => !row.valid || row.duplicate)
      .map((row) => ({
        rowNumber: row.rowNumber,
        organisation_name: row.organisation_name || `Spreadsheet row ${row.rowNumber}`,
        email: row.email || '',
        issue: row.issue || 'Skipped',
      }));

    for (const row of validImportRows) {
      try {
        const {
          rowNumber: _rowNumber,
          valid: _valid,
          duplicate: _duplicate,
          issue: _issue,
          ...payload
        } = row;
        await outreachApi.create(payload);
        created += 1;
      } catch {
        skipped.push({
          rowNumber: row.rowNumber,
          organisation_name: row.organisation_name || `Spreadsheet row ${row.rowNumber}`,
          email: row.email || '',
          issue: 'Import failed',
        });
      }
    }

    await load();
    setImportRows([]);
    setImportFileName('');
    setImporting(false);
    setImportResult({ imported: created, skipped });
  };

  const restore = async (org: OutreachOrg) => {
    setRestoringId(org.id);
    setError(null);
    try {
      await outreachArchiveApi.restore(org.id);
      setRows((current) => current.filter((row) => row.id !== org.id));
    } catch (e: any) {
      setError(e?.message || 'Could not restore organisation.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <AdminShell title="Organisation Outreach">
      <div style={topBar}>
        <div>
          <p style={intro}>
            Track retirement villages, community organisations, libraries,
            councils, clubs and other FriendPlace outreach contacts.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleSpreadsheet(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={adminStyles.ghostBtn}
          >
            ↑ Import spreadsheet
          </button>

          <Link
            href="/admin/outreach/new"
            style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}
          >
            + New organisation
          </Link>
        </div>
      </div>

      {importRows.length > 0 && (
        <div style={importCard}>
          <div style={importHeader}>
            <div>
              <div style={{ fontWeight: 900, color: '#0A2540' }}>Spreadsheet preview</div>
              <div style={muted}>
                {importFileName} · {validImportRows.length} ready to import
                {skippedImportRows ? ` · ${skippedImportRows} skipped` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setImportRows([]);
                  setImportFileName('');
                }}
                disabled={importing}
                style={adminStyles.ghostBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={!validImportRows.length || importing}
                style={{
                  ...adminStyles.primaryBtn,
                  opacity: !validImportRows.length || importing ? 0.6 : 1,
                  cursor: !validImportRows.length || importing ? 'not-allowed' : 'pointer',
                }}
              >
                {importing ? 'Importing…' : `Import ${validImportRows.length}`}
              </button>
            </div>
          </div>

          <div style={previewWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Row</th>
                  <th style={th}>Village</th>
                  <th style={th}>Email</th>
                  <th style={th}>Suburb</th>
                  <th style={th}>Result</th>
                </tr>
              </thead>
              <tbody>
                {importRows.slice(0, 20).map((row) => (
                  <tr key={`${row.rowNumber}-${row.email}`}>
                    <td style={td}>{row.rowNumber}</td>
                    <td style={td}>{row.organisation_name || '—'}</td>
                    <td style={td}>{row.email || '—'}</td>
                    <td style={td}>{row.suburb || '—'}</td>
                    <td style={td}>
                      {row.valid && !row.duplicate ? (
                        <span style={readyPill}>Ready</span>
                      ) : (
                        <span style={skipPill}>{row.issue || 'Skipped'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importRows.length > 20 && (
            <div style={{ ...muted, marginTop: 10 }}>
              Showing the first 20 of {importRows.length} spreadsheet rows.
            </div>
          )}
        </div>
      )}

      {importResult && (
        <div style={successBox}>
          <div style={{ fontWeight: 900 }}>
            Import complete: {importResult.imported} imported · {importResult.skipped.length} skipped
          </div>

          {importResult.skipped.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowSkippedContacts((open) => !open)}
                style={skippedToggle}
              >
                {showSkippedContacts ? 'Hide skipped contacts ↑' : 'View skipped contacts →'}
              </button>

              {showSkippedContacts && (
                <div style={skippedList}>
                  {importResult.skipped.map((row) => (
                    <div key={`${row.rowNumber}-${row.email}-${row.issue}`} style={skippedRow}>
                      <div style={{ fontWeight: 800, color: '#0A2540' }}>
                        {row.organisation_name}
                      </div>
                      <div style={{ color: '#92400E' }}>{row.issue}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={viewTabs}>
        <button
          type="button"
          onClick={() => setView('active')}
          style={view === 'active' ? activeViewTab : viewTab}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setView('archived')}
          style={view === 'archived' ? activeViewTab : viewTab}
        >
          Archived
        </button>
      </div>

      <div style={filters}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
          placeholder="Search organisation, contact or email…"
          style={{ ...adminStyles.input, marginBottom: 0, flex: '1 1 260px' }}
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 180 }}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...adminStyles.input, marginBottom: 0, minWidth: 190 }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void load()}
          style={adminStyles.ghostBtn}
        >
          Search
        </button>
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading organisations…</p>
      ) : rows.length === 0 ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 34 }}>{view === 'archived' ? '🗄️' : '🏢'}</div>
          <h3 style={{ margin: '8px 0', color: '#0A2540' }}>
            {view === 'archived' ? 'No archived organisations' : 'No outreach organisations yet'}
          </h3>
          <p style={{ color: '#64748B', margin: '0 0 16px' }}>
            {view === 'archived'
              ? 'Archived contacts will appear here and can be restored at any time.'
              : 'Add your first organisation or import the retirement-village spreadsheet.'}
          </p>

          {view === 'active' && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={adminStyles.ghostBtn}
              >
                ↑ Import spreadsheet
              </button>
              <Link
                href="/admin/outreach/new"
                style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}
              >
                + New organisation
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Organisation</th>
                <th style={th}>Contact</th>
                <th style={th}>Category</th>
                <th style={th}>Status</th>
                <th style={th}>Last contact</th>
                <th style={th}></th>
              </tr>
            </thead>

            <tbody>
              {rows.map((org) => {
                const outreachNumber = Number((org as any).outreach_number || 0);
                return (
                  <tr key={org.id}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {outreachNumber >= 20001 && (
                          <span style={outreachNumberPill}>#{outreachNumber}</span>
                        )}
                        <span style={{ fontWeight: 800, color: '#0A2540' }}>
                          {org.organisation_name}
                        </span>
                        {view === 'archived' && <span style={archivedPill}>Archived</span>}
                      </div>
                      {org.suburb && (
                        <div style={muted}>
                          {org.suburb}
                          {org.state ? `, ${org.state}` : ''}
                        </div>
                      )}
                    </td>

                    <td style={td}>
                      <div>{org.contact_name || '—'}</div>
                      <div style={muted}>{org.email}</div>
                    </td>

                    <td style={td}>
                      {org.category ? org.category.replace(/_/g, ' ') : '—'}
                    </td>

                    <td style={td}>
                      <span style={statusPill}>
                        {STATUS_LABELS[org.status] || org.status}
                      </span>
                    </td>

                    <td style={td}>
                      {org.last_contact_at
                        ? new Date(org.last_contact_at).toLocaleDateString('en-AU')
                        : '—'}
                    </td>

                    <td style={{ ...td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
                        {view === 'archived' && (
                          <button
                            type="button"
                            onClick={() => void restore(org)}
                            disabled={restoringId === org.id}
                            style={{ ...adminStyles.ghostBtn, opacity: restoringId === org.id ? 0.6 : 1 }}
                          >
                            {restoringId === org.id ? 'Restoring…' : 'Restore'}
                          </button>
                        )}
                        <Link href={`/admin/outreach/${org.id}`} style={viewLink}>
                          Open →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

const topBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 20,
};

const intro: React.CSSProperties = {
  margin: 0,
  color: '#475569',
  fontSize: 14,
  lineHeight: 1.6,
  maxWidth: 700,
};

const viewTabs: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 14,
};

const viewTab: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  color: '#475569',
  borderRadius: 999,
  padding: '7px 13px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};

const activeViewTab: React.CSSProperties = {
  ...viewTab,
  borderColor: '#0D9488',
  background: '#F0FDFA',
  color: '#0F766E',
};

const filters: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 18,
};

const importCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #99F6E4',
  borderRadius: 16,
  padding: 16,
  marginBottom: 18,
};

const importHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 12,
};

const previewWrap: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
};

const tableWrap: React.CSSProperties = {
  overflowX: 'auto',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
};

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#64748B',
  borderBottom: '1px solid #E2E8F0',
};

const td: React.CSSProperties = {
  padding: '14px',
  fontSize: 13,
  color: '#334155',
  borderBottom: '1px solid #F1F5F9',
  verticalAlign: 'top',
};

const muted: React.CSSProperties = {
  marginTop: 3,
  color: '#94A3B8',
  fontSize: 12,
};

const statusPill: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 9px',
  borderRadius: 999,
  background: '#F0FDFA',
  color: '#0F766E',
  fontWeight: 800,
  fontSize: 11,
};

const archivedPill: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 999,
  background: '#F1F5F9',
  color: '#64748B',
  border: '1px solid #CBD5E1',
  fontWeight: 800,
  fontSize: 11,
};

const outreachNumberPill: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 999,
  background: '#EFF6FF',
  color: '#1D4ED8',
  border: '1px solid #BFDBFE',
  fontWeight: 900,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
};

const readyPill: React.CSSProperties = {
  ...statusPill,
  background: '#ECFDF5',
  color: '#047857',
};

const skipPill: React.CSSProperties = {
  ...statusPill,
  background: '#FFF7ED',
  color: '#C2410C',
};

const viewLink: React.CSSProperties = {
  color: '#0F766E',
  fontWeight: 800,
  textDecoration: 'none',
};

const emptyCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px dashed #CBD5E1',
  borderRadius: 16,
  padding: '48px 24px',
  textAlign: 'center',
};

const successBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  background: '#ECFDF5',
  color: '#047857',
  fontSize: 13,
  fontWeight: 700,
};

const skippedToggle: React.CSSProperties = {
  marginTop: 8,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#0F766E',
  fontSize: 12,
  fontWeight: 900,
  cursor: 'pointer',
};

const skippedList: React.CSSProperties = {
  marginTop: 10,
  borderTop: '1px solid #A7F3D0',
};

const skippedRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '9px 0',
  borderBottom: '1px solid #D1FAE5',
  fontSize: 12,
  lineHeight: 1.4,
};

const errorBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  background: '#FEF2F2',
  color: '#B91C1C',
  fontSize: 13,
};
