"""
Iteration 88 — STT Bug 16 v2 bulletproofing + Bug 15 v2 re-verify.

SCOPE (what this file DOES verify):
  • Structural presence of the 3 defensive changes E1 added to
    VoiceInputButton.beginCapture (lines ~148-183):
      1) 150ms warm-up sleep between prepareToRecordAsync() and record()
      2) `recorder.isRecording === false` guard immediately after record()
      3) Friendly-error copy on the catch (no raw JSON leak, warm sentence)
  • GeorgeRemembersBanner still imports AND renders <GeorgeSpeakButton>.
  • ONLY George-attributed surfaces use cloud TTS. Recipes/Home/DMs/notices
    continue to use the device-TTS <SpeakButton> component (per user spec).
  • Backend contract unchanged: POST /api/voice/transcribe with an empty
    body returns 422 (FastAPI validation error).
  • app.json pins remain 1.0.12 / build 119 (must NOT be bumped).

SCOPE (what this file CANNOT verify — device-only):
  • The actual iOS AVAudioRecorder lifecycle.
  • Whether the 150ms wait really cures the 0-byte capture on Garry's phone.
  • Whether GeorgeSpeakButton actually plays the OpenAI cloud voice on iOS.
  Those require a native build on a physical device.
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


# ─── Build pins must stay at 1.0.12 / 119 ────────────────────────────────────

class TestBuildPinsUnchanged:
    def test_version_and_build_number(self):
        j = _read(f"{FRONTEND_ROOT}/app.json")
        assert '"version": "1.0.12"' in j, "app.json version must remain 1.0.12"
        assert '"buildNumber": "119"' in j, "iOS buildNumber must remain 119"
        assert '"versionCode": 119' in j, "Android versionCode must remain 119"


# ─── Bug 16 v2 — three new defensive changes in beginCapture ────────────────

class TestBug16V2Bulletproofing:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/components/VoiceInputButton.tsx")
        # Slice the beginCapture body (roughly lines 147..185).
        m = re.search(
            r"const beginCapture = useCallback\(async \(\) => \{([\s\S]*?)\}, \[recorder, onError\]\);",
            self.src,
        )
        assert m, "beginCapture useCallback block not found"
        self.begin = m.group(1)

    def test_change_1_150ms_warmup_between_prepare_and_record(self):
        # (a) prepareToRecordAsync awaited, (b) 150ms sleep, (c) then record()
        assert "await recorder.prepareToRecordAsync()" in self.begin, \
            "prepareToRecordAsync() call missing from beginCapture"
        assert re.search(
            r"await new Promise\(\(r\) => setTimeout\(r, 150\)\)",
            self.begin,
        ), "150ms warm-up sleep between prepareToRecordAsync and record() missing"
        # Check ordering: prepare BEFORE the 150ms sleep BEFORE record()
        idx_prep = self.begin.find("prepareToRecordAsync")
        idx_wait = self.begin.find("setTimeout(r, 150)")
        idx_record = self.begin.find("recorder.record()")
        assert 0 <= idx_prep < idx_wait < idx_record, \
            "beginCapture order must be: prepareToRecordAsync → 150ms sleep → record()"

    def test_change_2_isrecording_guard_after_record(self):
        # A guard that throws / bails out when recorder didn't actually start.
        assert re.search(
            r"recorder\.isRecording\s*===\s*false",
            self.begin,
        ), "recorder.isRecording === false guard after record() missing"
        # And it must actually throw / raise so beginCapture's catch runs.
        assert "throw new Error" in self.begin, \
            "isRecording guard must throw so the catch block runs"

    def test_change_3_friendly_error_copy_on_catch(self):
        # No raw JSON leak — the catch calls onError with a warm sentence.
        assert "Sorry, I couldn't start recording. Please try again in a moment." in self.begin, \
            "Hardened friendly-error copy missing on beginCapture catch"
        # And nowhere in beginCapture do we surface a raw {"detail":...} string.
        assert '"detail"' not in self.begin

    def test_setaudiomode_precedes_prepare(self):
        # Regression guard: session mode set BEFORE prepare so iOS
        # allocates the AVAudioSession category correctly. Look at the
        # actual awaited calls, not comment mentions.
        # Strip comments first.
        code = re.sub(r"/\*[\s\S]*?\*/", "", self.begin)
        code = re.sub(r"//[^\n]*", "", code)
        idx_mode = code.find("await setAudioModeAsync(")
        idx_prep = code.find("await recorder.prepareToRecordAsync(")
        assert idx_mode >= 0 and idx_prep >= 0 and idx_mode < idx_prep, \
            f"setAudioModeAsync must be awaited BEFORE prepareToRecordAsync (mode={idx_mode}, prep={idx_prep})"


# ─── Bug 15 v2 — George voice consistency in Remembers banner ───────────────

class TestBug15V2GeorgeVoiceConsistency:
    def setup_method(self):
        self.banner = _read(
            f"{FRONTEND_ROOT}/src/components/george/GeorgeRemembersBanner.tsx"
        )

    def test_george_speak_button_imported(self):
        assert (
            "import GeorgeSpeakButton from '@/src/components/george/GeorgeSpeakButton'"
            in self.banner
        )

    def test_george_speak_button_actually_rendered(self):
        # Must appear as a JSX element, not just an import.
        assert re.search(r"<GeorgeSpeakButton\s+text=", self.banner), \
            "GeorgeSpeakButton must be rendered inside the banner JSX"

    def test_no_device_tts_speak_button_import(self):
        # No `import SpeakButton from "..."` (device TTS) in this file.
        bad = [
            ln for ln in self.banner.splitlines()
            if ln.strip().startswith("import")
            and re.search(r"\bSpeakButton\b", ln)
            and "GeorgeSpeakButton" not in ln
        ]
        assert not bad, f"Device-TTS SpeakButton import must not exist here: {bad}"

    def test_no_device_tts_speak_button_jsx(self):
        assert not re.search(r"<SpeakButton[\s>]", self.banner), \
            "Device-TTS <SpeakButton> JSX must not appear in the Remembers banner"


class TestNonGeorgeSurfacesStayOnDeviceTTS:
    """Recipes / home thought / DMs / notices / games stay on device TTS."""

    @pytest.mark.parametrize("path", [
        "app/dm/[id].tsx",
        "app/recipes/[id].tsx",
        "app/notices.tsx",
        "app/(tabs)/home.tsx",
    ])
    def test_surface_uses_device_speakbutton_not_george(self, path):
        src = _read(f"{FRONTEND_ROOT}/{path}")
        assert re.search(
            r'import\s+SpeakButton\s+from\s+"@/src/components/SpeakButton"',
            src,
        ), f"{path}: expected device-TTS SpeakButton import"
        # GeorgeSpeakButton must NOT be imported here — cloud voice is
        # George-only per Garry's spec.
        assert "GeorgeSpeakButton" not in src, \
            f"{path}: GeorgeSpeakButton should NOT be used outside George surfaces"


# ─── Backend /api/voice/transcribe contract (unchanged) ─────────────────────

@pytest.mark.skipif(not BASE_URL, reason="EXPO_BACKEND_URL not set")
class TestVoiceTranscribeEndpoint:
    def test_empty_post_returns_422(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code == 422, \
            f"Expected 422 on empty POST, got {r.status_code}: {r.text[:200]}"

    def test_endpoint_reachable_not_404_or_5xx(self):
        r = requests.post(f"{BASE_URL}/api/voice/transcribe", timeout=15)
        assert r.status_code != 404, "/api/voice/transcribe endpoint missing"
        assert r.status_code < 500, \
            f"Unexpected server error on empty POST: {r.status_code} {r.text[:200]}"
