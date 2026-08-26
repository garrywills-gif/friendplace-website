'use client';

import CampaignComposerPage from './CampaignComposerPage';
import { CampaignBodyRichTextEnhancer } from './CampaignBodyRichTextEnhancer';
import { CampaignDeliveryReviewEnhancer } from './CampaignDeliveryReviewEnhancer';

export default function NewCampaignPage() {
  return (
    <>
      <CampaignComposerPage />
      <CampaignBodyRichTextEnhancer />
      <CampaignDeliveryReviewEnhancer />
    </>
  );
}
