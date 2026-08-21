"""CRM Phase 2C — Segments & Campaign integration E2E backend tests.

Covers:
- Segments list + filter catalog
- Segments CRUD (create → get → update → archive)
- Segment preview endpoint (unsaved predicate)
- Segment refresh count
- Segment suggest (George suggestions)
- Campaign creation with `audience_mode: segment` + preview-audience
- Campaign creation with classic filter + preview-audience
- Backward compatibility (custom filter without segment_id)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outreach-campaigns.preview.emergentagent.com").rstrip("/")
CMS_EMAIL = "hello@friendplace.com.au"
CMS_PASSWORD = "TestPass2026!"


# ── Fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/cms/auth/login",
        json={"email": CMS_EMAIL, "password": CMS_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    assert tok, f"no token in response: {j}"
    return tok


@pytest.fixture(scope="module")
def auth(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_ids() -> list[str]:
    return []


# ── Segments list & filter catalog ─────────────────────────────────
class TestSegmentsList:
    def test_list_returns_starter_segments(self, auth):
        r = requests.get(f"{BASE_URL}/api/cms/segments", headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        assert data["count"] == len(data["items"])
        # 12 starter segments seeded — accept >=8 for resilience
        assert data["count"] >= 8, f"expected >=8 segments, got {data['count']}"
        for s in data["items"]:
            assert "id" in s and "name" in s and "predicate" in s
            assert "_id" not in s  # Mongo _id must be excluded

    def test_filter_catalog(self, auth):
        r = requests.get(f"{BASE_URL}/api/cms/segments/filters", headers=auth, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "filters" in j
        ids = {f["id"] for f in j["filters"]}
        # a few must exist
        for expected in ("interest_any", "location_state", "founder_only"):
            assert expected in ids


# ── Segment preview (unsaved predicate) ───────────────────────────
class TestSegmentPreview:
    def test_preview_empty_predicate_returns_count(self, auth):
        # Empty body → matches everyone (excluding demo/banned defaults)
        r = requests.post(
            f"{BASE_URL}/api/cms/segments/preview",
            headers=auth, json={}, timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "count" in j and isinstance(j["count"], int)
        assert "sample" in j and isinstance(j["sample"], list)
        assert "summary" in j

    def test_preview_state_predicate(self, auth):
        pred = {"op": "filter", "id": "location_state", "value": "NSW"}
        r = requests.post(
            f"{BASE_URL}/api/cms/segments/preview",
            headers=auth, json={"predicate": pred}, timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert j["count"] >= 0
        assert "NSW" in (j.get("summary") or "")

    def test_preview_rejects_unknown_filter(self, auth):
        pred = {"op": "filter", "id": "nonexistent_x", "value": True}
        r = requests.post(
            f"{BASE_URL}/api/cms/segments/preview",
            headers=auth, json={"predicate": pred}, timeout=15,
        )
        assert r.status_code == 400


# ── Segment CRUD ───────────────────────────────────────────────────
class TestSegmentCRUD:
    def test_create_then_get_verifies_persistence(self, auth, created_ids):
        name = f"TEST_seg_{uuid.uuid4().hex[:8]}"
        payload = {
            "name": name,
            "emoji": "🧪",
            "description": "Playwright test segment",
            "predicate": {"op": "filter", "id": "location_state", "value": "NSW"},
        }
        r = requests.post(f"{BASE_URL}/api/cms/segments", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        seg = r.json()
        assert seg["id"] and seg["name"] == name
        assert "last_count" in seg and isinstance(seg["last_count"], int)
        assert seg.get("predicate_summary")
        created_ids.append(seg["id"])

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/cms/segments/{seg['id']}", headers=auth, timeout=15)
        assert r2.status_code == 200
        got = r2.json()
        assert got["name"] == name
        assert got["predicate"]["id"] == "location_state"

    def test_update_predicate_and_recount(self, auth, created_ids):
        assert created_ids, "prior test must have created a segment"
        sid = created_ids[0]
        new_pred = {"op": "filter", "id": "location_state", "value": "VIC"}
        r = requests.patch(
            f"{BASE_URL}/api/cms/segments/{sid}",
            headers=auth, json={"predicate": new_pred, "name": f"TEST_seg_updated_{sid[:6]}"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["predicate"]["value"] == "VIC"
        assert "VIC" in (updated.get("predicate_summary") or "")

    def test_refresh_count(self, auth, created_ids):
        sid = created_ids[0]
        r = requests.post(f"{BASE_URL}/api/cms/segments/{sid}/refresh-count",
                          headers=auth, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "last_count" in j and "last_counted_at" in j

    def test_archive_hides_from_active_list(self, auth, created_ids):
        sid = created_ids[0]
        r = requests.delete(f"{BASE_URL}/api/cms/segments/{sid}", headers=auth, timeout=15)
        assert r.status_code == 200

        # Should NOT appear in active list
        r2 = requests.get(f"{BASE_URL}/api/cms/segments", headers=auth, timeout=15)
        assert r2.status_code == 200
        ids = {s["id"] for s in r2.json()["items"]}
        assert sid not in ids, "archived segment still in active list"

        # Should appear when include_archived=true
        r3 = requests.get(f"{BASE_URL}/api/cms/segments?include_archived=true",
                          headers=auth, timeout=15)
        assert r3.status_code == 200
        ids2 = {s["id"] for s in r3.json()["items"]}
        assert sid in ids2, "archived segment missing from include_archived list"


# ── Segment suggestions ────────────────────────────────────────────
class TestSegmentSuggest:
    def test_empty_text_returns_empty(self, auth):
        r = requests.post(f"{BASE_URL}/api/cms/segments/suggest",
                          headers=auth, json={"subject": "", "body_md": ""}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["suggestions"] == []

    def test_relevant_text_returns_suggestions(self, auth):
        r = requests.post(
            f"{BASE_URL}/api/cms/segments/suggest",
            headers=auth,
            json={"subject": "Founding Members welcome",
                  "body_md": "A note for our founding members active recently."},
            timeout=15,
        )
        assert r.status_code == 200
        j = r.json()
        assert "suggestions" in j
        # We can't guarantee content without knowing seed names, but shape must be right
        for s in j["suggestions"]:
            assert "id" in s and "name" in s
            assert "count" in s


# ── Campaign integration ──────────────────────────────────────────
class TestCampaignSegmentIntegration:
    seg_id_for_campaigns: str = ""
    seg_campaign_id: str = ""
    filter_campaign_id: str = ""

    def test_prepare_active_segment(self, auth):
        # Create a fresh segment we'll target from a campaign
        payload = {
            "name": f"TEST_camp_seg_{uuid.uuid4().hex[:8]}",
            "emoji": "🧪",
            "description": "Campaign integration test segment",
            "predicate": {},  # everyone (subject to base excludes)
        }
        r = requests.post(f"{BASE_URL}/api/cms/segments", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        TestCampaignSegmentIntegration.seg_id_for_campaigns = r.json()["id"]

    def test_campaign_with_segment_id(self, auth):
        sid = TestCampaignSegmentIntegration.seg_id_for_campaigns
        assert sid
        payload = {
            "name": f"TEST_camp_seg_{uuid.uuid4().hex[:6]}",
            "template": "announcement",
            "subject": "Sydney meetup",
            "body_md": "Hello friends.",
            "title": "Sydney meetup",
            "audience_filter": {"segment_id": sid, "audience_mode": "segment"},
        }
        r = requests.post(f"{BASE_URL}/api/cms/campaigns", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        camp = r.json()
        assert camp["id"] and camp["status"] == "draft"
        TestCampaignSegmentIntegration.seg_campaign_id = camp["id"]

        # Preview audience
        r2 = requests.post(
            f"{BASE_URL}/api/cms/campaigns/{camp['id']}/preview-audience",
            headers=auth, timeout=20,
        )
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert "count" in j2 and isinstance(j2["count"], int)
        assert "sample" in j2

    def test_campaign_with_custom_filter(self, auth):
        payload = {
            "name": f"TEST_camp_filter_{uuid.uuid4().hex[:6]}",
            "template": "announcement",
            "subject": "Founders update",
            "body_md": "Hello founders.",
            "title": "Founders update",
            "audience_filter": {"statuses": ["registered", "invited", "joined"], "tags": []},
        }
        r = requests.post(f"{BASE_URL}/api/cms/campaigns", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        camp = r.json()
        TestCampaignSegmentIntegration.filter_campaign_id = camp["id"]
        assert camp["id"] and camp["status"] == "draft"

        r2 = requests.post(
            f"{BASE_URL}/api/cms/campaigns/{camp['id']}/preview-audience",
            headers=auth, timeout=20,
        )
        assert r2.status_code == 200
        j = r2.json()
        assert "count" in j

    def test_backward_compat_no_segment_id(self, auth):
        """A campaign created before Phase 2C has statuses/tags but no segment_id.
        Preview must still work — that's the compat guarantee."""
        payload = {
            "name": f"TEST_legacy_{uuid.uuid4().hex[:6]}",
            "template": "announcement",
            "subject": "Legacy",
            "body_md": "hello",
            "audience_filter": {"statuses": ["registered"], "tags": ["founder"]},
        }
        r = requests.post(f"{BASE_URL}/api/cms/campaigns", headers=auth, json=payload, timeout=15)
        assert r.status_code == 200
        cid = r.json()["id"]

        r2 = requests.post(
            f"{BASE_URL}/api/cms/campaigns/{cid}/preview-audience",
            headers=auth, timeout=20,
        )
        assert r2.status_code == 200
        # cleanup
        requests.delete(f"{BASE_URL}/api/cms/campaigns/{cid}", headers=auth, timeout=15)

    def test_cleanup_test_campaigns(self, auth):
        for cid in (TestCampaignSegmentIntegration.seg_campaign_id,
                    TestCampaignSegmentIntegration.filter_campaign_id):
            if cid:
                requests.delete(f"{BASE_URL}/api/cms/campaigns/{cid}", headers=auth, timeout=15)
        # archive the test segment
        sid = TestCampaignSegmentIntegration.seg_id_for_campaigns
        if sid:
            requests.delete(f"{BASE_URL}/api/cms/segments/{sid}", headers=auth, timeout=15)


# ── Auth guard ────────────────────────────────────────────────────
class TestAuthGuard:
    def test_segments_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/cms/segments", timeout=15)
        assert r.status_code == 401
