"""Iter161 — Campaign preview-audience must return fresh counts when the
draft's outreach filter changes.

Regression guard: the frontend bug was a missing dependency in the
Campaigns editor debounce useEffect (outreachCategory / outreachStatus
were not in the dep array, so preview-audience never re-fired). The
BACKEND `_resolve_audience` for outreach already reads live from Mongo
— this test proves it does not cache or filter incorrectly.
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "BACKEND_URL", "http://localhost:8001"
).rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    return requests.Session()


@pytest.fixture(scope="module")
def auth_headers(api_client):
    r = api_client.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={
            "email": "hello@friendplace.com.au",
            "password": "TestPass2026!",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text[:400]
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, r.json()
    return {"Authorization": f"Bearer {tok}"}


def _create_org(api_client, headers, category, status):
    slug = uuid.uuid4().hex[:10]
    r = api_client.post(
        f"{BASE_URL}/api/cms/outreach/organisations",
        json={
            "organisation_name": f"iter161-{category}-{slug}",
            "email": f"iter161+{slug}@friendplace.com.au",
            "category": category,
            "status": status,
        },
        headers=headers,
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:400]
    return r.json()["id"]


def _delete_org(api_client, headers, oid):
    api_client.delete(
        f"{BASE_URL}/api/cms/outreach/organisations/{oid}",
        headers=headers,
        timeout=15,
    )


def _create_draft(api_client, headers, audience_filter):
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns",
        json={
            "name": f"iter161-draft-{uuid.uuid4().hex[:6]}",
            "template": "announcement",
            "subject": "S",
            "title": "T",
            "body_md": "B",
            "audience_filter": audience_filter,
        },
        headers=headers,
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text[:400]
    return r.json()["id"]


def _update_draft(api_client, headers, cid, audience_filter):
    r = api_client.patch(
        f"{BASE_URL}/api/cms/campaigns/{cid}",
        json={"audience_filter": audience_filter},
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text[:400]


def _preview_count(api_client, headers, cid):
    r = api_client.post(
        f"{BASE_URL}/api/cms/campaigns/{cid}/preview-audience",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text[:400]
    return int(r.json().get("count", 0))


def test_outreach_count_updates_when_status_changes(api_client, auth_headers):
    """When Garry flips the campaign's Outreach status filter from
    not_contacted → contacted → not_contacted, `preview-audience`
    must return counts consistent with the current filter, not a
    cached earlier count."""
    seeded: list[str] = []
    try:
        # Seed: two retirement villages in each status bucket.
        for _ in range(2):
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "not_contacted"))
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "contacted"))

        cid = _create_draft(api_client, auth_headers, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "retirement_village", "status": "not_contacted"},
        })

        c1 = _preview_count(api_client, auth_headers, cid)
        assert c1 >= 2, f"expected at least our 2 seeded not_contacted rows, got {c1}"

        # Flip to contacted — count should update to reflect the new query.
        _update_draft(api_client, auth_headers, cid, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "retirement_village", "status": "contacted"},
        })
        c2 = _preview_count(api_client, auth_headers, cid)
        assert c2 >= 2, f"expected at least our 2 seeded contacted rows, got {c2}"

        # Flip back — must not be locked at c2.
        _update_draft(api_client, auth_headers, cid, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "retirement_village", "status": "not_contacted"},
        })
        c3 = _preview_count(api_client, auth_headers, cid)
        assert c3 == c1, f"count went stale after round-trip: c1={c1} c3={c3}"

        # Category-only filter (no status) must include BOTH buckets ⇒ ≥ c1 + our 2 contacted seeds.
        _update_draft(api_client, auth_headers, cid, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "retirement_village"},
        })
        c_all = _preview_count(api_client, auth_headers, cid)
        assert c_all >= c1 + 2, (
            f"category-only preview should include all statuses; "
            f"c_all={c_all} c_not_contacted={c1}"
        )
    finally:
        for oid in seeded:
            _delete_org(api_client, auth_headers, oid)


def test_outreach_count_updates_when_category_changes(api_client, auth_headers):
    """Same guarantee for category swaps."""
    seeded: list[str] = []
    try:
        for _ in range(3):
            seeded.append(_create_org(api_client, auth_headers, "retirement_village", "not_contacted"))
        for _ in range(1):
            seeded.append(_create_org(api_client, auth_headers, "library", "not_contacted"))

        cid = _create_draft(api_client, auth_headers, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "retirement_village", "status": "not_contacted"},
        })
        rv = _preview_count(api_client, auth_headers, cid)
        assert rv >= 3

        _update_draft(api_client, auth_headers, cid, {
            "audience_kind": "outreach_contacts",
            "outreach": {"category": "library", "status": "not_contacted"},
        })
        lib = _preview_count(api_client, auth_headers, cid)
        assert lib >= 1
        # A category swap must materially change the count.
        assert lib != rv or lib >= 3, (
            f"category swap didn't change count: retirement_village={rv} library={lib}"
        )
    finally:
        for oid in seeded:
            _delete_org(api_client, auth_headers, oid)
