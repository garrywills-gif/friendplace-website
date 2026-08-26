'use client';

import CampaignComposerPage from './CampaignComposerPage';
import { CampaignBodyRichTextEnhancer } from './CampaignBodyRichTextEnhancer';

export default function NewCampaignPage() {
  return (
    <>
      <CampaignComposerPage />
      <CampaignBodyRichTextEnhancer />
    </>
  );
}
