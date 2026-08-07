'use client';

/**
 * Launch Manager — MCGS
 *
 * The Launch Manager is one screen for the launch of FriendPlace. It
 * has three sections:
 *   1. George's Launch Readiness — a short observation (not a checklist).
 *   2. Countdown  — date/time (Sydney canonical), enable toggle, welcome copy.
 *   3. Store links — Apple + Google (validated).
 *   4. Launch checklist — auto-derived from the state above +
 *      three manual toggles (press kit / launch complete + founding target).
 *
 * Timezone contract:
 *   - Storage is UTC.
 *   - This page shows Sydney time as canonical (labelled).
 *   - Visitors see the countdown in their local browser time (public site).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { cmsApi, type LaunchReadiness, type LaunchSettings } from '@/lib/cms-api';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

export default function LaunchPage() {
  const [settings, setSettings] = useState<LaunchSettings | null>(null);
  const [readiness, setReadiness] = useState<LaunchReadiness | null>(null);
  const [draft, setDraft] = useState<Partial<LaunchSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cmsApi.getLaunchSettings();
      setSettings(r.settings);
      setReadiness(r.readiness);
      setDraft({});
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load launch settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live tick for the countdown preview at the top.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  const merged: LaunchSettings | null = useMemo(() => {
    if (!settings) return null;
    return { ...settings, ...draft };
  }, [settings, draft]);

  // Discriminated union so `preview.live ? ... : ...` narrows correctly
  // for the countdown segments below (TS 5.x otherwise widens the
  // false-branch return to include undefined properties).
  type LaunchPreview =
    | { live: true }
    | { live: false; days: number; hours: number; minutes: number; seconds: number };

  const preview = useMemo<LaunchPreview | null>(() => {
    if (!merged || !merged.enabled || !merged.launch_at) return null;
    const target = new Date(merged.launch_at).getTime();
    if (Number.isNaN(target)) return null;
    const diff = target - Date.now();
    if (diff <= 0 || merged.launch_complete) return { live: true };
    const total = Math.max(0, Math.floor(diff / 1000));
    return {
      live: false,
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
     
  }, [merged, tick]);

  async function handleSave() {
    if (!Object.keys(draft).length) return;
    setSaving(true);
    try {
      const r = await cmsApi.updateLaunchSettings(draft);
      setSettings(r.settings);
      setReadiness(r.readiness);
      setDraft({});
      setBanner({ tone: 'ok', text: '✅ Launch settings saved.' });
    } catch (e: any) {
      setBanner({ tone: 'err', text: e?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  function bindText<K extends keyof LaunchSettings>(key: K) {
    return {
      value: (merged?.[key] as string | undefined) ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [key]: e.target.value })),
    };
  }

  function bindBool<K extends keyof LaunchSettings>(key: K) {
    return {
      checked: !!merged?.[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setDraft((d) => ({ ...d, [key]: e.target.checked })),
    };
  }

  // Split UTC ISO into local <input type="date"> and <input type="time">
  // values for editing, and reassemble on save.
  const { dateVal, timeVal } = useMemo(() => {
    const iso = merged?.launch_at;
    if (!iso) return { dateVal: '', timeVal: '' };
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return { dateVal: `${y}-${m}-${day}`, timeVal: `${hh}:${mm}` };
    } catch { return { dateVal: '', timeVal: '' }; }
  }, [merged?.launch_at]);

  function setDateTime(date: string, time: string) {
    if (!date) { setDraft((d) => ({ ...d, launch_at: null })); return; }
    const t = time || '09:00';
    const local = new Date(`${date}T${t}:00`);
    if (Number.isNaN(local.getTime())) return;
    setDraft((d) => ({ ...d, launch_at: local.toISOString() }));
  }

  const dirty = Object.keys(draft).length > 0;

  const sydneyText = merged?.launch_at
    ? new Date(merged.launch_at).toLocaleString('en-AU', {
        timeZone: 'Australia/Sydney',
        dateStyle: 'full',
        timeStyle: 'short',
      })
    : '';

  return (
    <AdminShell title="Launch">
      <p style={lede}>
        Everything for the FriendPlace launch, in one place.
        Storage is UTC · Mission Control shows <strong>Sydney time</strong> as canonical ·
        visitors see the countdown in their own local time.
      </p>

      {loading && <div style={helperText}>Loading…</div>}
      {error && <div style={errBanner}>{error}</div>}

      {banner && (
        <div style={banner.tone === 'ok' ? okBanner : errBanner}>{banner.text}</div>
      )}

      {settings && merged && readiness && (
        <>
          {/* George's Launch Readiness — observation, not checklist */}
          <section style={readinessCard(readiness.tone)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}><GeorgeButterflyMark size={22} /></span>
              <span style={readinessLabel}>George&apos;s Launch Readiness</span>
              <span style={{ marginLeft: 'auto' }}>
                <AskGeorgeAboutThis
                  label="Ask George"
                  contextType="launch_manager"
                  context={{
                    surface: 'launch_manager',
                    launch: {
                      launch_at: merged.launch_at,
                      enabled: merged.enabled,
                      is_live: !!preview?.live,
                      appstore_url: merged.appstore_url,
                      playstore_url: merged.playstore_url,
                      press_kit_ready: merged.press_kit_ready,
                      launch_complete: merged.launch_complete,
                      founding_target: merged.founding_target,
                      founding_current: readiness.founding.current,
                    },
                    readiness: {
                      text: readiness.text,
                      tone: readiness.tone,
                      checklist: readiness.checklist,
                    },
                  }}
                  prompts={[
                    'What still needs to be done before launch?',
                    'Should I enable the public countdown yet?',
                    'How are the founding member registrations tracking against the target?',
                    'What would you focus on this week to be ready?',
                  ]}
                />
              </span>
            </div>
            <p style={readinessText}>{readiness.text}</p>
          </section>

          {/* Countdown preview — reflects current *draft* state so admins see
              what the ribbon will look like before saving. */}
          {preview && (
            <section style={previewCard}>
              {preview.live ? (
                <span style={previewLive}>{merged.welcome_message || '🦋 The doors are open. Welcome to FriendPlace.'}</span>
              ) : (
                <>
                  <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}><GeorgeButterflyMark size={22} /></span>
                  <span style={previewLabel}>Visitors will see:</span>
                  <span style={previewCountdown}>
                    <PreviewSeg value={preview.days} label="Days" />
                    <span style={previewDot}>·</span>
                    <PreviewSeg value={preview.hours} label="Hours" />
                    <span style={previewDot}>·</span>
                    <PreviewSeg value={preview.minutes} label="Minutes" />
                    <span style={previewDot}>·</span>
                    <PreviewSeg value={preview.seconds} label="Sec" small />
                  </span>
                </>
              )}
            </section>
          )}

          {/* Section 1: Countdown */}
          <section style={panel}>
            <h2 style={h2}>Countdown</h2>
            <div style={grid2}>
              <label style={label}>Launch date
                <input
                  type="date"
                  value={dateVal}
                  onChange={(e) => setDateTime(e.target.value, timeVal)}
                  style={input}
                />
              </label>
              <label style={label}>Launch time
                <input
                  type="time"
                  value={timeVal}
                  onChange={(e) => setDateTime(dateVal, e.target.value)}
                  style={input}
                />
              </label>
            </div>
            {sydneyText && (
              <div style={sydneyBox}>
                <strong>Sydney time: </strong>{sydneyText}
              </div>
            )}
            <label style={{ ...checkboxRow, marginTop: 14 }}>
              <input type="checkbox" {...bindBool('enabled')} />
              <span>
                <strong>Enable public countdown ribbon.</strong>{' '}
                <span style={hint}>Not dismissible during the countdown — everyone sees it.</span>
              </span>
            </label>
            <label style={{ ...label, marginTop: 14 }}>Welcome message when doors open
              <input
                type="text"
                {...bindText('welcome_message')}
                placeholder="🦋 The doors are open. Welcome to FriendPlace."
                style={input}
              />
              <span style={hint}>Shown when the countdown reaches zero, with the store buttons.</span>
            </label>
          </section>

          {/* Section 2: Store links */}
          <section style={panel}>
            <h2 style={h2}>Store links</h2>
            <span style={hint}>Only exposed to visitors <strong>after</strong> the countdown reaches zero — so a leaked URL can&apos;t be hit early.</span>
            <label style={{ ...label, marginTop: 10 }}>App Store URL
              <input
                type="url"
                {...bindText('appstore_url')}
                placeholder="https://apps.apple.com/au/app/friendplace/id…"
                style={input}
              />
            </label>
            <label style={label}>Google Play URL
              <input
                type="url"
                {...bindText('playstore_url')}
                placeholder="https://play.google.com/store/apps/details?id=com.friendplace"
                style={input}
              />
            </label>
          </section>

          {/* Section 3: Manual toggles + founding target */}
          <section style={panel}>
            <h2 style={h2}>Manual state</h2>
            <label style={{ ...label, maxWidth: 320 }}>Founding Members target
              <input
                type="number"
                min={0}
                value={merged.founding_target}
                onChange={(e) => setDraft((d) => ({ ...d, founding_target: parseInt(e.target.value || '0', 10) }))}
                style={input}
              />
              <span style={hint}>
                Current: <strong>{readiness.founding.current}</strong> · Target: <strong>{readiness.founding.target}</strong>
              </span>
            </label>
            <label style={{ ...checkboxRow, marginTop: 10 }}>
              <input type="checkbox" {...bindBool('press_kit_ready')} />
              <span>Press kit ready</span>
            </label>
            <label style={{ ...checkboxRow, marginTop: 6 }}>
              <input type="checkbox" {...bindBool('launch_complete')} />
              <span>
                Launch complete{' '}
                <span style={hint}>(auto-flips at launch_at — you can manually override either way)</span>
              </span>
            </label>
          </section>

          {/* Section 4: Auto-derived checklist */}
          <section style={panel}>
            <h2 style={h2}>Launch checklist</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              <ChecklistItem ok={readiness.checklist.launch_date_set} label="Launch date is set" />
              <ChecklistItem ok={readiness.checklist.countdown_enabled} label="Public countdown enabled" />
              <ChecklistItem ok={readiness.checklist.appstore_link} label="App Store link is set" />
              <ChecklistItem ok={readiness.checklist.playstore_link} label="Google Play link is set" />
              <ChecklistItem
                ok={readiness.checklist.founding_target_met}
                label={`Founding Members target met (${readiness.founding.current} of ${readiness.founding.target})`}
              />
              <ChecklistItem ok={readiness.checklist.press_kit_ready} label="Press kit ready" />
              <ChecklistItem ok={readiness.checklist.launch_complete} label="Launch complete" />
            </ul>
          </section>

          {/* Save bar */}
          <div style={saveBar}>
            {dirty ? (
              <>
                <span style={{ color: '#78350F', fontSize: 13 }}>You have unsaved changes.</span>
                <button type="button" onClick={() => setDraft({})} style={cancelBtn} disabled={saving}>Discard</button>
                <button type="button" onClick={handleSave} style={saveBtn} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <span style={{ color: '#64748B', fontSize: 13 }}>All changes saved.</span>
            )}
          </div>
        </>
      )}
    </AdminShell>
  );
}

