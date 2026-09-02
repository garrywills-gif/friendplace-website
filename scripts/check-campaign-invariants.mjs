import fs from 'node:fs';
const composer = fs.readFileSync('app/admin/campaigns/new/CampaignComposerPage.tsx', 'utf8');
const review = fs.readFileSync('app/admin/campaigns/new/CampaignDeliveryReviewEnhancer.tsx', 'utf8');
const greetingPreset = fs.readFileSync('app/admin/campaigns/new/CampaignGreetingPresetEnhancer.tsx', 'utf8');
const mustContain = [
  'CAMPAIGN_INVARIANT: NO_AUTOSAVE',
  'CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SEND',
  'CAMPAIGN_INVARIANT: EXPLICIT_SAVE_BEFORE_SCHEDULE',
  "kind === 'outreach_contacts'",
  "setRecipientMode('outreach')",
  'defaultShowBadge: false',
  "const [greeting, setGreeting] = useState<string>('Dear [Contact name],')",
  'placeholder="https://…"',
];
for (const token of mustContain) {
  if (!composer.includes(token)) throw new Error(`Campaign invariant missing: ${token}`);
}
const first = composer.indexOf('CAMPAIGN_INVARIANT: NO_AUTOSAVE', composer.indexOf('const saveDraft'));
const end = composer.indexOf('const doSend = async');
const effectRegion = composer.slice(first, end);
if (effectRegion.includes('await saveDraft(true)')) throw new Error('Campaign invariant violated: autosave has returned');
if (!review.includes("'preview-audience'")) throw new Error('Recipient review endpoint contract missing');
for (const token of [
  "'Dear [Contact name],'",
  "'Hi [Contact name],'",
  "'Hello [Contact name],'",
  "label: 'No greeting'",
  "templateSelect.value !== 'community_outreach'",
]) {
  if (!greetingPreset.includes(token)) throw new Error(`Outreach greeting preset invariant missing: ${token}`);
}
console.log('✓ FriendPlace campaign invariants protected');
