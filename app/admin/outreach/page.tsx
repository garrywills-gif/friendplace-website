'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { campaignsApi, outreachApi, type Campaign, type OutreachOrg, type OutreachOrgIn, type OutreachStatus } from '@/lib/cms-api';
import { outreachArchiveApi, type OutreachListResponse } from '@/lib/outreach-archive-api';

const CATEGORY_LABELS: Record<string, string> = {
  retirement_village: 'Retirement Villages',
  u3a: 'U3A',
  mens_shed: "Men's Sheds",
  probus: 'Probus Clubs',
  community_centre: 'Community Centres',
  community_organisation: 'Community Organisations',
  rsl_club: 'RSL / Clubs',
  rsl: 'RSL / Clubs',
  library_council: 'Libraries',
  library: 'Libraries',
  seniors_organisation: 'Seniors Organisations',
  event_submission: 'Event Submissions',
  outreach: 'Other Outreach',
};

const SHEETJS_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
type View = 'active' | 'archived';
type RawRow = Record<string, unknown>;
type ImportRow = OutreachOrgIn & {
  rowNumber: number;
  sourceFile: string;
  issue?: string;
  serverError?: string;
  imported?: boolean;
};

type Group = {
  slug: string;
  label: string;
  total: number;
  contacted: number;
  notContacted: number;
  lastContactAt: string | null;
};

const txt = (v: unknown) => (v == null ? '' : String(v).trim());
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

function valueFor(row: RawRow, ...names: string[]) {
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(row)) {
    if (wanted.has(norm(k))) return txt(v);
  }
  return '';
}

function mapStatus(raw: string): OutreachStatus {
  const v = norm(raw);
  if (v === 'contacted' || v === 'sent' || v === 'emailsent') return 'contacted';
  if (v === 'awaitingreply' || v === 'awaitingourreply') return 'awaiting_reply';
  if (v === 'replied' || v === 'replyreceived') return 'replied';
  if (v === 'joined') return 'joined';
  if (v === 'declined' || v === 'notinterested') return 'declined';
  if (v === 'bounced') return 'bounced';
  if (v === 'unsubscribed') return 'unsubscribed';
  return 'not_contacted';
}

function mapCategory(raw: string) {
  const v = norm(raw);
  const aliases: Record<string, string> = {
    retirementvillage: 'retirement_village',
    retirementvillages: 'retirement_village',
    u3a: 'u3a',
    u3anetwork: 'u3a',
    probus: 'probus',
    mensshed: 'mens_shed',
    menssheds: 'mens_shed',
    communitycentre: 'community_centre',
    communitycentres: 'community_centre',
    communityorganisation: 'community_organisation',
    communityorganisations: 'community_organisation',
    library: 'library_council',
    libraries: 'library_council',
    seniorsolderaustraliansorganisations: 'seniors_organisation',
    seniorsolderaustraliansorganisation: 'seniors_organisation',
    olderaustraliansorganisation: 'seniors_organisation',
    librariescouncilcommunityprograms: 'library_council',
    librarycouncilcommunityprograms: 'library_council',
  };
  return aliases[v] || raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'community_organisation';
}

function categoryFromFilename(name: string) {
  const v = norm(name.replace(/\.(xlsx|xls|csv)$/i, ''));
  if (v.includes('retirement') || v.includes('agedcare')) return 'retirement_village';
  if (v.includes('u3a')) return 'u3a';
  if (v.includes('probus')) return 'probus';
  if (v.includes('mensshed')) return 'mens_shed';
  if (v.includes('communitycentre') || v.includes('communitycenter')) return 'community_centre';
  if (v.includes('rsl') || v.includes('club')) return 'rsl_club';
  if (v.includes('library') || v.includes('libraries') || v.includes('council')) return 'library_council';
  if (v.includes('senior') || v.includes('olderaustralian')) return 'seniors_organisation';
  return 'community_organisation';
}

