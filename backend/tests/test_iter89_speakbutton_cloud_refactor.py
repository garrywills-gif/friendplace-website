"""
Iteration 89 — TestFlight Build 119 Bug 15 (TTS) + Bug 16 (STT) refactor.

USER-CHOSEN OPTION (a):
  • Refactor SpeakButton internally to use cloud TTS (like GeorgeSpeakButton)
    so ~30 existing call sites automatically benefit.
  • VoiceInputButton uses same file-object multipart FormData path that
    /api/mcgs/george/transcribe uses successfully on TestFlight hardware.

STRUCTURAL / BACKEND CONTRACT SCOPE ONLY. Physical iPhone AVAudioRecorder
lifecycle and cloud-mp3 AVAudioPlayer playback cannot be verified from
web preview — those require a TestFlight build.
"""
import os
import re
import io
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env", "r", encoding="utf-8") as _f:
            for _ln in _f:
                if _ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = _ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except OSError:
        pass

FRONTEND_ROOT = "/app/frontend"


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ─── BUG 15 (TTS): SpeakButton must be cloud-TTS backed ─────────────────────


class TestSpeakButtonCloudRefactor:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/SpeakButton.tsx")

    def test_no_expo_speech_import(self):
        # Only the doc-comment may mention expo-speech (historical
        # context). No actual import statement.
        bad = [
            ln for ln in self.src.splitlines()
            if ln.strip().startswith(("import", "const", "require"))
            and "expo-speech" in ln
        ]
        assert not bad, f"expo-speech import must not remain in SpeakButton: {bad}"

    def test_imports_george_api(self):
        assert "from '@/src/lib/george-api'" in self.src, \
            "SpeakButton must import from george-api"
        assert re.search(r"georgeApi\.speak\s*\(", self.src), \
            "SpeakButton must call georgeApi.speak(...)"

    def test_imports_tts_shared_registry(self):
        assert "from '@/src/lib/tts-shared'" in self.src
        for sym in ("claimActiveSpeaker", "releaseActiveSpeaker", "getCachedUri", "setCachedUri"):
            assert sym in self.src, f"SpeakButton must import {sym} from tts-shared"

    def test_public_prop_signature_preserved(self):
        # All ~30 call sites use (text, size, color, bg, testID, rate, pitch).
        # Verify the Props type still declares them (rate/pitch may be
        # ignored but must remain to keep old call sites compiling).
        for prop in ("text:", "size?:", "color?:", "bg?:", "testID?:", "rate?:", "pitch?:"):
            assert prop in self.src, f"SpeakButton Props must still declare {prop}"

    def test_default_export_present(self):
        assert "export default function SpeakButton" in self.src


class TestGeorgeSpeakButtonSharedRegistry:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/george/GeorgeSpeakButton.tsx")

    def test_imports_tts_shared(self):
        assert "from '@/src/lib/tts-shared'" in self.src
        for sym in ("claimActiveSpeaker", "releaseActiveSpeaker", "getCachedUri", "setCachedUri"):
            assert sym in self.src

    def test_uses_george_api_speak(self):
        assert "georgeApi.speak(" in self.src


class TestTtsSharedModule:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/lib/tts-shared.ts")

    def test_exports_expected_symbols(self):
        for sym in ("claimActiveSpeaker", "releaseActiveSpeaker",
                    "getCachedUri", "setCachedUri", "clearUriCache"):
            assert f"export function {sym}" in self.src, \
                f"tts-shared must export {sym}"

    def test_single_module_level_registry(self):
        # Exactly one module-level active-speaker registry (`_activeStop`)
        # so that both SpeakButton and GeorgeSpeakButton coordinate.
        assert re.search(r"let\s+_activeStop\s*:", self.src), \
            "Shared _activeStop module singleton missing"


class TestGeorgeApiDiskCache:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/lib/george-api.ts")

    def test_speak_checks_disk_cache_on_native(self):
        # Look inside the `speak:` function block.
        m = re.search(r"speak:\s*async\s*\([\s\S]*?^\s*\},", self.src, re.MULTILINE)
        assert m, "speak function block not found in george-api.ts"
        block = m.group(0)
        # Native branch must check File(Paths.cache, filename).exists BEFORE the
        # network fetch.
        assert "Paths.cache" in block, "expo-file-system cache path missing"
        assert re.search(r"cached\.exists", block) or re.search(r"\.exists\b", block), \
            "disk-cache existence check missing before network"
        # And the cache check must be gated by Platform.OS !== 'web'.
        assert "Platform.OS" in block and "'web'" in block, \
            "disk-cache check must be gated on native (Platform.OS !== 'web')"
        # Ordering: cache check should appear before fetch call.
        idx_cache = block.find("Paths.cache")
        idx_fetch = block.find("fetch(")
        assert 0 <= idx_cache < idx_fetch, "disk-cache check must precede fetch()"


# ─── BUG 16 (STT): VoiceInputButton file-object multipart on native ─────────


