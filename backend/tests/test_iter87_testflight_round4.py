"""
TestFlight Round-4 (v1.0.12 / build 119) verification.

Covers three bugs Garry found in build 118:
  - BUG 14: Onboarding ending — single '☕ Head to FP Café' primary + 'Finish later'
            tertiary; closing turn contains 'Why not head over to the FP Café first?';
            approval routes to /(tabs)/lounge.
  - BUG 15: GeorgeRemembersBanner uses GeorgeSpeakButton (cloud TTS) instead of
            legacy SpeakButton (device TTS).
  - BUG 16: VoiceInputButton — 250ms iOS flush wait; blob-size guard >=500b;
            never surfaces raw backend JSON; 401/403 → friendly re-sign-in copy.
            Backend /api/voice/transcribe still returns 422 on empty POST.

The build/version pins (app.json 1.0.12 / build 119) MUST stay unchanged.
"""
import os
import re
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")
if not BASE_URL:
    # Fallback: read from /app/frontend/.env (tests run outside Metro).
    try:
        with open("/app/frontend/.env", "r", encoding="utf-8") as _f:
            for _ln in _f:
                if _ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = _ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except OSError:
        pass
FRONTEND_ROOT = "/app/frontend"


# ─── STRUCTURAL — build pins ────────────────────────────────────────────────

def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


class TestBuildPins:
    """app.json version/build must remain 1.0.12 / 119."""

    def test_app_json_version_locked(self):
        j = _read(f"{FRONTEND_ROOT}/app.json")
        assert '"version": "1.0.12"' in j
        assert '"buildNumber": "119"' in j
        assert '"versionCode": 119' in j


# ─── BUG 14 — Onboarding ending ─────────────────────────────────────────────

class TestBug14OnboardingEnding:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/george/GeorgeOnboarding.tsx")
        self.butterfly = _read(f"{FRONTEND_ROOT}/src/components/george/GeorgeButterfly.tsx")

    def test_single_primary_head_to_fp_cafe_button(self):
        assert "☕ Head to FP Café" in self.src, "Primary CTA label missing"

    def test_no_change_something_button(self):
        # Strip comments so we only inspect JSX/code. Only failure is if the
        # label is rendered inside a <Text> block.
        code = re.sub(r"/\*[\s\S]*?\*/", "", self.src)
        code = re.sub(r"//[^\n]*", "", code)
        assert "Change something" not in code, \
            "Retired 'Change something' button still rendered"

    def test_that_looks_right_button_retired(self):
        code = re.sub(r"/\*[\s\S]*?\*/", "", self.src)
        code = re.sub(r"//[^\n]*", "", code)
        assert "That looks right" not in code, \
            "Retired 'That looks right' button still rendered"

    def test_finish_later_tertiary_present(self):
        # Two references expected: the header "Finish later" pressable AND the
        # tertiary button under the primary CTA.
        assert self.src.count(">Finish later<") >= 2

    def test_closing_turn_contains_fp_cafe_invitation(self):
        assert "Why not head over to the FP Caf" in self.src, \
            "Closing George turn missing FP Café invitation"

    def test_butterfly_routes_to_lounge_on_done(self):
        # After onboarding approve → onDone → router.push('/(tabs)/lounge')
        assert "router.push('/(tabs)/lounge')" in self.butterfly, \
            "GeorgeButterfly.onDone should route to /(tabs)/lounge after approve"


# ─── BUG 15 — George voice consistency ──────────────────────────────────────

class TestBug15GeorgeRemembersUsesCloudTTS:
    def setup_method(self):
        self.src = _read(
            f"{FRONTEND_ROOT}/src/components/george/GeorgeRemembersBanner.tsx"
        )

    def test_imports_george_speak_button(self):
        assert "import GeorgeSpeakButton from '@/src/components/george/GeorgeSpeakButton'" \
            in self.src, "GeorgeSpeakButton import missing"

    def test_does_not_import_legacy_speak_button(self):
        # The generic <SpeakButton> (device TTS) should be gone from this file.
        # A bare "import ... SpeakButton" that isn't GeorgeSpeakButton is the anti-pattern.
        lines = [
            ln for ln in self.src.splitlines()
            if ln.strip().startswith("import") and "SpeakButton" in ln
            and "GeorgeSpeakButton" not in ln
        ]
        assert not lines, f"Legacy SpeakButton still imported: {lines}"

    def test_renders_george_speak_button(self):
        assert re.search(r"<GeorgeSpeakButton\s+text=", self.src), \
            "GeorgeSpeakButton not rendered"

    def test_no_bare_speak_button_jsx(self):
        # Nothing like `<SpeakButton ` should remain in the JSX.
        assert not re.search(r"<SpeakButton[\s>]", self.src)


# ─── BUG 16 — VoiceInputButton friendly errors & empty-audio guard ──────────

class TestBug16VoiceInputButton:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/VoiceInputButton.tsx")

    def test_ios_flush_wait_after_stop(self):
        # 250ms sleep between recorder.stop() and reading recorder.uri
        assert "await new Promise((r) => setTimeout(r, 250))" in self.src, \
            "iOS 250ms flush wait after recorder.stop() missing"

    def test_blob_size_guard_present(self):
        assert re.search(r"audioBlob\.size\s*<\s*500", self.src), \
            "Empty/short blob size guard (>=500) missing"

    def test_empty_audio_friendly_copy(self):
        assert "Sorry, I couldn't hear anything. Please try again." in self.src

    def test_401_403_friendly_reauth_copy(self):
        assert "You'll need to sign in again to use voice input." in self.src

    def test_never_leaks_raw_json_detail(self):
        # The catch block guards against messages starting with '{' (raw JSON).
        assert "!e.message.startsWith('{')" in self.src, \
            "Raw-JSON leak guard missing in catch block"

    def test_no_raw_backend_detail_string_surfaced(self):
        # We should not directly pass through 'Empty audio upload' or similar
        # backend text to onError. That literal must not appear in the file.
        assert "Empty audio upload" not in self.src or \
            re.search(r"//.*Empty audio upload", self.src), \
            "Raw backend error text should not be user-visible"


# ─── BUG 16 — Backend /api/voice/transcribe reachability ────────────────────

@pytest.mark.skipif(not BASE_URL, reason="EXPO_BACKEND_URL not set")
class TestVoiceTranscribeEndpoint:
    """Verify backend behaviour is UNCHANGED — empty POST returns 422."""

    def test_empty_post_returns_422(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        # 422 = FastAPI validation error (missing 'audio' file field).
        assert r.status_code == 422, \
            f"Expected 422 on empty POST, got {r.status_code}: {r.text[:200]}"

    def test_endpoint_not_404(self):
        # Guard against the endpoint being accidentally removed.
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code != 404, "/api/voice/transcribe endpoint missing"
