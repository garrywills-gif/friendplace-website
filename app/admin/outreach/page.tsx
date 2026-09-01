'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import { outreachApi, type OutreachOrg, type OutreachOrgIn, type OutreachStatus } from '@/lib/cms-api';
import { outreachArchiveApi, type OutreachListResponse } from '@/lib/outreach-archive-api';

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
type View = 'active' | 'archived';
type RawRow = Record<string, unknown>;
type ImportRow = OutreachOrgIn & { rowNumber: number; issue?: string };

const txt = (v: unknown) => v == null ? '' : String(v).trim();
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
function valueFor(row: RawRow, ...names: string[]) {
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(row)) if (wanted.has(norm(k))) return txt(v);
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
    retirementvillage: 'retirement_village', retirementvillages: 'retirement_village',
    u3a: 'u3a', u3anetwork: 'u3a', probus: 'probus', mensshed: 'mens_shed', menssheds: 'mens_shed',
    communitycentre: 'community_centre', communitycentres: 'community_centre',
    communityorganisation: 'community_organisation', communityorganisations: 'community_organisation',
    seniorsolderaustraliansorganisations: 'seniors_organisation',
    librariescouncilcommunityprograms: 'library_council',
  };
  return aliases[v] || raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'community_organisation';
}
function rowsFrom(result: OutreachListResponse): OutreachOrg[] {
  return result.rows || result.organisations || [];
}
async function sheetJs(): Promise<any> {
  if ((window as any).XLSX) return (window as any).XLSX;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script'); s.src = SHEETJS_SRC; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load spreadsheet reader.'));
    document.head.appendChild(s);
  });
  return (window as any).XLSX;
}

