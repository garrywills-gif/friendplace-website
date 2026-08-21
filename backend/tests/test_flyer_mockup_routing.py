"""
Nginx routing verification tests for /flyer-mockups/* static files.

Bug context: nginx path-multiplexer at /app/config/nginx/app-proxy.conf routes
specific paths to the Next.js website (:3001) and everything else to the Expo
web app (:3002). The /flyer-mockups/* prefix was missing, so PNGs fell through
to Expo's catch-all "Unmatched Route" 404. A location ^~ /flyer-mockups/ block
was added to proxy to the website upstream.
"""
import os
import pytest
import requests

BASE_URL = "https://outreach-campaigns.preview.emergentagent.com"


# ---------------- Flyer mockup PNG routing (the fix) ----------------

@pytest.mark.parametrize("filename,min_bytes", [
    ("founding.png", 100_000),
    ("download.png", 100_000),
    ("founding-thumb.png", 10_000),
    ("download-thumb.png", 10_000),
])
def test_flyer_mockup_png_served_as_image(filename, min_bytes):
    url = f"{BASE_URL}/flyer-mockups/{filename}"
    r = requests.get(url, timeout=30)
    assert r.status_code == 200, f"{url} returned {r.status_code}"
    ctype = r.headers.get("Content-Type", "")
    assert ctype.startswith("image/png"), f"{url} Content-Type={ctype}"
    # PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{url} not PNG magic"
    assert len(r.content) > min_bytes, f"{url} size={len(r.content)} < {min_bytes}"
    # Ensure it's NOT the Expo 'Unmatched Route' HTML fallback
    assert b"Unmatched Route" not in r.content
    assert b"<html" not in r.content[:200].lower()


def test_flyer_mockup_unknown_file_not_expo_fallback():
    """Non-existent file under /flyer-mockups/ should hit Next.js (404 from
    Next), NOT fall through to Expo's 'Unmatched Route' HTML."""
    r = requests.get(f"{BASE_URL}/flyer-mockups/does-not-exist.png", timeout=30)
    # Either 404 from Next or 200 (unlikely). It must NOT be Expo's fallback.
    assert b"Unmatched Route" not in r.content


# ---------------- Regression: existing website routes ----------------

@pytest.mark.parametrize("path", ["/meet", "/register-interest", "/admin"])
def test_website_html_routes_still_work(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=30, allow_redirects=True)
    assert r.status_code == 200, f"{path} returned {r.status_code}"
    ctype = r.headers.get("Content-Type", "")
    assert "text/html" in ctype, f"{path} Content-Type={ctype}"


# ---------------- Regression: Expo root still served ----------------

def test_root_still_serves_expo_app():
    r = requests.get(f"{BASE_URL}/", timeout=30)
    assert r.status_code == 200
    ctype = r.headers.get("Content-Type", "")
    assert "text/html" in ctype
