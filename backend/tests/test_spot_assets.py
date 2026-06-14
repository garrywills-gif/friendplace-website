"""Spot The Difference — photoreal-PNG asset rollout tests (iteration 20).

Verifies:
- /api/games/spot/puzzle?theme=&difficulty= → injects `asset_url` on scene_a/scene_b
  elements where a PNG exists in the theme's folder.
- swap_emoji diffs also receive `asset_url` on scene_b (the swap target).
- /api/static/spot_objects/<theme>/<slug>.png returns 200 + image content-type for
  one canonical asset per theme.
- /api/games/spot/library and individual lib puzzles still resolve with themed
  asset URLs on their scenes.
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# Map: backend theme key → folder slug (under /api/static/spot_objects/)
THEME_FOLDER = {
    "cafes": "coffee",
    "australian_gardens": "garden",
    "wildlife": "wildlife",
    "kitchens": "kitchens",
    "country_towns": "country_towns",
    "classic_cars": "classic_cars",
    "parks_trails": "parks_trails",
    "beaches": "beach",
}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --- Per-theme puzzle generation: asset_url must be populated --------------
class TestPuzzleAssetURLs:
    @pytest.mark.parametrize("theme,folder,difficulty", [
        ("cafes", "coffee", "easy"),
        ("australian_gardens", "garden", "moderate"),
        ("wildlife", "wildlife", "hard"),
        ("kitchens", "kitchens", "easy"),
        ("country_towns", "country_towns", "easy"),
        ("classic_cars", "classic_cars", "easy"),
        ("parks_trails", "parks_trails", "easy"),
        ("beaches", "beach", "easy"),
    ])
    def test_scene_a_elements_have_asset_url(self, s, theme, folder, difficulty):
        r = s.get(f"{API}/games/spot/puzzle", params={"theme": theme, "difficulty": difficulty})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["theme"] == theme
        scene_a = p["scene_a"]
        assert len(scene_a) > 0, "scene_a empty"
        prefix = f"/api/static/spot_objects/{folder}/"

        with_url = [e for e in scene_a if e.get("asset_url")]
        # Almost every element should map; allow a tiny tolerance but require ≥80%.
        ratio = len(with_url) / len(scene_a)
        assert ratio >= 0.8, (
            f"{theme}: only {len(with_url)}/{len(scene_a)} scene_a elements got asset_url. "
            f"Missing: {[e['id'] for e in scene_a if not e.get('asset_url')]}"
        )
        # All asset_urls must use the correct folder
        for e in with_url:
            assert e["asset_url"].startswith(prefix), (
                f"{theme}: element {e['id']} asset_url {e['asset_url']!r} not under {prefix}"
            )
            assert e["asset_url"].endswith(".png")
            # Emoji should still be present as fallback for client.
            assert e.get("emoji"), f"{theme}: element {e['id']} missing emoji fallback"

    @pytest.mark.parametrize("theme,folder", list(THEME_FOLDER.items()))
    def test_scene_b_elements_have_asset_url(self, s, theme, folder):
        # Use moderate for variety; covers swap_emoji + remove diffs.
        r = s.get(f"{API}/games/spot/puzzle", params={"theme": theme, "difficulty": "moderate"})
        assert r.status_code == 200, r.text
        p = r.json()
        scene_b = p["scene_b"]
        prefix = f"/api/static/spot_objects/{folder}/"
        for e in scene_b:
            if e.get("asset_url"):
                assert e["asset_url"].startswith(prefix), (
                    f"{theme}: scene_b element {e['id']} url {e['asset_url']!r}"
                )


# --- swap_emoji diffs must resolve to swap-target asset_url ----------------
class TestSwapEmojiAssetURL:
    def test_wildlife_flamingo_swap_resolves_in_scene_b(self, s):
        """When parrot→🦩 (flamingo) fires, scene_b should expose
        asset_url=/api/static/spot_objects/wildlife/flamingo.png on the swap target."""
        # Hard pulls 7 of 12 diffs — high chance flamingo swap is included; try a
        # few seeds via re-request (server reseeds per call) up to 10 times.
        found = False
        for _ in range(15):
            r = s.get(f"{API}/games/spot/puzzle", params={"theme": "wildlife", "difficulty": "hard"})
            assert r.status_code == 200, r.text
            p = r.json()
            for d in p["differences"]:
                if d["type"] != "swap_emoji":
                    continue
                if d["target"] != "parrot":
                    continue
                # Find scene_b element with id parrot — its emoji should now be 🦩
                b_elem = next((e for e in p["scene_b"] if e["id"] == "parrot"), None)
                assert b_elem is not None, "parrot missing from scene_b"
                if b_elem.get("emoji") == "🦩":
                    assert b_elem.get("asset") == "flamingo", b_elem
                    assert b_elem.get("asset_url") == "/api/static/spot_objects/wildlife/flamingo.png", b_elem
                    found = True
                    break
            if found:
                break
        assert found, "Could not exercise wildlife flamingo swap_emoji after 15 attempts"

    def test_beach_lobster_swap_resolves_in_scene_b(self, s):
        found = False
        for _ in range(15):
            r = s.get(f"{API}/games/spot/puzzle", params={"theme": "beaches", "difficulty": "hard"})
            assert r.status_code == 200, r.text
            p = r.json()
            for d in p["differences"]:
                if d["type"] == "swap_emoji" and d["target"] == "crab":
                    b_elem = next((e for e in p["scene_b"] if e["id"] == "crab"), None)
                    if b_elem and b_elem.get("emoji") == "🦞":
                        assert b_elem.get("asset") == "lobster", b_elem
                        assert b_elem.get("asset_url") == "/api/static/spot_objects/beach/lobster.png", b_elem
                        found = True
                        break
            if found:
                break
        assert found, "Could not exercise beach lobster swap_emoji after 15 attempts"


# --- /api/static/spot_objects asset files reachable ------------------------
class TestStaticAssetFiles:
    @pytest.mark.parametrize("folder,slug", [
        ("beach", "crab"),
        ("garden", "bee"),
        ("coffee", "muffin"),
        ("wildlife", "flamingo"),
        ("kitchens", "tv"),
        ("country_towns", "mailbox"),
        ("classic_cars", "car_body"),
        ("parks_trails", "mushroom"),
    ])
    def test_asset_png_200(self, s, folder, slug):
        url = f"{API}/static/spot_objects/{folder}/{slug}.png"
        r = s.get(url)
        assert r.status_code == 200, f"{url} → {r.status_code}"
        ct = r.headers.get("content-type", "").lower()
        assert "image" in ct, f"{url} content-type: {ct}"
        # PNG magic bytes
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{url} not a real PNG"
        assert len(r.content) > 500, f"{url} suspiciously small ({len(r.content)} bytes)"


# --- Library puzzles still expose themed asset URLs -------------------------
class TestLibraryAssetURLs:
    def test_all_12_library_puzzles_carry_asset_urls(self, s):
        r = s.get(f"{API}/games/spot/library")
        assert r.status_code == 200, r.text
        puzzles = r.json()["puzzles"]
        # Should be 12 launch puzzles
        assert len(puzzles) == 12, f"expected 12 launch puzzles, got {len(puzzles)}"
        missing = []
        for card in puzzles:
            pid = card["id"]
            theme = card.get("theme")
            r2 = s.get(f"{API}/games/spot/library/{pid}")
            assert r2.status_code == 200, f"{pid}: {r2.status_code} {r2.text}"
            puz = r2.json()
            assert puz["scene_a"] and puz["scene_b"]
            # If theme has a PNG library, expect ≥1 asset_url on scene_a.
            folder = THEME_FOLDER.get(theme)
            if not folder:
                continue
            with_url = [e for e in puz["scene_a"] if e.get("asset_url")]
            if not with_url:
                missing.append(f"{pid}({theme})")
                continue
            # Folder check
            for e in with_url:
                assert e["asset_url"].startswith(f"/api/static/spot_objects/{folder}/"), (
                    f"{pid}: element {e['id']} url {e['asset_url']!r} not in {folder}"
                )
        assert not missing, f"Library puzzles missing asset_url on scene_a: {missing}"
