'use client';

/**
 * iter162 — Reminders (Mission Control V1, launch-safe).
 *
 * A quiet page for reminders created by George or by hand. No emails,
 * no publishing, no moderation actions — this is a personal-note
 * surface for Garry inside Mission Control.
 *
 * iter164g: migrated from a local ``apiFetch`` helper to the shared
 * ``remindersApi`` client in ``@/lib/cms-api``. Same behaviour, plus
 * fetchWithRetry + 401 auto-clear that every other admin surface has.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  remindersApi,
  type Reminder,
  type ReminderRecurrence as Recurrence,
  type ReminderStatus as Status,
} from '@/lib/cms-api';

export default function RemindersPage() {
  return (
    <AdminShell title="Reminders">
      <RemindersPanel />
    </AdminShell>
  );
}

function RemindersPanel() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | Status>('pending');
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((m: string, ms = 2400) => {
    setToast(m); setTimeout(() => setToast(null), ms);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await remindersApi.list(filter);
      setItems(r.items || []);
    } catch (e: any) {
      showToast(e?.message || 'Could not load reminders');
    } finally { setLoading(false); }
  }, [filter, showToast]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items, [items]);

  const doComplete = async (id: string) => {
    try {
      await remindersApi.complete(id);
      showToast('Marked complete');
      void load();
    } catch (e: any) { showToast(e?.message || 'Could not complete'); }
  };

  const doDelete = async (id: string) => {
    if (!confirm('Delete this reminder? This cannot be undone.')) return;
    try {
      await remindersApi.del(id);
      showToast('Deleted');
      void load();
    } catch (e: any) { showToast(e?.message || 'Could not delete'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['pending', 'completed', 'cancelled', 'all'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            data-testid={`reminders-filter-${f}`}
            style={{
              ...s.ghostBtn, padding: '6px 14px', fontSize: 12, fontWeight: 700,
              background: filter === f ? '#0F766E' : '#FFFFFF',
              color:      filter === f ? '#FFFFFF' : '#0A2540',
              borderColor: filter === f ? '#0F766E' : '#CBD5E1',
            }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setCreating(true)} style={s.primaryBtn} data-testid="reminders-new-btn">
          + New reminder
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', border: '1px dashed #CBD5E1', borderRadius: 12 }}>
          {filter === 'pending' ? 'Nothing pending. You’re on top of it.' : 'No reminders here.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(r => (
            <ReminderRow key={r.id} r={r}
              onComplete={() => doComplete(r.id)}
              onDelete={() => doDelete(r.id)}
              onEdit={() => setEditing(r)} />
          ))}
        </div>
      )}

      {creating && (
        <ReminderModal
          onCancel={() => setCreating(false)}
          onSaved={(msg) => { setCreating(false); showToast(msg); void load(); }}
        />
      )}
      {editing && (
        <ReminderModal
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); showToast(msg); void load(); }}
        />
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function ReminderRow({ r, onComplete, onDelete, onEdit }: {
  r: Reminder; onComplete: () => void; onDelete: () => void; onEdit: () => void;
}) {
  const due = new Date(r.due_at);
  const dueStr = isNaN(due.getTime()) ? r.due_at : due.toLocaleString();
  const overdue = r.status === 'pending' && due.getTime() < Date.now();
  return (
    <div data-testid={`reminder-row-${r.id}`} style={{
      background: '#FFFFFF', border: `1px solid ${overdue ? '#FCA5A5' : '#E2E8F0'}`,
      borderRadius: 14, padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0A2540' }}>{r.title}</div>
        {r.note && <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{r.note}</div>}
        <div style={{ fontSize: 12, color: overdue ? '#B91C1C' : '#64748B', marginTop: 6 }}>
          {overdue ? '⚠ Overdue · ' : ''}Due {dueStr}
          {r.recurrence !== 'none' && <> · recurring {r.recurrence}</>}
          {r.status !== 'pending' && <> · <strong>{r.status}</strong></>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {r.status === 'pending' && (
          <button type="button" onClick={onComplete} style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12 }}
            data-testid={`reminder-complete-${r.id}`}>
            ✓ Complete
          </button>
        )}
        <button type="button" onClick={onEdit} style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12 }}
          data-testid={`reminder-edit-${r.id}`}>Edit</button>
        <button type="button" onClick={onDelete} style={{ ...s.ghostBtn, padding: '6px 10px', fontSize: 12, color: '#B91C1C', borderColor: '#FCA5A5' }}
          data-testid={`reminder-delete-${r.id}`}>Delete</button>
      </div>
    </div>
  );
}

function ReminderModal({ initial, onCancel, onSaved }: {
  initial?: Reminder; onCancel: () => void; onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title || '');
  const [note, setNote] = useState(initial?.note || '');
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence || 'none');
  const [dueLocal, setDueLocal] = useState<string>(() => {
    const d = initial?.due_at ? new Date(initial.due_at) : new Date(Date.now() + 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const iso = new Date(dueLocal).toISOString();
      const body = { title, note, recurrence, due_at: iso };
      if (initial?.id) {
        await remindersApi.patch(initial.id, body);
        onSaved('Reminder updated');
      } else {
        await remindersApi.create(body);
        onSaved('Reminder created');
      }
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20,
    }}>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 28, maxWidth: 480, width: '100%' }}
        data-testid="reminder-modal">
        <h2 style={{ margin: '0 0 16px 0', fontSize: 20, color: '#0A2540' }}>
          {initial?.id ? 'Edit reminder' : 'New reminder'}
        </h2>
        <label style={s.label}>Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)} style={{ ...s.input, width: '100%' }}
          data-testid="reminder-title" placeholder="e.g. Follow up with Kellyville Library" />
        <label style={{ ...s.label, marginTop: 12 }}>Note (optional)</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...s.textarea, minHeight: 80 }}
          data-testid="reminder-note" />
        <label style={{ ...s.label, marginTop: 12 }}>Due</label>
        <input type="datetime-local" value={dueLocal} onChange={e => setDueLocal(e.target.value)}
          style={{ ...s.input, width: '100%' }} data-testid="reminder-due" />
        <label style={{ ...s.label, marginTop: 12 }}>Recurrence</label>
        <select value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}
          style={{ ...s.input, width: '100%' }} data-testid="reminder-recurrence">
          <option value="none">None (one-off)</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={saving} style={s.ghostBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving || !title.trim()} style={s.primaryBtn}
            data-testid="reminder-save">
            {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Create reminder')}
          </button>
        </div>
      </div>
    </div>
  );
}
