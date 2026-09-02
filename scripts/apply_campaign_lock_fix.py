from pathlib import Path
import json

p = Path('app/admin/campaigns/new/CampaignComposerPage.tsx')
s = p.read_text()

marker = '  // Debounced auto-save-as-draft, and auto-refresh audience count + preview'
if marker not in s:
    raise SystemExit('Expected autosave marker not found')

needle = "      if (!silent) showToast('Draft saved');\n      return c.id;"
repl = """      // CAMPAIGN_INVARIANT: NO_AUTOSAVE
      // A preview refresh is allowed only after this explicit save path has
      // persisted the draft. Opening or typing in a campaign must never PATCH it.
      try {
        const a = await campaignsApi.previewAudience(c.id);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(c.id);
        setPreviewHtml(r.html || '');
      } catch { /* preview refresh is non-fatal to saving */ }
      if (!silent) showToast('Draft saved');
      return c.id;"""
if needle not in s:
    raise SystemExit('saveDraft return block not found')
s = s.replace(needle, repl, 1)

start = s.index(marker)
end = s.index('\n\n  const doSend = async () => {', start)
new_effect = """  // CAMPAIGN_INVARIANT: NO_AUTOSAVE
  // Opening or editing a campaign is READ-ONLY until the admin deliberately
  // chooses Save draft, Send campaign, or Schedule. This prevents initial
  // Founding-Member defaults racing the async draft hydration and overwriting
  // a saved Outreach/manual/individual audience.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!campaignId) {
      setAudienceCount(null);
      setPreviewHtml('');
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const a = await campaignsApi.previewAudience(campaignId);
        setAudienceCount(a.count);
        const r = await campaignsApi.renderPreview(campaignId);
        setPreviewHtml(r.html || '');
      } catch { /* ignore transient preview errors */ }
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [campaignId]);"""
s = s[:start] + new_effect + s[end:]

old_send = """  const doSend = async () => {
    if (!campaignId) {
      const id = await saveDraft(true);
      if (!id) return;
    }
    setSending(true);
    try {
      const r = await campaignsApi.send(campaignId!);"""
new_send = """  const doSend = async () => {
    // CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SEND
    const id = await saveDraft(true);
    if (!id) return;
    setSending(true);
    try {
      const r = await campaignsApi.send(id);"""
if old_send not in s:
    raise SystemExit('doSend block not found')
s = s.replace(old_send, new_send, 1)
s = s.replace('setTimeout(() => router.push(`/admin/campaigns/${campaignId}`), 1200);',
              'setTimeout(() => router.push(`/admin/campaigns/${id}`), 1200);', 1)

old_sched = """  const doSchedule = async (localValue: string) => {
    if (!campaignId) {
      const id = await saveDraft(true);
      if (!id) return;
    }
    if (!localValue) { showToast('Pick a date and time'); return; }"""
new_sched = """  const doSchedule = async (localValue: string) => {
    if (!localValue) { showToast('Pick a date and time'); return; }
    // CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SCHEDULE
    const id = await saveDraft(true);
    if (!id) return;"""
if old_sched not in s:
    raise SystemExit('doSchedule block not found')
s = s.replace(old_sched, new_sched, 1)
s = s.replace('await campaignsApi.schedule(campaignId!, iso);', 'await campaignsApi.schedule(id, iso);', 1)

old_upload = """    const id = await saveDraft(true);
    if (!id) return;
    setAttachmentBusy(true);"""
new_upload = """    // CAMPAIGN_INVARIANT: ATTACHMENT_DOES_NOT_AUTOSAVE_COPY
    if (!campaignId) {
      showToast('Save the draft first, then upload the PDF');
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
      return;
    }
    const id = campaignId;
    setAttachmentBusy(true);"""
if old_upload not in s:
    raise SystemExit('attachment autosave block not found')
s = s.replace(old_upload, new_upload, 1)

s = s.replace('<div style={{ ...s.label, marginBottom: 8 }}>Live preview</div>',
              '<div style={{ ...s.label, marginBottom: 8 }}>Saved preview</div>', 1)
s = s.replace('Personalised with the first real recipient in the audience — same rendering path the send worker uses.',
              'Shows the last saved draft, personalised with a real recipient. Save draft to refresh it.', 1)
p.write_text(s)

guard = Path('scripts/check-campaign-invariants.mjs')
guard.write_text("""import fs from 'node:fs';
const composer = fs.readFileSync('app/admin/campaigns/new/CampaignComposerPage.tsx', 'utf8');
const review = fs.readFileSync('app/admin/campaigns/new/CampaignDeliveryReviewEnhancer.tsx', 'utf8');
const mustContain = [
  'CAMPAIGN_INVARIANT: NO_AUTOSAVE',
  'CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SEND',
  'CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SCHEDULE',
  \"kind === 'outreach_contacts'\",
  \"setRecipientMode('outreach')\",
  'defaultShowBadge: false',
  \"const [greeting, setGreeting] = useState<string>('Dear [Contact name],')\",
  'placeholder=\\\"https://…\\\"',
];
for (const token of mustContain) {
  if (!composer.includes(token)) throw new Error(`Campaign invariant missing: ${token}`);
}
const first = composer.indexOf('CAMPAIGN_INVARIANT: NO_AUTOSAVE', composer.indexOf('const saveDraft'));
const end = composer.indexOf('const doSend = async');
const effectRegion = composer.slice(first, end);
if (effectRegion.includes('await saveDraft(true)')) throw new Error('Campaign invariant violated: autosave has returned');
if (!review.includes(\"'preview-audience'\")) throw new Error('Recipient review endpoint contract missing');
console.log('✓ FriendPlace campaign invariants protected');
""")

package = Path('package.json')
data = json.loads(package.read_text())
if 'check-campaign-invariants.mjs' not in data['scripts'].get('build', ''):
    data['scripts']['build'] = 'node scripts/check-campaign-invariants.mjs && next build'
data['scripts']['check:campaigns'] = 'node scripts/check-campaign-invariants.mjs'
package.write_text(json.dumps(data, indent=2) + '\n')

# The patcher is one-shot; the permanent guard is check-campaign-invariants.mjs.
Path('scripts/apply_campaign_lock_fix.py').unlink()
