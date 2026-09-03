'use client';

import CampaignComposerPage from './CampaignComposerPage';
import { CampaignBodyRichTextEnhancer } from './CampaignBodyRichTextEnhancer';
import { CampaignDeliveryReviewEnhancer } from './CampaignDeliveryReviewEnhancer';
import { CampaignCtaUrlEnhancer } from './CampaignCtaUrlEnhancer';
import { CampaignTemplateApplyEnhancer } from './CampaignTemplateApplyEnhancer';
import { CampaignAutosaveEnhancer } from './CampaignAutosaveEnhancer';

export default function NewCampaignPage() {
  return (
    <>
      <CampaignComposerPage />
      <CampaignBodyRichTextEnhancer />
      <CampaignDeliveryReviewEnhancer />
      <CampaignCtaUrlEnhancer />
      <CampaignTemplateApplyEnhancer />
      <CampaignAutosaveEnhancer />
    </>
  );
}