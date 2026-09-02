import fs from 'node:fs';

const path = 'app/admin/campaigns/new/CampaignComposerPage.tsx';
let src = fs.readFileSync(path, 'utf8');
const before = 'sandbox=""';
const after = 'sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"';
if (!src.includes(before) && !src.includes(after)) {
  throw new Error('Campaign preview sandbox marker not found');
}
if (src.includes(before)) {
  src = src.replace(before, after);
  fs.writeFileSync(path, src);
}
console.log('✓ Campaign preview links enabled for user-initiated navigation');
