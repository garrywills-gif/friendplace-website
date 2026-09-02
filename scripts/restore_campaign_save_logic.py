from pathlib import Path

p = Path('app/admin/campaigns/new/CampaignComposerPage.tsx')
s = p.read_text()
marker = "  // CAMPAIGN_INVARIANT: NO_AUTOSAVE\n"
if "const saveDraft = useCallback" in s:
    print('saveDraft already present; nothing to restore')
    raise SystemExit(0)
if marker not in s:
    raise SystemExit('NO_AUTOSAVE marker not found')

block = r'''  // Build the current audience payload in memory. This is used only when an
  // admin deliberately saves/sends/schedules; it must never trigger a save.
  const audienceFilter: CampaignAudienceFilter = useMemo(() => {
    if (recipientMode === 'outreach') {
      return {
        audience_kind: 'outreach_contacts',
        outreach: {
          category: outreachCategory || undefined,
          status: outreachStatus || undefined,
        },
      } as any;
    }
    if (recipientMode === 'manual') {
      return {
        audience_kind: 'manual_list',
        manual_recipients: manualList,
      } as any;
    }
    if (recipientMode === 'individual') {
      return {
        audience_kind: 'individual',
        recipient_email: individualEmail,
        recipient_name: individualName,
      } as any;
    }
    return recipientMode === 'segment'
      ? {
          segment_id: segmentId || undefined,
          exclude_reserved: true,
          exclude_opted_out: true,
        }
      : {
          statuses,
          tags_any: tagsAny,
          exclude_reserved: true,
          exclude_opted_out: true,
        };
  }, [recipientMode, segmentId, statuses, tagsAny,
      outreachCategory, outreachStatus, manualList, individualEmail, individualName]);

  // Load saved segments once for the picker.
  useEffect(() => {
    (async () => {
      try {
        const r = await segmentsApi.list();
        setSegments(r.items.map((seg) => ({
          id: seg.id,
          name: seg.name,
          emoji: seg.emoji,
          last_count: seg.last_count,
          description: seg.description,
        })));
      } catch { /* non-fatal */ }
    })();
  }, []);

  // George's segment suggestions are read-only assistance and do not save the
  // campaign. Keeping this separate protects the no-autosave invariant.
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (recipientMode !== 'custom' && recipientMode !== 'segment') return;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      if (!subject && !bodyMd && !title) { setSuggestions([]); return; }
      try {
        const r = await segmentsApi.suggest({ subject, title, body_md: bodyMd, preheader });
        setSuggestions(r.suggestions);
      } catch { /* silent */ }
    }, 600);
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
  }, [subject, title, bodyMd, preheader, recipientMode]);

  // Explicit persistence path. Called only from Save Draft, Send, or Schedule.
  const saveDraft = useCallback(async (silent = false): Promise<string | null> => {
    setSaving(true);
    try {
      const serverTemplate = TEMPLATE_META[template]?.serverTemplate || 'announcement';
      const payload: Partial<Campaign> & { attach_file?: boolean } = {
        name: name || 'Untitled campaign',
        template: serverTemplate,
        subject,
        preheader,
        companion,
        title,
        body_md: bodyMd,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        audience_filter: audienceFilter,
        greeting,
        show_founder_badge: showFounderBadge,
        attach_file: attachFile,
      };
      let c: Campaign;
      if (campaignId) {
        c = await campaignsApi.update(campaignId, payload);
      } else {
        c = await campaignsApi.create(payload);
        setCampaignId(c.id);
      }
      if (!silent) showToast('Draft saved');
      return c.id;
    } catch (e: any) {
      showToast(e?.message || 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  }, [campaignId, name, template, subject, preheader, companion, title, bodyMd,
      ctaLabel, ctaUrl, audienceFilter, greeting, showFounderBadge, attachFile]);

'''

s = s.replace(marker, block + marker, 1)
p.write_text(s)
print('restored audienceFilter, segment helpers and explicit saveDraft')
