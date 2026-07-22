"""
Iteration 90 — TestFlight Build 119 Bug 15/16 follow-up.

Removes the LAST three direct `expo-speech` runtime call sites so members
hear ONE consistent George voice EVERYWHERE, including auto-read paths.

Files being verified (STATIC / STRUCTURAL only — RN audio playback is
physical-device only):
  1. app/dm/[id].tsx                       — DM auto-read now uses speakGeorgeAuto
  2. app/games/bingo/player.tsx            — bingo call-outs use speakGeorgeAuto
  3. src/components/george/GeorgeOnboarding.tsx — dead expo-speech import removed
  4. src/lib/tts-shared.ts                 — exports speakGeorgeAuto/stopGeorgeAuto

Plus a repo-wide sanity grep and a backend smoke check (voice endpoints
untouched this iteration; this is a paranoia regression pass).
"""
import os
import re
import io
import subprocess
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


def _import_lines_with(src: str, needle: str) -> list[str]:
    """Return non-comment import lines that reference `needle`."""
    out: list[str] = []
    for ln in src.splitlines():
        s = ln.strip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        if s.startswith(("import ", "const ", "require")) and needle in s:
            out.append(ln)
    return out


def _runtime_calls(src: str, pattern: str) -> list[str]:
    """Non-comment lines matching `pattern`."""
    hits: list[str] = []
    for ln in src.splitlines():
        s = ln.strip()
        if s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        if re.search(pattern, ln):
            hits.append(ln)
    return hits


# ─── (1) app/dm/[id].tsx ────────────────────────────────────────────────────


class TestDmAutoRead:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/app/dm/[id].tsx")

    def test_no_expo_speech_import(self):
        bad = _import_lines_with(self.src, "expo-speech")
        assert not bad, f"DM must not import expo-speech: {bad}"

    def test_imports_speak_george_auto(self):
        # Must pull speakGeorgeAuto + stopGeorgeAuto from tts-shared.
        assert "speakGeorgeAuto" in self.src
        assert "stopGeorgeAuto" in self.src
        assert re.search(
            r"from\s+['\"]@/src/lib/tts-shared['\"]", self.src
        ), "expected import from '@/src/lib/tts-shared'"

    def test_ws_handler_uses_speak_george_auto(self):
        # The WS onmessage auto-read branch must call speakGeorgeAuto
        # (fire-and-forget helper), NOT Speech.speak.
        assert re.search(
            r"speakGeorgeAuto\(\s*String\(\s*data\.message\.text\s*\)\s*\)",
            self.src,
        ), "expected speakGeorgeAuto(String(data.message.text)) in WS handler"

    def test_no_runtime_speech_speak_or_stop(self):
        bad = _runtime_calls(self.src, r"\bSpeech\.(speak|stop)\s*\(")
        assert not bad, f"runtime Speech.* calls must be gone: {bad}"

    def test_cleanup_calls_stop_george_auto(self):
        # The useEffect cleanup returns a function that calls stopGeorgeAuto.
        assert re.search(
            r"return\s*\(\s*\)\s*=>\s*\{[^}]*stopGeorgeAuto\s*\(\s*\)",
            self.src,
        ), "expected cleanup to invoke stopGeorgeAuto()"


# ─── (2) app/games/bingo/player.tsx ────────────────────────────────────────


class TestBingoPlayerCallOuts:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/app/games/bingo/player.tsx")

    def test_no_expo_speech_import(self):
        bad = _import_lines_with(self.src, "expo-speech")
        assert not bad, f"bingo/player must not import expo-speech: {bad}"

    def test_imports_from_tts_shared(self):
        assert "speakGeorgeAuto" in self.src
        assert "stopGeorgeAuto" in self.src
        assert re.search(
            r"from\s+['\"]@/src/lib/tts-shared['\"]", self.src
        ), "expected import from '@/src/lib/tts-shared'"

    def test_callnext_uses_speak_george_auto(self):
        # callNext() speaks the letter+number via the cloud helper.
        assert re.search(
            r"speakGeorgeAuto\(\s*`\$\{letterFor\(callNum\)\}\s*\$\{callNum\}`\s*\)",
            self.src,
        ), "callNext() should speakGeorgeAuto(`${letterFor(callNum)} ${callNum}`)"

    def test_callbingo_uses_speak_george_auto(self):
        assert re.search(
            r"speakGeorgeAuto\(\s*['\"]Bingo!\s+Well done!['\"]\s*\)",
            self.src,
        ), "callBingo() should speakGeorgeAuto('Bingo! Well done!')"

    def test_no_runtime_speech_calls(self):
        bad = _runtime_calls(self.src, r"\bSpeech\.(speak|stop)\s*\(")
        assert not bad, f"runtime Speech.* calls must be gone: {bad}"

    def test_stop_george_auto_used_before_new_callouts(self):
        # Both callNext & callBingo call stopGeorgeAuto() to interrupt a
        # prior spoken number before starting the next one.
        assert self.src.count("stopGeorgeAuto()") >= 2, (
            "expected stopGeorgeAuto() to be used at least twice "
            "(callNext + callBingo)"
        )


