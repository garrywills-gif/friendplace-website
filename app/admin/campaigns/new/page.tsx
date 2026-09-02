'use client';

import CampaignComposerPage from './CampaignComposerPage';
import { CampaignBodyRichTextEnhancer } from './CampaignBodyRichTextEnhancer';
import { CampaignDeliveryReviewEnhancer } from './CampaignDeliveryReviewEnhancer';
import { CampaignCtaUrlEnhancer } from './CampaignCtaUrlEnhancer';

export default function NewCampaignPage() {
  return (
    <>
      <CampaignComposerPage />
      <CampaignBodyRichTextEnhancer />
      <CampaignDeliveryReviewEnhancer />
      <CampaignCtaUrlEnhancer />
    </>
  );
}
