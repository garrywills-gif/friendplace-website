"""iter164bd — hard email suppression safety (HTTP, no real emails sent)."""
import os, uuid, requests
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv("/app/backend/.env")
import sys; sys.path.insert(0, "/app/backend")
from services import suppression as supp

BASE = "http://localhost:8001/api"
ADMIN = {"email": "hello@friendplace.com.au", "password": "TestPass2026!"}
db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


def _auth():
    r = requests.post(f"{BASE}/cms/auth/login", json=ADMIN); r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_unsubscribe_link_suppresses_idempotent():
    email = f"unsub-{uuid.uuid4().hex[:8]}@example.com"
    token = supp.make_token(email)
    try:
        for _ in range(2):  # idempotent — safe to click twice
            r = requests.get(f"{BASE}/public/unsubscribe?token={token}")
            assert r.status_code == 200 and "unsubscribed" in r.text.lower()
        doc = db.email_suppressions.find_one({"email": email})
        assert doc and doc["email_suppressed"] and doc["suppression_reason"] == "unsubscribed"
        assert len(doc["history"]) == 2  # append-only audit
        # tampered token → no suppression, still safe page
        bad = requests.get(f"{BASE}/public/unsubscribe?token={token}X")
        assert bad.status_code == 200
    finally:
        db.email_suppressions.delete_one({"email": email})


def test_audience_preview_excludes_suppressed_and_keeps_normal():
    auth = _auth()
    tag = uuid.uuid4().hex[:8]
    supp_email = f"supp-{tag}@example.com"
    ok_email = f"ok-{tag}@example.com"
    cat = f"supptest_{tag}"
    ids = []
    for e in (supp_email, ok_email):
        oid = str(uuid.uuid4()); ids.append(oid)
        db.outreach_organisations.insert_one({
            "id": oid, "organisation_name": f"Org {e}", "contact_name": "A B",
            "email": e, "category": cat, "tags": [cat], "status": "not_contacted",
            "is_test": False, "archived_at": None, "created_at": "2026-09-03T00:00:00Z",
            "updated_at": "2026-09-03T00:00:00Z"})
    # suppress one via unsubscribe token
    requests.get(f"{BASE}/public/unsubscribe?token={supp.make_token(supp_email)}")
    cid = str(uuid.uuid4())
    db.campaigns.insert_one({"id": cid, "name": "supp", "template": "announcement",
        "title": "T", "body_md": "b", "subject": "S", "status": "draft",
        "audience_filter": {"audience_kind": "outreach_contacts", "outreach": {"category": cat}},
        "created_at": "2026-09-03T00:00:00Z", "updated_at": "2026-09-03T00:00:00Z"})
    try:
        r = requests.post(f"{BASE}/cms/campaigns/{cid}/preview-audience", headers=auth)
        assert r.status_code == 200, r.text
        emails = {x.get("email") for x in r.json().get("recipients", [])}
        assert ok_email in emails
        assert supp_email not in emails  # HARD excluded
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})
        db.campaigns.delete_one({"id": cid})
        db.email_suppressions.delete_one({"email": supp_email})


def test_reimport_does_not_clear_suppression():
    email = f"reimp-{uuid.uuid4().hex[:8]}@example.com"
    auth = _auth()
    requests.get(f"{BASE}/public/unsubscribe?token={supp.make_token(email)}")
    try:
        # re-import/upsert the same email as a fresh not_contacted org
        from services.outreach.store import upsert_org
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        # suppression lives in its own collection → upsert can't touch it
        assert db.email_suppressions.find_one({"email": email}) is not None
        # simulate import row
        oid = str(uuid.uuid4())
        db.outreach_organisations.insert_one({"id": oid, "organisation_name": "Re", "email": email,
            "status": "not_contacted", "is_test": False, "archived_at": None,
            "created_at": "x", "updated_at": "x", "tags": [], "category": "x"})
        # still suppressed after "import"
        assert db.email_suppressions.find_one({"email": email})["email_suppressed"] is True
        db.outreach_organisations.delete_one({"id": oid})
    finally:
        db.email_suppressions.delete_one({"email": email})


def test_outreach_footer_and_token_roundtrip():
    from email_service import announcement_template
    import services.suppression as _s
    _, html, text = announcement_template(
        first_name="friend", title="T", body_md="Hello", companion="george",
        outreach_unsubscribe_url="https://x/api/public/unsubscribe?token=abc")
    assert "unsubscribe here" in html and "publicly listed contact details" in html
    assert "unsubscribe here" in text
    _, html2, text2 = announcement_template(first_name="Sam", title="T", body_md="Hi")
    assert "publicly listed contact details" not in html2
    assert "publicly listed contact details" not in text2
    tok = _s.make_token("Foo@Example.com")
    assert _s.verify_token(tok) == "foo@example.com"
    assert _s.verify_token(tok + "z") is None


def test_preview_excluded_count_and_sendable_total():
    auth = _auth()
    tag = uuid.uuid4().hex[:8]
    supp_email = f"ex-{tag}@example.com"
    ok_email = f"okk-{tag}@example.com"
    cat = f"exc_{tag}"
    ids = []
    for e in (supp_email, ok_email):
        oid = str(uuid.uuid4()); ids.append(oid)
        db.outreach_organisations.insert_one({
            "id": oid, "organisation_name": f"Org {e}", "email": e, "category": cat,
            "tags": [cat], "status": "not_contacted", "is_test": False,
            "archived_at": None, "created_at": "x", "updated_at": "x"})
    requests.get(f"{BASE}/public/unsubscribe?token={supp.make_token(supp_email)}")
    cid = str(uuid.uuid4())
    db.campaigns.insert_one({"id": cid, "name": "exc", "template": "announcement",
        "title": "T", "body_md": "b", "subject": "S", "status": "draft",
        "audience_filter": {"audience_kind": "outreach_contacts", "outreach": {"category": cat}},
        "created_at": "x", "updated_at": "x"})
    try:
        r = requests.post(f"{BASE}/cms/campaigns/{cid}/preview-audience", headers=auth).json()
        assert r["count"] == 1
        assert r["excluded_count"] == 1
        assert any(x["email"] == supp_email and x["reason"] == "unsubscribed"
                   for x in r["excluded_do_not_email"])
        assert supp_email not in {x["email"] for x in r["recipients"]}
    finally:
        db.outreach_organisations.delete_many({"id": {"$in": ids}})
        db.campaigns.delete_one({"id": cid})
        db.email_suppressions.delete_one({"email": supp_email})