function labelFor(slug: string) {
  if (!slug) return 'Uncategorised';
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  return slug.split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function rowsFrom(result: OutreachListResponse): OutreachOrg[] {
  return result.rows || result.organisations || [];
}

function formatSaved(value?: string) {
  if (!value) return 'recently';
  try {
    return new Date(value).toLocaleString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return value;
  }
}

async function sheetJs(): Promise<any> {
  if ((window as any).XLSX) return (window as any).XLSX;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SHEETJS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load spreadsheet reader.')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = SHEETJS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load spreadsheet reader.'));
    document.head.appendChild(s);
  });
  if (!(window as any).XLSX) throw new Error('Spreadsheet reader loaded but did not initialise.');
  return (window as any).XLSX;
}

function isPositiveTouch(status: OutreachStatus | string | undefined) {
  return Boolean(status && String(status) !== 'not_contacted');
}

function orgMatchesQuery(o: OutreachOrg, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [o.organisation_name, o.contact_name, o.email, o.phone, o.suburb, o.state, o.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function aggregateGroups(orgs: OutreachOrg[], q: string): Group[] {
  const buckets = new Map<string, OutreachOrg[]>();
  for (const org of orgs) {
    const slug = (org.category && String(org.category).trim()) || 'uncategorised';
    buckets.set(slug, [...(buckets.get(slug) || []), org]);
  }

  const needle = q.trim().toLowerCase();
  const groups: Group[] = [];
  for (const [slug, list] of buckets.entries()) {
    const label = labelFor(slug);
    if (needle && !label.toLowerCase().includes(needle) && !list.some(org => orgMatchesQuery(org, needle))) continue;

    let contacted = 0;
    let notContacted = 0;
    let lastContactAt: string | null = null;
    for (const org of list) {
      if (isPositiveTouch(org.status)) contacted += 1;
      else notContacted += 1;
      if (org.last_contact_at && (!lastContactAt || org.last_contact_at > lastContactAt)) lastContactAt = org.last_contact_at;
    }
    groups.push({ slug, label, total: list.length, contacted, notContacted, lastContactAt });
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

export default function OutreachPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [creatingCampaignFor, setCreatingCampaignFor] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [draftByCat, setDraftByCat] = useState<Record<string, Campaign>>({});
  const [summaryFilter, setSummaryFilter] = useState<'all' | 'contacted' | 'not_contacted' | 'unsubscribed'>('all');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async (preserveCurrentError = false) => {
    setLoading(true);
    if (!preserveCurrentError) setError(null);
    try {
      const opts = { limit: 2000 };
      const result = view === 'archived' ? await outreachArchiveApi.list(opts) : await outreachArchiveApi.listActive(opts);
      setRows(rowsFrom(result));
    } catch (e: any) {
      setRows([]);
      setError(e?.message || 'Could not load outreach organisations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [view]);

  // Recognise saved (draft) campaigns per outreach category so a group
  // with an unfinished campaign shows "Continue campaign →" instead of
  // "Create campaign". Most-recent draft wins per category. Sent /
  // scheduled / sending campaigns are never treated as resumable, so
  // campaign history is untouched.
  const loadDrafts = async () => {
    try {
      const res = await campaignsApi.list();
      const map: Record<string, Campaign> = {};
      for (const c of res.rows || []) {
        if (c.status !== 'draft') continue;
        const cat = c.audience_filter?.outreach?.category;
        if (!cat) continue;
        const when = (t?: string) => t || '';
        const existing = map[cat];
        const cWhen = when(c.updated_at) || when(c.created_at);
        const eWhen = existing ? (when(existing.updated_at) || when(existing.created_at)) : '';
        if (!existing || cWhen > eWhen) map[cat] = c;
      }
      setDraftByCat(map);
    } catch {
      // Draft recognition is a convenience; never block the group list.
    }
  };

  useEffect(() => {
    void loadDrafts();
  }, [view]);

  const totalOrgs = rows.length;
  const totalContacted = rows.filter(r => isPositiveTouch(r.status) && r.status !== 'unsubscribed').length;
  const totalNotContacted = rows.filter(r => r.status === 'not_contacted').length;
  const totalUnsubscribed = rows.filter(r => r.status === 'unsubscribed').length;
  const filteredSummaryRows = rows.filter(r => {
    if (summaryFilter === 'all') return true;
    if (summaryFilter === 'contacted') return isPositiveTouch(r.status) && r.status !== 'unsubscribed';
    return r.status === summaryFilter;
  });
  const unsubscribedRows = rows
    .filter(r => r.status === 'unsubscribed')
    .sort((a, b) => {
      const aDate = a.updated_at || a.last_contact_at || '';
      const bDate = b.updated_at || b.last_contact_at || '';
      return bDate.localeCompare(aDate);
    });
  const groups = useMemo(
    () => aggregateGroups(filteredSummaryRows, qLive),
    [filteredSummaryRows, qLive],
  );
  const ready = importRows.filter(r => !r.issue && !r.imported);
  const failedServerRows = importRows.filter(r => Boolean(r.serverError));

  const chooseSpreadsheets = async (files: File[]) => {
    setError(null);
    setImportMessage('');
    setImportRows([]);
    if (!files.length) return;
    setImportName(files.length === 1 ? files[0].name : `${files.length} spreadsheets`);

    try {
      const XLSX = await sheetJs();
      const existingEmails = new Set(rows.map(r => r.email?.trim().toLowerCase()).filter(Boolean));
      const seen = new Set<string>();
      const mapped: ImportRow[] = [];

      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) continue;
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { defval: '', raw: false }) as RawRow[];
        const fallbackCategory = categoryFromFilename(file.name);

        raw.forEach((r, i) => {
          const organisation_name = valueFor(r, 'Village', 'Organisation', 'Organization', 'Organisation Name', 'Village Name');
          const email = valueFor(r, 'Email', 'Email Address');
          const key = email.toLowerCase();
          let issue = '';
          if (!organisation_name) issue = 'Missing organisation name';
          else if (!email) issue = 'Missing email';
          else if (!/^\S+@\S+\.\S+$/.test(email)) issue = 'Invalid email';
          else if (existingEmails.has(key) || seen.has(key)) issue = 'Email already exists';
          if (key) seen.add(key);

          const rawCategory = valueFor(r, 'Category', 'Type', 'Organisation Type', 'Organization Type');
          const category = rawCategory ? mapCategory(rawCategory) : fallbackCategory;
          const notes = [
            valueFor(r, 'Notes'),
            valueFor(r, 'Role') && `Role: ${valueFor(r, 'Role')}`,
            valueFor(r, 'Address') && `Address: ${valueFor(r, 'Address')}`,
            valueFor(r, 'Source') && `Source: ${valueFor(r, 'Source')}`,
            valueFor(r, 'Date Sent', 'DateSent') && `Date sent: ${valueFor(r, 'Date Sent', 'DateSent')}`,
            valueFor(r, 'Reply') && `Reply: ${valueFor(r, 'Reply')}`,
            valueFor(r, 'Follow-up', 'Follow up', 'Followup') && `Follow-up: ${valueFor(r, 'Follow-up', 'Follow up', 'Followup')}`,
          ].filter(Boolean).join('\n');

          mapped.push({
            rowNumber: i + 2,
            sourceFile: file.name,
            organisation_name,
            email,
            contact_name: valueFor(r, 'Contact', 'Contact Name', 'Name'),
            phone: valueFor(r, 'Phone', 'Telephone', 'Mobile'),
            category,
            tags: [category, 'spreadsheet_import'],
            suburb: valueFor(r, 'Suburb', 'City / Suburb', 'City'),
            state: valueFor(r, 'State'),
            notes,
            status: mapStatus(valueFor(r, 'Status')),
            issue: issue || undefined,
          });
        });
      }

      setImportRows(mapped);
      if (!mapped.length) setError('No organisation rows were found in the selected spreadsheet files.');
    } catch (e: any) {
      setImportRows([]);
      setError(e?.message || 'Could not read those spreadsheets.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runImport = async () => {
    if (!ready.length || importing) return;
    setImporting(true);
    setError(null);
    setImportMessage('');

    let imported = 0;
    let failed = 0;
    const nextRows: ImportRow[] = importRows.map(r => ({ ...r, serverError: undefined }));

    for (let i = 0; i < nextRows.length; i += 1) {
      const row = nextRows[i];
      if (row.issue || row.imported) continue;
      const { rowNumber: _n, sourceFile: _f, issue: _i, serverError: _s, imported: _done, ...payload } = row;
      try {
        await outreachApi.create(payload);
        row.imported = true;
        imported += 1;
      } catch (e: any) {
        row.serverError = e?.message || 'Import failed';
        failed += 1;
      }
    }

    setImportRows(nextRows);
    setImportMessage(`${imported} imported${failed ? ` · ${failed} failed` : ''}`);
    setImporting(false);
    await load(true);

    if (failed) {
      const examples = nextRows.filter(r => r.serverError).slice(0, 5).map(r => `${r.organisation_name}: ${r.serverError}`);
      setError(`The server rejected ${failed} organisation${failed === 1 ? '' : 's'}. ${examples.join(' · ')}`);
    } else {
      setError(null);
      setImportRows([]);
      setImportName('');
    }
  };

  const createCampaignForGroup = async (g: Group) => {
    if (view !== 'active' || !g.notContacted || creatingCampaignFor) return;
    setCreatingCampaignFor(g.slug);
    setError(null);
    try {
      const campaign = await campaignsApi.create({
        name: `${g.label} — not contacted`,
        template: 'announcement',
        companion: 'team',
        title: 'A note from FriendPlace',
        greeting: 'Dear [Contact name],',
        show_founder_badge: false,
        audience_filter: {
          audience_kind: 'outreach_contacts',
          outreach: {
            category: g.slug,
            status: 'not_contacted',
          },
        } as any,
      });
      router.push(`/admin/campaigns/new?id=${encodeURIComponent(campaign.id)}`);
    } catch (e: any) {
      setError(e?.message || `Could not create a campaign for ${g.label}.`);
      setCreatingCampaignFor(null);
    }
  };

  const deleteGroup = async (g: Group) => {
    if (view !== 'active' || g.contacted > 0 || deletingGroup) return;
    if (!window.confirm(`Delete all ${g.total} organisations in "${g.label}"? This cannot be undone.`)) return;
    setDeletingGroup(g.slug);
    setError(null);
    setImportMessage('');
    try {
      const result = await outreachArchiveApi.deleteGroup(g.slug);
      setImportMessage(`${result.deleted} organisation${result.deleted === 1 ? '' : 's'} deleted from ${g.label}.`);
      await load(true);
    } catch (e: any) {
      setError(e?.message || `Could not delete ${g.label}.`);
    } finally {
      setDeletingGroup(null);
    }
  };

  return (
    <AdminShell title="Organisation Outreach">
      <div style={topBar}>
        <p style={intro}>Your complete outreach register, grouped by organisation type. Click a group to see the organisations inside and their contact history.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              if (files.length) void chooseSpreadsheets(files);
            }}
          />
          <button type="button" style={adminStyles.ghostBtn} onClick={() => fileRef.current?.click()}>↑ Import spreadsheet</button>
          <Link href="/admin/outreach/new" style={{ ...adminStyles.primaryBtn, textDecoration: 'none' }}>+ New organisation</Link>
        </div>
      </div>

      {importRows.length > 0 && (
        <div style={notice}>
          <div><strong>{importName}</strong> · {ready.length} ready · {importRows.filter(r => r.issue).length} skipped{failedServerRows.length ? ` · ${failedServerRows.length} server rejected` : ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" style={adminStyles.ghostBtn} disabled={importing} onClick={() => { setImportRows([]); setImportName(''); setError(null); }}>Cancel</button>
            <button type="button" style={adminStyles.primaryBtn} disabled={!ready.length || importing} onClick={() => void runImport()}>
              {importing ? 'Importing…' : failedServerRows.length ? `Retry ${ready.length}` : `Import ${ready.length}`}
            </button>
          </div>
          {(importRows.some(r => r.issue) || failedServerRows.length > 0) && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              {importRows.filter(r => r.issue || r.serverError).slice(0, 12).map(r => (
                <div key={`${r.sourceFile}-${r.rowNumber}`} style={{ marginTop: 5, color: r.serverError ? '#B91C1C' : '#92400E' }}>
                  <strong>{r.sourceFile} · Row {r.rowNumber}</strong> — {r.organisation_name || r.email || 'Unknown'} — {r.serverError || r.issue}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {importMessage && <div style={success}>{importMessage}</div>}

      <div style={tabs}>
        <button type="button" onClick={() => { setView('active'); setSummaryFilter('all'); }} style={view === 'active' ? activeTab : tab}>Active</button>
        <button type="button" onClick={() => { setView('archived'); setSummaryFilter('all'); }} style={view === 'archived' ? activeTab : tab}>Archived</button>
      </div>

      <div style={filters}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setQLive(q); }} placeholder="Search group, organisation, contact or email…" style={{ ...adminStyles.input, marginBottom: 0, flex: '1 1 300px' }} />
        <button type="button" onClick={() => setQLive(q)} style={adminStyles.ghostBtn}>Search</button>
        {qLive && <button type="button" onClick={() => { setQ(''); setQLive(''); }} style={{ ...adminStyles.ghostBtn, color: '#B91C1C', borderColor: '#FCA5A5' }}>Clear</button>}
      </div>

      {!loading && view === 'active' && (
        <div style={summaryGrid} aria-label="Outreach totals">
          <OutreachSummaryCard
            label="Total organisations"
            value={totalOrgs}
            active={summaryFilter === 'all'}
            onClick={() => setSummaryFilter('all')}
          />
          <OutreachSummaryCard
            label="Contacted"
            value={totalContacted}
            active={summaryFilter === 'contacted'}
            onClick={() => setSummaryFilter('contacted')}
          />
          <OutreachSummaryCard
            label="Not contacted"
            value={totalNotContacted}
            active={summaryFilter === 'not_contacted'}
            onClick={() => setSummaryFilter('not_contacted')}
          />
          <OutreachSummaryCard
            label="Unsubscribed"
            value={totalUnsubscribed}
            active={summaryFilter === 'unsubscribed'}
            alert={totalUnsubscribed > 0}
            onClick={() => setSummaryFilter('unsubscribed')}
          />
        </div>
      )}

      {view === 'archived' && <div style={archiveNotice}><strong>Archived organisations</strong><span>These are hidden from the normal Outreach view. Their contact history is retained.</span></div>}
      {error && <div style={errorBox}>{error}</div>}

      {loading ? (
        <div style={emptyState}>Loading outreach groups…</div>
      ) : view === 'active' && summaryFilter === 'unsubscribed' ? (
        unsubscribedRows.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 48 }}>✅</div>
            <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 6, color: '#0A2540' }}>No unsubscribed organisations.</p>
          </div>
        ) : (
          <div style={tableCard}>
            <div style={unsubscribeHeader}>
              <div style={{ flex: '1.7 1 0' }}>Organisation</div>
              <div style={{ flex: '1.4 1 0' }}>Email</div>
              <div style={{ flex: '1 1 0' }}>Group</div>
              <div style={{ flex: '0.8 1 0' }}>Location</div>
              <div style={{ flex: '0.9 1 0' }}>Status</div>
              <div style={{ flex: '0 0 90px', textAlign: 'right' }}>Action</div>
            </div>
            {unsubscribedRows.map(org => (
              <div key={org.id} style={unsubscribeRow}>
                <div style={{ flex: '1.7 1 0', minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 14 }}>{org.organisation_name}</div>
                  {org.contact_name && (
                    <div style={{ marginTop: 2, color: '#64748B', fontSize: 12 }}>{org.contact_name}</div>
                  )}
                </div>
                <div style={{ flex: '1.4 1 0', minWidth: 0, color: '#B91C1C', fontSize: 13, textDecoration: 'line-through' }}>
                  {org.email || '—'}
                </div>
                <div style={{ flex: '1 1 0', color: '#475569', fontSize: 12, fontWeight: 700 }}>
                  {labelFor(org.category || 'uncategorised')}
                </div>
                <div style={{ flex: '0.8 1 0', color: '#64748B', fontSize: 12 }}>
                  {[org.suburb, org.state].filter(Boolean).join(', ') || '—'}
                </div>
                <div style={{ flex: '0.9 1 0', color: '#B91C1C', fontSize: 12, fontWeight: 800 }}>
                  ⛔ DO NOT EMAIL
                </div>
                <div style={{ flex: '0 0 90px', textAlign: 'right' }}>
                  <Link href={`/admin/outreach/${org.id}`} style={{ ...openLink, textDecoration: 'none' }}>
                    View →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : groups.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 48 }}>{view === 'archived' ? '🗄️' : '📮'}</div>
          <p style={{ fontWeight: 700, fontSize: 16, marginTop: 12, marginBottom: 6, color: '#0A2540' }}>{view === 'archived' ? 'No archived organisations.' : qLive ? 'No groups match your search.' : 'No outreach organisations yet.'}</p>
        </div>
      ) : (
        <div style={tableCard}>
          <div style={tableHeader}>
            <div style={{ flex: '2 1 0' }}>Outreach group</div>
            <div style={{ flex: '0.8 1 0', textAlign: 'right' }}>Organisations</div>
            <div style={{ flex: '0.9 1 0', textAlign: 'right' }}>Contacted</div>
            <div style={{ flex: '1 1 0', textAlign: 'right' }}>Not contacted</div>
            <div style={{ flex: '1.2 1 0' }}>Last contact</div>
            <div style={{ flex: '0 0 150px', textAlign: 'right' }}>Action</div>
          </div>
          {groups.map(g => {
            const href = `/admin/outreach/group/${encodeURIComponent(g.slug)}${view === 'archived' ? '?archived=true' : ''}`;
            const lastLabel = g.lastContactAt ? new Date(g.lastContactAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
            const creating = creatingCampaignFor === g.slug;
            const deleting = deletingGroup === g.slug;
            const draft = view === 'active' ? draftByCat[g.slug] : undefined;
            return (
              <div key={g.slug} style={rowLine}>
                <div style={{ flex: '2 1 0', minWidth: 0 }}>
                  <Link href={href} style={{ textDecoration: 'none' }}>
                    <div style={{ fontWeight: 800, color: '#0A2540', fontSize: 15 }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{g.slug === 'uncategorised' ? 'No category set' : g.slug}</div>
                  </Link>
                </div>
                <div style={{ flex: '0.8 1 0', textAlign: 'right', fontWeight: 800, color: '#0A2540' }}>{g.total}</div>
                <div style={{ flex: '0.9 1 0', textAlign: 'right' }}><span style={g.contacted ? contactedPill : neutralPill}>{g.contacted}</span></div>
                <div style={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={g.notContacted ? notContactedPill : neutralPill}>{g.notContacted}</span>
                  {draft ? (
                    <div style={continueWrap}>
                      <Link
                        href={`/admin/campaigns/new?id=${encodeURIComponent(draft.id)}`}
                        style={continueBtn}
                      >
                        Continue campaign →
                      </Link>
                      <span style={draftLabel}>
                        Draft saved · {formatSaved(draft.updated_at || draft.created_at)}
                      </span>
                    </div>
                  ) : (
                    view === 'active' && g.notContacted > 0 && (
                      <button
                        type="button"
                        style={campaignBtn}
                        disabled={Boolean(creatingCampaignFor)}
                        onClick={() => void createCampaignForGroup(g)}
                      >
                        {creating ? 'Creating…' : 'Create campaign'}
                      </button>
                    )
                  )}
                </div>
                <div style={{ flex: '1.2 1 0', fontSize: 13, color: '#475569' }}>{lastLabel}</div>
                <div style={{ flex: '0 0 150px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                  {view === 'active' && (
                    <button
                      type="button"
                      style={{ ...deleteBtn, opacity: g.contacted > 0 ? 0.45 : 1, cursor: g.contacted > 0 ? 'not-allowed' : 'pointer' }}
                      disabled={g.contacted > 0 || Boolean(deletingGroup)}
                      title={g.contacted > 0 ? 'Groups with contact history cannot be bulk deleted.' : `Delete all ${g.total} organisations in this group`}
                      onClick={() => void deleteGroup(g)}
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                  <Link href={href} style={{ ...openLink, textDecoration: 'none' }}>View →</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}

function OutreachSummaryCard({
  label,
  value,
  active,
  alert = false,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...summaryCard,
        ...(active ? summaryCardActive : {}),
        ...(alert && !active ? summaryCardAlert : {}),
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ marginTop: 4, fontSize: 26, lineHeight: 1, fontWeight: 900 }}>{value}</span>
    </button>
  );
}

const topBar: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginTop: -8, marginBottom: 22 };
const intro: React.CSSProperties = { margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.6, maxWidth: 760 };
const tabs: React.CSSProperties = { display: 'flex', gap: 6, marginBottom: 14 };
const tab: React.CSSProperties = { border: '1px solid #CBD5E1', background: '#FFF', color: '#475569', borderRadius: 999, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const activeTab: React.CSSProperties = { ...tab, borderColor: '#0D9488', background: '#F0FDFA', color: '#0F766E' };
const filters: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 };
const summaryGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 };
const summaryCard: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '14px 16px', minHeight: 78, borderRadius: 14, border: '1px solid #DCE5EE', background: '#FFFFFF', color: '#0A2540', cursor: 'pointer', textAlign: 'left', boxShadow: '0 3px 12px rgba(15,23,42,0.03)' };
const summaryCardActive: React.CSSProperties = { border: '2px solid #14B8A6', background: '#F0FDFA', color: '#0F766E', padding: '13px 15px' };
const summaryCardAlert: React.CSSProperties = { border: '1px solid #FCA5A5', background: '#FFF7F7', color: '#B91C1C' };
const archiveNotice: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#475569', fontSize: 12 };
const tableCard: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18, overflow: 'hidden' };
const unsubscribeHeader: React.CSSProperties = { display: 'flex', padding: '12px 18px', background: '#FFF7F7', borderBottom: '1px solid #FECACA', gap: 12, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: '#991B1B' };
const unsubscribeRow: React.CSSProperties = { display: 'flex', padding: '15px 18px', alignItems: 'center', gap: 12, borderTop: '1px solid #FEE2E2' };
const tableHeader: React.CSSProperties = { display: 'flex', padding: '12px 18px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', gap: 12, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800, color: '#64748B' };
const rowLine: React.CSSProperties = { display: 'flex', padding: '16px 18px', alignItems: 'center', gap: 12, borderTop: '1px solid #F1F5F9' };
const contactedPill: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontWeight: 800, fontSize: 12, minWidth: 28, textAlign: 'center' };
const notContactedPill: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', fontWeight: 800, fontSize: 12, minWidth: 28, textAlign: 'center' };
const neutralPill: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, background: '#F1F5F9', color: '#64748B', fontWeight: 800, fontSize: 12, minWidth: 28, textAlign: 'center' };
const campaignBtn: React.CSSProperties = { border: '1px solid #99F6E4', background: '#F0FDFA', color: '#0F766E', borderRadius: 9, padding: '5px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
const continueWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 };
const continueBtn: React.CSSProperties = { border: '1px solid #0D9488', background: '#0D9488', color: '#FFFFFF', borderRadius: 9, padding: '5px 10px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', textDecoration: 'none' };
const draftLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#0F766E', whiteSpace: 'nowrap' };
const deleteBtn: React.CSSProperties = { border: '1px solid #FCA5A5', background: '#FFF', color: '#B91C1C', borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' };
const openLink: React.CSSProperties = { color: '#0F766E', fontWeight: 800 };
const emptyState: React.CSSProperties = { padding: 48, textAlign: 'center', color: '#64748B', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 18 };
const notice: React.CSSProperties = { background: '#FFF', border: '1px solid #99F6E4', borderRadius: 14, padding: 14, marginBottom: 16, color: '#334155', fontSize: 13 };
const success: React.CSSProperties = { background: '#ECFDF5', color: '#047857', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, fontWeight: 800 };
const errorBox: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 };