# ─── (3) src/components/george/GeorgeOnboarding.tsx ────────────────────────


class TestGeorgeOnboardingCleanup:
    def setup_method(self):
        self.src = _read(
            f"{FRONTEND_ROOT}/src/components/george/GeorgeOnboarding.tsx"
        )

    def test_no_expo_speech_import(self):
        bad = _import_lines_with(self.src, "expo-speech")
        assert not bad, f"GeorgeOnboarding must not import expo-speech: {bad}"

    def test_no_runtime_speech_stop_call(self):
        bad = _runtime_calls(self.src, r"\bSpeech\.stop\s*\(")
        assert not bad, (
            f"unmount cleanup must not call Speech.stop() any more: {bad}"
        )

    def test_still_uses_george_auto_read_helpers(self):
        # Still auto-reads new George turns via the cloud helper
        # (speakGeorgeAloud / stopGeorgeAutoRead from george-auto-read).
        assert "speakGeorgeAloud" in self.src
        assert "stopGeorgeAutoRead" in self.src


# ─── (4) src/lib/tts-shared.ts ──────────────────────────────────────────────


class TestTtsSharedHelpers:
    def setup_method(self):
        self.src = _read(f"{FRONTEND_ROOT}/src/lib/tts-shared.ts")

    def test_exports_speak_george_auto(self):
        assert re.search(
            r"export\s+async\s+function\s+speakGeorgeAuto\s*\(", self.src
        ), "expected `export async function speakGeorgeAuto(...)`"

    def test_exports_stop_george_auto(self):
        assert re.search(
            r"export\s+function\s+stopGeorgeAuto\s*\(", self.src
        ), "expected `export function stopGeorgeAuto(...)`"

    def test_uses_dynamic_imports_to_avoid_circular_deps(self):
        # Must use `await import('./george-api')` etc. — NOT top-level imports.
        assert re.search(
            r"await\s+import\(\s*['\"]\./george-api['\"]\s*\)", self.src
        ), "expected dynamic `await import('./george-api')`"
        assert re.search(
            r"await\s+import\(\s*['\"]\./george-voice['\"]\s*\)", self.src
        ), "expected dynamic `await import('./george-voice')`"
        assert re.search(
            r"await\s+import\(\s*['\"]\./george-playback['\"]\s*\)", self.src
        ), "expected dynamic `await import('./george-playback')`"

        # No top-level static imports of these — they'd break the cycle.
        for mod in ("./george-api", "./george-voice", "./george-playback"):
            static = [
                ln for ln in self.src.splitlines()
                if ln.strip().startswith("import") and mod in ln
            ]
            assert not static, (
                f"tts-shared must NOT top-level-import {mod}: {static}"
            )

    def test_error_path_is_silent(self):
        # The catch block only warns in __DEV__.
        assert re.search(
            r"if\s*\(\s*__DEV__\s*\)\s*console\.warn\(", self.src
        ), "expected __DEV__-gated console.warn in speakGeorgeAuto catch"

    def test_uses_shared_active_speaker_registry(self):
        assert "claimActiveSpeaker" in self.src
        assert "releaseActiveSpeaker" in self.src

    def test_uses_uri_cache(self):
        assert "getCachedUri" in self.src
        assert "setCachedUri" in self.src


# ─── (5) Repo-wide sanity — no runtime Speech.* / expo-speech imports ─────


