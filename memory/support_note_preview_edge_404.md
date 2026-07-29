# Support note — preview edge intermittently returns plain-text "404 page not found"

**Status: DRAFT — not sent. For Garry to forward to Emergent Support when ready.**

---

Subject: Preview edge router intermittently returns "404 page not found" for a valid preview hostname

Hi Emergent Support,

Our production website (www.friendplace.com.au, hosted on Vercel) currently calls our
preview backend at `https://george-mcgs-cms.preview.emergentagent.com/api/*` while we
wait on the production data-migration question (separate open ticket).

**Problem:** API calls to that preview hostname intermittently fail with
HTTP 404 and the plain-text body `404 page not found`. Seconds-to-minutes later the
same URL returns 200 again with no changes on our side.

**Evidence this comes from the preview edge, not our app:**
1. Our FastAPI backend can only produce JSON errors (`{"detail": ...}`), and our
   Next.js site produces an HTML 404 page. Neither can emit plain-text
   `404 page not found` — that string is the edge/router default response.
2. Reproduction: sending a request to the same edge IP (104.18.11.243) with an
   unknown preview hostname (`nosuch-9999.preview.emergentagent.com`) returns exactly
   `404 page not found` — byte-identical to what our users intermittently receive on
   the VALID hostname `friendplace-v1.preview.emergentagent.com`.
3. During a failure window on 2026-06, one user session saw every API surface fail
   simultaneously (admin auth check, LLM chat stream, voice transcription, TTS) and
   then all recover together — consistent with the edge briefly losing the route to
   the pod, not with any individual endpoint bug.

**Questions:**
1. Do preview environments hibernate / scale to zero, and does the edge return
   `404 page not found` (rather than a 503 + retry) while a pod is waking or the
   route table refreshes?
2. Is there anything you can do to make routing for `friendplace-v1` stable, or is
   the only reliable path cutting over to the deployed production backend?
3. Related open issue: our deployed production MongoDB is empty because the expected
   preview → production data migration did not occur. We cannot cut the website over
   until that is resolved. Any update?

We have added client-side retries as a mitigation, but the root cause is at the edge.

Thanks,
Garry (FriendPlace)