function PreviewSeg({ value, label, small }: { value: number; label: string; small?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ ...previewSegValue, opacity: small ? 0.65 : 1 }}>{value}</span>
      <span style={previewSegLabel}>{label}</span>
    </span>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 22, height: 22, borderRadius: 11, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800,
        background: ok ? '#ECFDF5' : '#F1F5F9',
        color: ok ? '#065F46' : '#94A3B8',
        border: `1px solid ${ok ? '#A7F3D0' : '#CBD5E1'}`,
      }}>{ok ? '✓' : '·'}</span>
      <span style={{ fontSize: 14, color: ok ? '#0F172A' : '#64748B' }}>{label}</span>
    </li>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const lede: React.CSSProperties = { color: '#475569', marginTop: -8, marginBottom: 20, maxWidth: 820, lineHeight: 1.55 };
const helperText: React.CSSProperties = { color: '#64748B', fontSize: 13, marginTop: 8 };
const errBanner: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 12 };
const okBanner: React.CSSProperties = { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 12 };
const panel: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18, marginTop: 16 };
const h2: React.CSSProperties = { margin: '0 0 12px', fontSize: 16, fontWeight: 800, color: '#0F172A' };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' };
const input: React.CSSProperties = { padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, background: '#FFFFFF', color: '#0F172A', width: '100%', fontFamily: 'inherit', fontWeight: 500, textTransform: 'none', letterSpacing: 0 };
const hint: React.CSSProperties = { fontSize: 12, color: '#64748B', fontWeight: 500, textTransform: 'none', letterSpacing: 0 };
const checkboxRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: '#0F172A' };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
const sydneyBox: React.CSSProperties = { marginTop: 10, background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 13 };

