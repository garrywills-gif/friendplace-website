"""Iter161b — production regression: Campaigns Outreach count was
returning the Founding Members count (7) instead of the Outreach
retirement_village + not_contacted count (should have been ~40).

Root cause diagnosis: pre-iter161 frontend never PATCHed the draft's
audience_filter after the first save (short-circuit on campaignId),
so drafts kept a founding-member-shaped filter with no audience_kind
marker. The backend resolver then fell through to the founding_members
path, and the count naturally tracked FM registrations.

These tests prove the backend now behaves correctly in TWO scenarios:

1. When audience_kind is set explicitly (post-iter161 frontend) —
   returns the Outreach count, distinct from FM count.
2. When audience_kind is MISSING but the filter's shape is
   unambiguously outreach-like (pre-iter161 legacy draft OR any
   client that forgets the marker) — the new defensive auto-detect
   in _resolve_audience routes to Outreach and returns the Outreach
   count, NOT the FM count.
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    return requests.Session()


@pytest.fixture(scope="module")
def auth_headers(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": "hello@friendplace.com.au", "password": "TestPass2026!"},
        timeout=15,
    )
    assert r.status_code == 200, r.text[:400]
    tok = r.json().get("token") or r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}"}


def _create_org(api_client, headers, category, status, tag="iter161b"):
    slug = uuid.uuid4().hex[:10]
    r = api_client.post(
        f"{BASE_URL}/api/cms/outreach/organisations",
        json={
            "organisation_name": f"iter161b-{category}-{slug}",
            "email": f"iter161b+{slug}@friendplace.com.au",
            "category": category,
            "status": status,
            "tags": [tag],
        },
        headers=headers,
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:400]
    return r.json()["id"]


def _delete_org(api_client, headers, oid):
    api_client.delete(
        f"{BASE_URL}/api/cms/outreach/organisations/{oid}",
        headers=headers, timeout=15,
    )


def _create_campaign(api_client, headers, audience_filter):
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns",
        json={
            "name": f"iter161b-{uuid.uuid4().hex[:6]}",
            "template": "announcement",
            "subject": "S", "title": "T", "body_md": "B",
            "audience_filter": audience_filter,
        },
        headers=headers, timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:400]
    return r.json()["id"]


def _preview_count(api_client, headers, cid):
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{cid}/preview-audience",
        headers=headers, timeout=15,
    )
    assert r.status_code == 200, r.text[:400]
    return int(r.json().get("count", 0))


def _fm_count(api_client, headers):
    """Rough count of Founding Members using a bare custom filter
    (matches what pre-iter161 buggy drafts effectively resolved to)."""
    cid = _create_campaign(api_client, headers, {
        "statuses": ["registered", "invited", "joined"],
        "tags_any": [],
        "exclude_reserved": True,
        "exclude_opted_out": True,
    })
    return _preview_count(api_client, headers, cid)


def test_outreach_count_is_not_founding_member_count_when_kind_is_set(api_client, auth_headers):
    """Post-iter161 frontend: audience_kind='outreach_contacts' explicitly
    set. The count MUST come from the Outreach collection, not
    Founding Members."""
    tag = f"iter161b-{uuid.uuid4().hex[:6]}"
    seeded: list[str] = []
    try:
        # Seed 13 retirement_village/not_contacted orgs with a unique
        # tag so we can distinguish our seeds from any pre-existing
        # test data.
        for _ in range(13):
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "not_contacted", tag=tag))

        # Founding Member count (what the buggy path would return).
        fm = _fm_count(api_client, auth_headers)

        # Correct outreach-scoped filter with tag filter to isolate our seeds.
        cid = _create_campaign(api_client, auth_headers, {
            "audience_kind": "outreach_contacts",
            "outreach": {
                "category": "retirement_village",
                "status": "not_contacted",
                "tags_any": [tag],
            },
        })
        out_count = _preview_count(api_client, auth_headers, cid)

        # PROOF the resolver is NOT falling through to Founding Members:
        # our 13 seeded orgs must be the count.
        assert out_count == 13, (
            f"expected exactly our 13 seeded orgs; got {out_count}. "
            f"If this equals the founding_members count ({fm}), the resolver "
            f"is falling through to the FM path — the iter161 production bug."
        )
        assert out_count != fm or out_count == 13, (
            f"outreach count ({out_count}) accidentally matches "
            f"founding_members count ({fm}) — increase seed count to disambiguate"
        )
    finally:
        for oid in seeded:
            _delete_org(api_client, auth_headers, oid)


def test_legacy_draft_missing_audience_kind_but_outreach_shape_is_routed_correctly(api_client, auth_headers):
    """Legacy pre-iter161 draft (or any client that forgets the
    audience_kind marker) with an unambiguously outreach-shaped
    filter must NOT fall through to Founding Members. The iter161b
    defensive auto-detect in _resolve_audience should catch this
    and route to Outreach."""
    tag = f"iter161b-legacy-{uuid.uuid4().hex[:6]}"
    seeded: list[str] = []
    try:
        for _ in range(9):
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "not_contacted", tag=tag))

        fm = _fm_count(api_client, auth_headers)

        # NO audience_kind field — simulates a legacy draft or a
        # client that forgot the marker.
        cid = _create_campaign(api_client, auth_headers, {
            "outreach": {
                "category": "retirement_village",
                "status": "not_contacted",
                "tags_any": [tag],
            },
        })
        out_count = _preview_count(api_client, auth_headers, cid)

        assert out_count == 9, (
            f"defensive auto-detect failed: filter had outreach shape but "
            f"no audience_kind, got {out_count} instead of our 9 seeded orgs. "
            f"If it equals founding_members count ({fm}), the resolver is "
            f"still silently falling through — the auto-detect is broken."
        )
    finally:
        for oid in seeded:
            _delete_org(api_client, auth_headers, oid)


def test_empty_outreach_spec_falls_through_to_founding_members(api_client, auth_headers):
    """Safety guard: an empty {"outreach": {}} with no marker MUST
    still fall through to Founding Members. We only auto-detect when
    the outreach spec has real data (category/status/tags_any/ids)."""
    fm = _fm_count(api_client, auth_headers)
    cid = _create_campaign(api_client, auth_headers, {
        "outreach": {},   # present but empty
        "statuses": ["registered", "invited", "joined"],
    })
    n = _preview_count(api_client, auth_headers, cid)
    # Empty outreach spec + statuses set → should resolve to FMs.
    assert n == fm, f"empty outreach spec should defer to FMs, got {n} vs {fm}"


# ---------------------------------------------------------------------------
# iter161b — free-form category input matches the canonical stored key
# ---------------------------------------------------------------------------


def test_category_normaliser_matches_stored_key(api_client, auth_headers):
    """A user typing "retirement village" or "Retirement Village" must
    resolve the same audience as the canonical stored key
    "retirement_village" — the store keeps the underscore form, but
    the query normalises input first."""
    tag = f"iter161b-norm-{uuid.uuid4().hex[:6]}"
    seeded: list[str] = []
    try:
        for _ in range(4):
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "not_contacted", tag=tag))

        # Try three different user inputs — all should hit our 4 seeds.
        for user_input in ("retirement_village", "retirement village", "Retirement Village", " RETIREMENT-VILLAGE "):
            cid = _create_campaign(api_client, auth_headers, {
                "audience_kind": "outreach_contacts",
                "outreach": {
                    "category": user_input,
                    "status": "not_contacted",
                    "tags_any": [tag],
                },
            })
            n = _preview_count(api_client, auth_headers, cid)
            assert n == 4, (
                f"category normaliser failed for input {user_input!r}: "
                f"expected 4 (our seeded orgs), got {n}"
            )
    finally:
        for oid in seeded:
            _delete_org(api_client, auth_headers, oid)


def test_normalise_category_unit():
    """Unit-level guarantee for the normaliser helper."""
    from services.outreach.store import normalise_category, category_label

    assert normalise_category("retirement_village") == "retirement_village"
    assert normalise_category("retirement village") == "retirement_village"
    assert normalise_category("Retirement Village") == "retirement_village"
    assert normalise_category(" RETIREMENT-VILLAGE ") == "retirement_village"
    assert normalise_category("retirement    village") == "retirement_village"
    assert normalise_category("aged care") == "aged_care"
    assert normalise_category("Advocacy Group") == "advocacy_group"
    assert normalise_category("") is None
    assert normalise_category("   ") is None
    assert normalise_category(None) is None
    # Strips punctuation but keeps meaningful separators.
    assert normalise_category("retirement, village!") == "retirement_village"

    # Label helper (used by frontend + confirm modal).
    assert category_label("retirement_village") == "Retirement village"
    assert category_label("aged_care") == "Aged care"
    assert category_label("other") == "Other"
    assert category_label("") == ""
    assert category_label(None) == ""
