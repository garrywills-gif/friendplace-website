function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build once for both the preview and compose API; never add a second greeting. */
export function renderEnquiryEmail(input: {
  body: string; signature: string; ctaChoice: string; ctaLabel: string; ctaUrl: string;
}) {
  const body = input.body.trim();
  const hasSignoff = /(?:^|\n)\s*(?:warmly|kind regards|best regards|regards|cheers|yours sincerely)[,!]?\s*(?:\n|$)/i.test(body)
    || /(?:^|\n)\s*(?:George|Garry|The FriendPlace team)(?: at FriendPlace)?\s*$/im.test(body);
  const signature = !hasSignoff ? input.signature.trim() : '';
  const choices: Record<string, [string, string]> = {
    visit: ['Visit FriendPlace', 'https://www.friendplace.com.au/'],
    register: ['Register your interest', 'https://www.friendplace.com.au/register-interest'],
    get_app: ['Get the app', 'https://www.friendplace.com.au/#get-app'],
    custom: [input.ctaLabel.trim(), input.ctaUrl.trim()],
  };
  const cta = choices[input.ctaChoice];
  const validCta = cta && /^https?:\/\//i.test(cta[1]) && cta[0] ? cta : null;
  const paragraphs = escapeHtml(body).split(/\n{2,}/).map(p => `<p style="margin:0 0 20px;">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<html><body style="margin:0;background:#0A2B49;color:#FFFFFF;"><div style="max-width:700px;margin:auto;padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.65;color:#FFFFFF;">
    <div style="text-align:center;margin-bottom:32px;"><img src="https://www.friendplace.com.au/brand-assets/butterfly.png" width="72" alt="FriendPlace butterfly"><div style="font-size:28px;font-weight:800;">FriendPlace</div><div style="font-size:14px;">Because you belong too.</div></div>
    ${paragraphs}
    ${validCta ? `<p><a href="${escapeHtml(validCta[1])}" style="display:inline-block;background:#0F766E;color:#FFFFFF;padding:12px 22px;border-radius:24px;text-decoration:none;font-weight:700;">${escapeHtml(validCta[0])}</a></p>` : ''}
    ${signature ? `<p style="margin-top:28px;">Warmly,<br><strong>${escapeHtml(signature)}</strong><br>Because you belong too.</p>` : ''}
    <p style="font-size:13px;text-align:center;margin-top:36px;"><a href="https://www.friendplace.com.au/" style="color:#46E6D5;">friendplace.com.au</a></p>
  </div></body></html>`;
  return { html, text: [body, validCta ? `${validCta[0]}: ${validCta[1]}` : '', signature ? `Warmly,\n${signature}\nBecause you belong too.` : '', 'https://www.friendplace.com.au/'].filter(Boolean).join('\n\n') };
}
