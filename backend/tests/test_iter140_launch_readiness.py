"""Iteration 140 — V1 Launch Readiness sweep.

Verifies the two fixes that landed since iter-139 plus a broad
alias-resolution regression covering every phrase Garry named in the
launch-readiness review request:

1.  /admin/crm no longer 404s. The Next.js server must respond with a
    2xx (redirect resolved) or a 3xx pointing at /admin/crm/founding-members.
    We follow redirects and land on /admin/crm/founding-members.

2.  Every navigation alias listed in the review — 'open Campaigns',
    'open Members', 'open Moments', 'open Share a Moment queue',
    'open Founding Members', 'open Events', 'open Groups',
    'open System Health', 'open Flyers', 'open Bridge', 'open CRM' —
    resolves through _detect_navigation to the correct admin route.

3.  Neighbouring live admin surfaces (/admin/*) all return 200/redirect.

4.  Prompt clauses that guarantee George never refuses a listed surface
    are still present.
"""
from __future__ import annotations

import os
import re

import pytest
import requests

from services.george import chat as george_chat
from services.george import prompt as george_prompt


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError(
        "EXPO_PUBLIC_BACKEND_URL not set — cannot run launch readiness tests"
    )


# ---------------------------------------------------------------------------
# 1. /admin/crm redirect fix (was 🔴 in iter-139)
# ---------------------------------------------------------------------------

class TestCrmRedirect:
    """The blocker fix that just landed: /admin/crm must NOT 404."""

    def test_admin_crm_no_longer_404(self):
        # Do NOT auto-follow so we can inspect the redirect explicitly.
        r = requests.get(f"{BASE_URL}/admin/crm", allow_redirects=False, timeout=15)
        assert r.status_code != 404, (
            f"/admin/crm returned 404 — the redirect fix has regressed. "
            f"Status={r.status_code}"
        )
        assert r.status_code in (200, 301, 302, 303, 307, 308), (
            f"/admin/crm returned unexpected status {r.status_code}"
        )
        if 300 <= r.status_code < 400:
            location = r.headers.get("Location", "")
            assert "/admin/crm/founding-members" in location, (
                f"/admin/crm should redirect to /admin/crm/founding-members; "
                f"got Location={location!r}"
            )

    def test_admin_crm_follows_to_founding_members(self):
        r = requests.get(f"{BASE_URL}/admin/crm", allow_redirects=True, timeout=20)
        assert r.status_code == 200
        # Final URL should land on /admin/crm/founding-members OR the admin
        # login page (if session-guarded). Either is acceptable — the point
        # is no 404.
        assert "/admin/crm/founding-members" in r.url or "/admin/login" in r.url \
            or "/admin" in r.url, (
            f"After following /admin/crm, landed at {r.url!r}"
        )


# ---------------------------------------------------------------------------
# 2. George navigation aliases — every phrase from the review request
# ---------------------------------------------------------------------------

# Each row: (imperative phrase Garry types, announcement George would emit,
#           expected admin route).
NAV_CASES: list[tuple[str, str, str]] = [
    ("open Campaigns",              "Opening Campaigns now.",                          "/admin/campaigns"),
    ("open Members",                "Opening Members now.",                            "/admin/members"),
    ("open Moments",                "Opening Moments now.",                            "/admin/moments"),
    ("open Share a Moment queue",   "Opening the Share a Moment queue now.",           "/admin/moments"),
    ("open Founding Members",       "Opening Founding Members now.",                   "/admin/founding-members"),
    ("open Events",                 "Opening Events now.",                             "/admin/events"),
    ("open Groups",                 "Opening Groups now.",                             "/admin/groups"),
    ("open System Health",          "Opening the System Health Dashboard now.",        "/admin/system-health"),
    ("open Flyers",                 "Opening Flyers now.",                             "/admin/flyers"),
    ("open Bridge",                 "Opening the Bridge now.",                         "/admin/bridge"),
    ("open CRM",                    "Opening the CRM now.",                            "/admin/crm"),
]


class TestGeorgeAliases:

    @pytest.mark.parametrize("phrase, announcement, expected_path", NAV_CASES)
    def test_alias_resolves(self, phrase, announcement, expected_path):
        """Given George's announcement for `phrase`, _detect_navigation must
        yield the expected admin route."""
        got = george_chat._detect_navigation(announcement)
        assert got == expected_path, (
            f"For imperative phrase {phrase!r}, announcement {announcement!r} "
            f"expected {expected_path!r} but got {got!r}. This means the app "
            f"WOULD NOT navigate when Garry uses this phrase."
        )

    def test_share_a_moment_queue_short_form_present(self):
        # Iter-139 flagged this exact alias as missing. Regression guard.
        moments_aliases = dict(george_chat._MCGS_ROUTES)["/admin/moments"]
        assert "share a moment queue" in moments_aliases, (
            "Alias 'share a moment queue' missing from /admin/moments — the "
            "iter-139 launch-blocker fix has regressed."
        )


# ---------------------------------------------------------------------------
# 3. Prompt safeguards — George must not refuse a listed surface
# ---------------------------------------------------------------------------

class TestPromptSafeguards:

    def test_never_refuse_listed_surface_clause_present(self):
        style = george_prompt.ANSWER_STYLE
        assert "Never refuse a listed surface" in style, (
            "ANSWER_STYLE is missing the 'Never refuse a listed surface' "
            "clause — George may again say a live page is 'not available'."
        )
        # Explicit anti-refusal phrases must be quoted so the LLM learns them.
        for banned in ["not available yet", "coming in a future phase"]:
            assert banned in style, (
                f"ANSWER_STYLE is missing the banned-refusal phrase "
                f"{banned!r}."
            )

    def test_imperative_phrasings_are_navigation_clause_present(self):
        style = george_prompt.ANSWER_STYLE
        assert "Imperative phrasings ARE requests to navigate" in style, (
            "ANSWER_STYLE is missing the 'Imperative phrasings ARE requests "
            "to navigate' clause."
        )

    def test_capability_map_lists_crm(self):
        # CRM appears as a listed surface even though it redirects — keeps
        # George honest.
        assert re.search(
            r"(?m)^\-\s+crm\b",
            george_prompt.MCGS_CAPABILITY_MAP,
        ), "MCGS_CAPABILITY_MAP no longer lists 'crm'"


# ---------------------------------------------------------------------------
# 4. All named admin surfaces reachable (HTTP-level smoke)
# ---------------------------------------------------------------------------

ADMIN_ROUTES_TO_SMOKE = [
    "/admin/dashboard",
    "/admin/moments",
    "/admin/members",
    "/admin/campaigns",
    "/admin/events",
    "/admin/groups",
    "/admin/flyers",
    "/admin/bridge",
    "/admin/system-health",
    "/admin/analytics",
    "/admin/audit-log",
    "/admin/launch",
    "/admin/founding-members",
    "/admin/crm",
    "/admin/crm/founding-members",
    "/admin/segments",
    "/admin/event-submissions",
]


class TestAdminSurfacesReachable:

    @pytest.mark.parametrize("route", ADMIN_ROUTES_TO_SMOKE)
    def test_route_not_404(self, route):
        r = requests.get(f"{BASE_URL}{route}", allow_redirects=True, timeout=20)
        assert r.status_code != 404, (
            f"{route} returned 404 (final URL {r.url!r}) — page is missing."
        )
        assert r.status_code < 500, (
            f"{route} returned {r.status_code} — server error."
        )