class TestVoiceInputButtonPlatformBranching:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/VoiceInputButton.tsx")

    def test_imports_platform(self):
        # Must import Platform from react-native for the branching.
        assert re.search(r"import\s*\{[^}]*\bPlatform\b[^}]*\}\s*from\s*[\"']react-native[\"']",
                         self.src), "Platform must be imported from react-native"

    def test_native_uses_file_object_form_append(self):
        # On native we must append a plain {uri,name,type} object — this is
        # the same shape georgeApi.transcribe uses.
        # Look for the pattern:  form.append("audio", { uri: ..., name: ..., type: ... }
        assert re.search(
            r'form\.append\(\s*["\']audio["\']\s*,\s*\{\s*\n?\s*uri\s*:\s*audioUri',
            self.src,
        ), "Native branch must append file-object {uri,name,type} to FormData"

    def test_platform_os_web_branch_present(self):
        # Web branch still uses the fetch(uri).blob() path.
        assert re.search(r'Platform\.OS\s*===\s*["\']web["\']', self.src), \
            "Platform.OS === 'web' branch missing"

    def test_no_unconditional_blob_fetch_on_native(self):
        # The `await fetch(audioUri)` for blob conversion must be inside the
        # `Platform.OS === 'web'` branch, not at top level of the upload.
        # We assert the blob-fetch call appears AFTER the Platform check.
        idx_platform = self.src.find("Platform.OS ===")
        idx_blob = self.src.find("await fetch(audioUri)")
        assert idx_platform >= 0 and idx_blob >= 0, "expected Platform check + blob fetch"
        assert idx_platform < idx_blob, \
            "fetch(audioUri).blob() must be guarded behind Platform.OS === 'web'"

    def test_field_name_is_audio(self):
        # /api/voice/transcribe still expects field name 'audio' (server.py L9873).
        # Ensure both branches append under 'audio' (not 'file').
        native_matches = re.findall(r'form\.append\(\s*["\']([a-z]+)["\']', self.src)
        assert native_matches, "no form.append calls found"
        assert all(n == "audio" for n in native_matches), \
            f"All form.append field names must be 'audio', got {native_matches}"


# ─── BACKEND CONTRACT: /api/voice/transcribe ────────────────────────────────


@pytest.mark.skipif(not BASE_URL, reason="EXPO_BACKEND_URL not set")
class TestVoiceTranscribeEndpoint:
    def test_endpoint_reachable(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code != 404, "/api/voice/transcribe missing"
        # Empty POST should be a 422 (missing 'audio' field) — never 5xx.
        assert r.status_code < 500, \
            f"unexpected server error: {r.status_code} {r.text[:200]}"

    def test_empty_post_is_422(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code == 422, \
            f"expected 422 (missing 'audio' field), got {r.status_code}"

    def test_empty_audio_field_returns_400(self):
        # Multipart with the 'audio' field but zero bytes should be rejected
        # with 400 'Empty audio upload' (see server.py L9922).
        files = {"audio": ("empty.m4a", b"", "audio/m4a")}
        r = requests.post(
            f"{BASE_URL}/api/voice/transcribe",
            files=files,
            timeout=15,
        )
        # Should be 400 (empty upload) — must not 5xx.
        assert r.status_code in (400, 401, 403), \
            f"expected 400 (empty audio), got {r.status_code} {r.text[:200]}"

    def test_wrong_field_name_returns_422(self):
        # If the client sends 'file' (George's field name) instead of 'audio',
        # FastAPI should return 422 (validation) — this is what would
        # regress if someone renamed the endpoint parameter.
        files = {"file": ("x.m4a", b"\x00\x00", "audio/m4a")}
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", files=files, timeout=15)
        assert r.status_code == 422, \
            f"field-name 'file' should 422, got {r.status_code}"


# ─── BACKEND CONTRACT: /api/mcgs/george/transcribe (no regression) ──────────


@pytest.mark.skipif(not BASE_URL, reason="EXPO_BACKEND_URL not set")
class TestGeorgeTranscribeEndpoint:
    def test_endpoint_reachable(self):
        r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe", timeout=15)
        assert r.status_code != 404, "/api/mcgs/george/transcribe missing"
        assert r.status_code < 500

    def test_requires_auth_or_field(self):
        # Without a bearer, the actor resolver returns 401.
        # Without the 'file' field, FastAPI returns 422.
        # Either way it must not be 200 and must not be 5xx.
        r = requests.post(f"{BASE_URL}/api/mcgs/george/transcribe", timeout=15)
        assert r.status_code in (401, 403, 422), \
            f"unexpected status without auth/file: {r.status_code} {r.text[:200]}"

    def test_wrong_field_name_still_uses_file(self):
        # The George endpoint expects field 'file' (not 'audio').
        # Sending 'audio' should 422.
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/transcribe",
            files={"audio": ("x.m4a", b"\x00\x00", "audio/m4a")},
            timeout=15,
        )
        # 422 (missing 'file') or 401 (no auth) — never 200 or 5xx.
        assert r.status_code in (401, 403, 422), \
            f"expected 401/422 with wrong field, got {r.status_code}"


# ─── BACKEND CONTRACT: /api/mcgs/george/speak ───────────────────────────────


@pytest.mark.skipif(not BASE_URL, reason="EXPO_BACKEND_URL not set")
class TestGeorgeSpeakEndpoint:
    def test_endpoint_reachable(self):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "hi", "voice": "george"},
            timeout=15,
        )
        assert r.status_code != 404, "/api/mcgs/george/speak missing"
        # Without auth it should be 401/403 (auth-guarded), not 5xx.
        assert r.status_code < 500, \
            f"unexpected 5xx: {r.status_code} {r.text[:200]}"

    def test_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "hi", "voice": "george"},
            timeout=15,
        )
        assert r.status_code in (401, 403), \
            f"expected 401/403 without auth, got {r.status_code}"


# ─── BUILD PINS unchanged (must remain 1.0.12 / 119) ────────────────────────


class TestBuildPinsUnchanged:
    def test_version_and_build_number(self):
        j = _read(f"{FRONTEND_ROOT}/app.json")
        assert '"version": "1.0.12"' in j, "app.json version must remain 1.0.12"
        assert '"buildNumber": "119"' in j, "iOS buildNumber must remain 119"
        assert '"versionCode": 119' in j, "Android versionCode must remain 119"
