"""Typed application config — single source of truth for env-driven settings.

Why this exists:
    Previously, `os.environ[...]` calls were sprinkled across ``server.py``.
    That makes the future migration from Emergent's single-pod deploy to
    MongoDB Atlas / Render / AWS a refactor instead of an env-var swap
    (per the platform team's scale-readiness checklist, item #1).

    This module collects every environment-driven knob behind a Pydantic
    `Settings` model. Each value falls back to a sensible default so the
    app boots in development with zero configuration, but production
    deployments can override any single value via the standard env-var
    mechanism (``.env`` file, Emergent UI, Render secrets, etc.).

Usage:
    from config import settings
    client = AsyncIOMotorClient(settings.mongo_url)

Notes:
    - All values are validated at startup: a missing required env var
      (``MONGO_URL`` / ``DB_NAME``) raises a clear error immediately
      instead of failing 500ms later inside a Motor call.
    - Sentry DSN is OPTIONAL — when blank, sentry-sdk is initialised in
      no-op mode and zero events ship. Paste the real DSN into the
      Emergent env UI when ready; no code changes required.
    - Adding a new tunable knob? Add a field here with a default, then
      reference ``settings.<field>`` from server.py — never reach back
      into ``os.environ`` directly.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).parent


class Settings(BaseSettings):
    # ---- Required infra ----
    # No default — boot must fail fast if these aren't wired. Both come from
    # the Emergent pod environment and must NEVER be hardcoded in code.
    mongo_url: str = Field(..., alias="MONGO_URL")
    db_name: str = Field(..., alias="DB_NAME")

    # ---- Auth & session ----
    # SIGNING KEY for our HS256 JWTs. No safe default — a weak or public
    # secret lets anyone forge a session for any user, including admins
    # (SEC-001). Boot fails fast if the env var is missing OR too short.
    # Generate a fresh one with `python -c "import secrets;
    # print(secrets.token_urlsafe(64))"` and paste into the Emergent env
    # panel / .env. Minimum accepted length is 32 chars — enforced below.
    jwt_secret: str = Field(..., alias="JWT_SECRET")
    jwt_ttl_min: int = Field(10080, alias="JWT_TTL_MIN")  # 7 days
    reset_ttl_min: int = Field(10, alias="RESET_TTL_MIN")
    max_login_attempts: int = Field(5, alias="MAX_LOGIN_ATTEMPTS")
    lockout_min: int = Field(15, alias="LOCKOUT_MIN")

    # ---- Third-party integrations (optional) ----
    # Emergent universal LLM key (used by Emergent-managed Google OAuth +
    # any future LLM features). Optional so the app boots in pure dev.
    emergent_llm_key: Optional[str] = Field(None, alias="EMERGENT_LLM_KEY")

    # Sentry DSN — leave blank and Sentry stays inactive. Get one for free
    # at sentry.io → Settings → Projects → Client Keys.
    sentry_dsn: Optional[str] = Field(None, alias="SENTRY_DSN_BACKEND")
    sentry_environment: str = Field("development", alias="SENTRY_ENVIRONMENT")
    # Sample rate for "normal" events (errors). 1.0 = all events.
    sentry_sample_rate: float = Field(1.0, alias="SENTRY_SAMPLE_RATE")
    # Traces sample rate for performance — keep low; expensive at scale.
    sentry_traces_sample_rate: float = Field(0.05, alias="SENTRY_TRACES_SAMPLE_RATE")

    # ---- Founding Member programme ----
    # First N successful sign-ups get the "Founding Member" badge. Tune up
    # / down without redeploying via env var.
    founding_member_cap: int = Field(500, alias="FOUNDING_MEMBER_CAP")

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        # IMPORTANT: ignore extra env vars — Emergent injects a bunch of
        # platform-level keys we don't care about (EXPO_PACKAGER_*, etc.).
        # Without ``extra="ignore"`` pydantic-settings would raise on boot.
        extra="ignore",
    )


# Singleton — import this everywhere; never instantiate manually.
settings = Settings()  # type: ignore[call-arg]

# ---- Runtime validation of security-sensitive knobs ----
# Enforced here rather than as a Pydantic validator so the failure mode is
# explicit at import time (and the message survives Pydantic's error
# wrapping cleanly). SEC-001 remediation — refuse to start with a weak or
# publicly-known JWT secret.
_JWT_KNOWN_WEAK = {"yb-dev-secret-change-me", "change-me", "secret", ""}
if (
    not settings.jwt_secret
    or len(settings.jwt_secret) < 32
    or settings.jwt_secret in _JWT_KNOWN_WEAK
):
    raise RuntimeError(
        "JWT_SECRET is missing, too short, or set to a known development "
        "value. Generate a fresh one with:\n"
        "    python -c 'import secrets; print(secrets.token_urlsafe(64))'\n"
        "and add it to the backend .env / Emergent env panel. "
        "Refusing to start — this would allow anyone to forge sessions."
    )