// readiness card — tone-adaptive palette
function readinessCard(tone: 'ready' | 'wait' | 'warn' | 'live'): React.CSSProperties {
  const palette = {
    ready: { bg: '#ECFDF5', border: '#A7F3D0', label: '#065F46' },
    wait:  { bg: '#EEF2FF', border: '#C7D2FE', label: '#3730A3' },
    warn:  { bg: '#FEF3C7', border: '#FBBF24', label: '#78350F' },
    live:  { bg: '#F0FDF4', border: '#86EFAC', label: '#166534' },
  }[tone];
  return {
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    borderRadius: 12,
    padding: '14px 16px',
    marginTop: 4,
  };
}
const readinessLabel: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.06em' };
const readinessText: React.CSSProperties = { margin: 0, fontSize: 14, color: '#0F172A', lineHeight: 1.5 };

// preview card (visitor countdown)
const previewCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, background: '#0A2540', color: '#E8F4FF', borderRadius: 12, padding: '12px 16px', marginTop: 12, flexWrap: 'wrap', boxShadow: '0 6px 20px rgba(15,23,42,0.12)' };
const previewLive: React.CSSProperties = { fontSize: 16, fontWeight: 700 };
const previewLabel: React.CSSProperties = { fontSize: 13, color: '#B7DFF7', fontWeight: 600 };
const previewCountdown: React.CSSProperties = { display: 'inline-flex', alignItems: 'baseline', gap: 6 };
const previewSegValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' };
const previewSegLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#5EEAD4', textTransform: 'uppercase', letterSpacing: '0.06em' };
const previewDot: React.CSSProperties = { color: 'rgba(94,234,212,0.55)', fontWeight: 700, margin: '0 2px' };

// save bar
const saveBar: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 18, padding: 12, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12 };
const cancelBtn: React.CSSProperties = { padding: '8px 14px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const saveBtn: React.CSSProperties = { padding: '8px 16px', background: '#0F172A', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