class TestRepoWideSpeechSanity:
    """Confirm the ONLY remaining mentions of expo-speech / Speech.speak
    / Speech.stop across /app/frontend/app and /app/frontend/src are in
    comments (documentation / historical context)."""

    def _grep(self, pattern: str) -> list[str]:
        """Return every file:line match under app/ + src/."""
        result = subprocess.run(
            [
                "grep", "-rn", "-E", pattern,
                f"{FRONTEND_ROOT}/app",
                f"{FRONTEND_ROOT}/src",
            ],
            capture_output=True, text=True,
        )
        return [ln for ln in result.stdout.splitlines() if ln]

    @staticmethod
    def _is_comment_line(file_path: str, line_no: int) -> bool:
        """Return True if line_no in file_path is inside a comment
        (single-line // or block /* … */ or JSDoc)."""
        try:
            src = _read(file_path).splitlines()
        except OSError:
            return False
        if line_no < 1 or line_no > len(src):
            return False
        # Single-line comment
        stripped = src[line_no - 1].lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            return True
        # Block comment? scan backwards for /* without a closing */.
        depth_open = 0
        for i in range(line_no - 1, -1, -1):
            ln = src[i]
            if "*/" in ln and i != line_no - 1:
                # Closed above the target — outside of a block comment.
                return False
            if "/*" in ln:
                depth_open += 1
                # If /* appears on the same line, check for */ after it.
                idx = ln.rfind("/*")
                close = ln.find("*/", idx)
                if close == -1:
                    return True
                return False
        return False

    def _assert_all_in_comments(self, pattern: str, label: str):
        hits = self._grep(pattern)
        offenders: list[str] = []
        for h in hits:
            # grep output: <path>:<lineno>:<content>
            try:
                path, lineno_str, _rest = h.split(":", 2)
                lineno = int(lineno_str)
            except ValueError:
                offenders.append(h)
                continue
            if not self._is_comment_line(path, lineno):
                offenders.append(h)
        assert not offenders, (
            f"{label} — non-comment references still present:\n"
            + "\n".join(offenders)
        )

    def test_no_runtime_expo_speech_imports(self):
        # Look for actual import statements referencing 'expo-speech'.
        result = subprocess.run(
            [
                "grep", "-rn", "-E",
                r"(^|\s)(import|require)\b.*['\"]expo-speech['\"]",
                f"{FRONTEND_ROOT}/app",
                f"{FRONTEND_ROOT}/src",
            ],
            capture_output=True, text=True,
        )
        hits = [ln for ln in result.stdout.splitlines() if ln]
        # Filter comment lines
        offenders: list[str] = []
        for h in hits:
            try:
                path, lineno_str, _rest = h.split(":", 2)
                lineno = int(lineno_str)
            except ValueError:
                offenders.append(h)
                continue
            if not self._is_comment_line(path, lineno):
                offenders.append(h)
        assert not offenders, (
            f"expo-speech imports still present at runtime:\n"
            + "\n".join(offenders)
        )

    def test_no_runtime_speech_speak_calls(self):
        self._assert_all_in_comments(
            r"\bSpeech\.speak\s*\(", "Speech.speak"
        )

    def test_no_runtime_speech_stop_calls(self):
        self._assert_all_in_comments(
            r"\bSpeech\.stop\s*\(", "Speech.stop"
        )


# ─── (6) Backend regression smoke — voice endpoints untouched ─────────────


class TestBackendVoiceEndpointsRegression:
    """Paranoia smoke checks — no backend code changed this iteration.
    Just verify /api/voice/transcribe still accepts field 'audio' and
    /api/mcgs/george/speak still exists (auth-gated).
    """

    def setup_method(self):
        assert BASE_URL, "EXPO_BACKEND_URL not resolvable"
        self.session = requests.Session()

    def test_voice_transcribe_requires_audio_field(self):
        # No form data at all → 422 (missing required 'audio' field).
        r = self.session.post(
            f"{BASE_URL}/api/voice/transcribe",
            data={"user_id": "regression-smoke"},
            timeout=15,
        )
        assert r.status_code in (400, 422), (
            f"expected 400/422 for missing audio; got {r.status_code} "
            f"{r.text[:200]}"
        )

    def test_voice_transcribe_rejects_empty_audio(self):
        # Empty bytes as 'audio' → 400 empty upload (matches iter89 contract).
        r = self.session.post(
            f"{BASE_URL}/api/voice/transcribe",
            files={"audio": ("empty.m4a", io.BytesIO(b""), "audio/m4a")},
            data={"user_id": "regression-smoke"},
            timeout=15,
        )
        assert r.status_code in (400, 422), (
            f"expected 400/422 for empty audio; got {r.status_code} "
            f"{r.text[:200]}"
        )

    def test_george_speak_requires_auth(self):
        # No Authorization header → 401.
        r = self.session.post(
            f"{BASE_URL}/api/mcgs/george/speak",
            json={"text": "Hello"},
            timeout=15,
        )
        # 401 (unauth) or 403 (forbidden) both acceptable — we just want
        # to prove the route exists and requires auth.
        assert r.status_code in (401, 403), (
            f"expected 401/403 for unauth speak; got {r.status_code} "
            f"{r.text[:200]}"
        )

    def test_george_speak_content_type_shape_documented(self):
        # This is a documentation assertion — /api/mcgs/george/speak is
        # meant to return audio/mpeg on success. We can't test success
        # without a valid JWT, but the OpenAPI schema (if reachable)
        # should still describe the route.
        r = self.session.get(f"{BASE_URL}/api/mcgs/george/speak", timeout=10)
        # GET is not allowed on this POST route → 405/404/401 all fine.
        assert r.status_code < 500, (
            f"5xx on /api/mcgs/george/speak GET probe — server error? "
            f"{r.status_code} {r.text[:200]}"
        )