export default function OutreachPage() {
  const [rows, setRows] = useState<OutreachOrg[]>([]);
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const opts = { q: q.trim() || undefined, status: status ? status as OutreachStatus : undefined, category: category || undefined, limit: 500 };
      const result = view === 'archived' ? await outreachArchiveApi.list(opts) : await outreachArchiveApi.listActive(opts);
      setRows(rowsFrom(result));
    } catch (e: any) { setRows([]); setError(e?.message || 'Could not load outreach organisations.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [view, status, category]);

  const categories = useMemo(() => Array.from(new Set(rows.map(r => r.category).filter(Boolean))).sort(), [rows]);
  const ready = importRows.filter(r => !r.issue);

  const chooseSpreadsheet = async (file: File) => {
    setError(null); setImportMessage(''); setImportName(file.name);
    try {
      const XLSX = await sheetJs();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as RawRow[];
      const existing = new Set(rows.map(r => r.email?.trim().toLowerCase()).filter(Boolean));
      const seen = new Set<string>();
      setImportRows(raw.map((r, i) => {
        const organisation_name = valueFor(r, 'Village', 'Organisation', 'Organization', 'Organisation Name', 'Village Name');
        const email = valueFor(r, 'Email', 'Email Address');
        const key = email.toLowerCase();
        let issue = '';
        if (!organisation_name) issue = 'Missing organisation name';
        else if (!email) issue = 'Missing email';
        else if (!/^\S+@\S+\.\S+$/.test(email)) issue = 'Invalid email';
        else if (existing.has(key) || seen.has(key)) issue = 'Email already exists';
        if (key) seen.add(key);
        const cat = mapCategory(valueFor(r, 'Category', 'Type', 'Organisation Type', 'Organization Type'));
        const notes = [valueFor(r, 'Notes'), valueFor(r, 'Role') && `Role: ${valueFor(r, 'Role')}`, valueFor(r, 'Address') && `Address: ${valueFor(r, 'Address')}`, valueFor(r, 'Source') && `Source: ${valueFor(r, 'Source')}`].filter(Boolean).join('\n');
        return { rowNumber: i + 2, organisation_name, email, contact_name: valueFor(r, 'Contact', 'Contact Name', 'Name'), phone: valueFor(r, 'Phone', 'Telephone', 'Mobile'), category: cat, tags: [cat, 'spreadsheet_import'], suburb: valueFor(r, 'Suburb', 'City / Suburb', 'City'), state: valueFor(r, 'State'), notes, status: mapStatus(valueFor(r, 'Status')), issue: issue || undefined };
      }));
    } catch (e: any) { setImportRows([]); setError(e?.message || 'Could not read that spreadsheet.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const runImport = async () => {
    if (!ready.length || importing) return;
    setImporting(true); setError(null); let imported = 0; let failed = 0;
    for (const row of ready) {
      const { rowNumber: _n, issue: _i, ...payload } = row;
      try { await outreachApi.create(payload); imported++; } catch { failed++; }
    }
    setImportRows([]); setImportName(''); setImportMessage(`${imported} imported${failed ? ` · ${failed} failed` : ''}`); setImporting(false); await load();
  };

  const restore = async (org: OutreachOrg) => {
    setRestoring(org.id); setError(null);
    try { await outreachArchiveApi.restore(org.id); setRows(current => current.filter(r => r.id !== org.id)); }
    catch (e: any) { setError(e?.message || 'Could not restore organisation.'); }
    finally { setRestoring(null); }
  };

  return <AdminShell title="Organisation Outreach">
    <div style={topBar}>
      <p style={intro}>Your complete outreach register — organisations and groups you have contacted or plan to contact.</p>
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e => { const f=e.target.files?.[0]; if(f) void chooseSpreadsheet(f); }} />
        <button type="button" style={adminStyles.ghostBtn} onClick={() => fileRef.current?.click()}>↑ Import spreadsheet</button>
        <Link href="/admin/outreach/new" style={{...adminStyles.primaryBtn,textDecoration:'none'}}>+ New organisation</Link>
      </div>
    </div>

    {importRows.length > 0 && <div style={notice}>
      <strong>{importName}</strong> · {ready.length} ready · {importRows.length-ready.length} skipped
      <div style={{display:'flex',gap:8,marginTop:10}}>
        <button type="button" style={adminStyles.ghostBtn} onClick={() => setImportRows([])}>Cancel</button>
        <button type="button" style={adminStyles.primaryBtn} disabled={!ready.length||importing} onClick={() => void runImport()}>{importing?'Importing…':`Import ${ready.length}`}</button>
      </div>
      {importRows.some(r=>r.issue) && <div style={{marginTop:10,fontSize:12,color:'#92400E'}}>{importRows.filter(r=>r.issue).slice(0,8).map(r=><div key={r.rowNumber}>Row {r.rowNumber}: {r.organisation_name||r.email||'Unknown'} — {r.issue}</div>)}</div>}
    </div>}
    {importMessage && <div style={success}>{importMessage}</div>}

    <div style={tabs}>
      <button type="button" onClick={()=>setView('active')} style={view==='active'?activeTab:tab}>Active</button>
      <button type="button" onClick={()=>setView('archived')} style={view==='archived'?activeTab:tab}>Archived</button>
    </div>
    <div style={filters}>
      <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void load();}} placeholder="Search organisation, contact or email…" style={{...adminStyles.input,marginBottom:0,flex:'1 1 300px'}} />
      <select value={status} onChange={e=>setStatus(e.target.value)} style={{...adminStyles.input,marginBottom:0,minWidth:180}}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
      <select value={category} onChange={e=>setCategory(e.target.value)} style={{...adminStyles.input,marginBottom:0,minWidth:190}}><option value="">All categories</option>{categories.map(c=><option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}</select>
      <button type="button" onClick={()=>void load()} style={adminStyles.ghostBtn}>Search</button>
    </div>

    {error && <div style={errorBox}>{error}</div>}
    {loading ? <p style={{color:'#64748B'}}>Loading organisations…</p> : !error && rows.length===0 ? <div style={empty}><h3>{view==='archived'?'No archived organisations':'No outreach organisations yet'}</h3><p>{view==='archived'?'Archived organisations will appear here.':'Import a spreadsheet or add an organisation to begin.'}</p></div> : !error && <div style={tableWrap}><table style={table}><thead><tr><th style={th}>Organisation</th><th style={th}>Category</th><th style={th}>Contact</th><th style={th}>Status</th><th style={th}>Last contact</th><th style={th}>Action</th></tr></thead><tbody>{rows.map(org=><tr key={org.id}>
      <td style={td}><strong style={{color:'#0A2540'}}>{org.organisation_name}</strong>{org.suburb&&<div style={muted}>{org.suburb}{org.state?`, ${org.state}`:''}</div>}</td>
      <td style={td}>{org.category?org.category.replace(/_/g,' '):'—'}</td>
      <td style={td}>{org.contact_name||'—'}<div style={muted}>{org.email}</div></td>
      <td style={td}><span style={org.status==='not_contacted'?notContactedPill:contactedPill}>{STATUS_LABELS[org.status]||org.status}</span></td>
      <td style={td}>{org.last_contact_at?new Date(org.last_contact_at).toLocaleDateString('en-AU'):'—'}</td>
      <td style={{...td,textAlign:'right'}}>{view==='archived'&&<button type="button" style={adminStyles.ghostBtn} disabled={restoring===org.id} onClick={()=>void restore(org)}>{restoring===org.id?'Restoring…':'Restore'}</button>} <Link href={`/admin/outreach/${org.id}`} style={openLink}>View →</Link></td>
    </tr>)}</tbody></table></div>}
  </AdminShell>;
}

const topBar:React.CSSProperties={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:20};
const intro:React.CSSProperties={margin:0,color:'#475569',fontSize:14,lineHeight:1.6,maxWidth:760};
const tabs:React.CSSProperties={display:'flex',gap:6,marginBottom:14};
const tab:React.CSSProperties={border:'1px solid #CBD5E1',background:'#FFF',color:'#475569',borderRadius:999,padding:'7px 13px',fontSize:12,fontWeight:800,cursor:'pointer'};
const activeTab:React.CSSProperties={...tab,borderColor:'#0D9488',background:'#F0FDFA',color:'#0F766E'};
const filters:React.CSSProperties={display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',marginBottom:18};
const tableWrap:React.CSSProperties={overflowX:'auto',background:'#FFF',border:'1px solid #E2E8F0',borderRadius:16};
const table:React.CSSProperties={width:'100%',borderCollapse:'collapse'};
const th:React.CSSProperties={textAlign:'left',padding:'14px',fontSize:11,letterSpacing:'.08em',textTransform:'uppercase',color:'#64748B',borderBottom:'1px solid #E2E8F0'};
const td:React.CSSProperties={padding:'15px 14px',fontSize:13,color:'#334155',borderBottom:'1px solid #F1F5F9',verticalAlign:'top'};
const muted:React.CSSProperties={marginTop:3,color:'#94A3B8',fontSize:12};
const contactedPill:React.CSSProperties={display:'inline-block',padding:'4px 10px',borderRadius:999,background:'#ECFDF5',color:'#047857',fontWeight:800,fontSize:11};
const notContactedPill:React.CSSProperties={...contactedPill,background:'#F8FAFC',color:'#64748B',border:'1px solid #CBD5E1'};
const openLink:React.CSSProperties={color:'#0F766E',fontWeight:800,textDecoration:'none',marginLeft:8};
const empty:React.CSSProperties={background:'#FFF',border:'1px dashed #CBD5E1',borderRadius:16,padding:'44px 24px',textAlign:'center',color:'#64748B'};
const notice:React.CSSProperties={background:'#FFF',border:'1px solid #99F6E4',borderRadius:14,padding:14,marginBottom:16,color:'#334155',fontSize:13};
const success:React.CSSProperties={background:'#ECFDF5',color:'#047857',borderRadius:10,padding:12,marginBottom:16,fontSize:13,fontWeight:800};
const errorBox:React.CSSProperties={background:'#FEF2F2',color:'#B91C1C',borderRadius:10,padding:12,marginBottom:16,fontSize:13};
