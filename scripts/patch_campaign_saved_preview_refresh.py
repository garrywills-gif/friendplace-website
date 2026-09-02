from pathlib import Path

p = Path('app/admin/campaigns/new/CampaignComposerPage.tsx')
s = p.read_text()
old = """      if (!silent) showToast('Draft saved');\n      return c.id;\n"""
new = """      // Explicit saves must refresh the persisted preview immediately.\n      // This is NOT autosave: it only runs after Save / Send / Schedule has\n      // deliberately persisted the campaign. It also fixes existing drafts\n      // where campaignId does not change, so the [campaignId] preview effect\n      // would otherwise keep showing stale CTA/copy.\n      try {\n        const a = await campaignsApi.previewAudience(c.id);\n        setAudienceCount(a.count);\n        const r = await campaignsApi.renderPreview(c.id);\n        setPreviewHtml(r.html || '');\n      } catch { /* saving succeeded; preview refresh is non-fatal */ }\n      if (!silent) showToast('Draft saved');\n      return c.id;\n"""
if old not in s:
    raise SystemExit('Target save block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# Strengthen the guard so explicit save must refresh persisted preview.
g = Path('scripts/check-campaign-invariants.mjs')
t = g.read_text()
needle = "if (!review.includes(\"'preview-audience'\")) throw new Error('Recipient review endpoint contract missing');\n"
insert = needle + "if (!composer.includes('Explicit saves must refresh the persisted preview immediately.')) throw new Error('Saved preview refresh invariant missing');\n"
if needle not in t:
    raise SystemExit('Invariant insertion point not found')
t = t.replace(needle, insert, 1)
g.write_text(t)
