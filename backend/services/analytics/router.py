"""
Analytics FastAPI router.

Two surfaces:

- **Admin API** — CMS-admin-only endpoints under
  ``/mcgs/george/analytics/*`` for running queries and drill-downs.
  Same auth pattern as ``mcgs_module.build_router``.

- **Public API** — the bridge-hit telemetry endpoint under
  ``/public/bridge/hit`` (unauthenticated, rate-limited, IP-hashed).

Wire both into the FastAPI app in ``server.py``::

    from services.analytics.router import build_analytics_router
    from services.analytics.public_router import build_bridge_public_router

    app.include_router(build_analytics_router(db), prefix="/api")
    app.include_router(build_bridge_public_router(db), prefix="/api")
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .config import DRILLDOWN_MAX_PAGE_SIZE
from .engine import get_engine
from .time_ranges import NamedRange

logger = logging.getLogger("friendplace.analytics.router")

bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class RunQueryRequest(BaseModel):
    query_id: str = Field(..., description="Registered query id.")
    range_kind: str = Field(
        "this_week",
        description="Named time range (this_week, this_month, ...).",
    )
    compare: bool = True


class DrilldownRequest(BaseModel):
    query_id: str
    range_kind: str = "this_week"
    filter_override: Optional[dict[str, Any]] = Field(
        None,
        description=(
            "Optional Mongo filter to merge with the query's default "
            "drilldown filter (e.g. restrict to a specific suburb)."
        ),
    )
    limit: int = Field(
        DRILLDOWN_MAX_PAGE_SIZE,
        ge=1,
        le=DRILLDOWN_MAX_PAGE_SIZE,
    )
    skip: int = 0


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_analytics_router(db) -> APIRouter:
    """Build the admin-facing analytics router."""
    from cms_module import _decode  # local import — same trick used by mcgs_module.

    router = APIRouter(tags=["analytics"], prefix="/mcgs/george/analytics")

    async def current_admin(
        request: Request,
        creds: HTTPAuthorizationCredentials = Depends(bearer),
    ) -> dict:
        if not creds or not creds.credentials:
            raise HTTPException(401, "Not authenticated")
        payload = _decode(creds.credentials, "cms_admin")
        admin = await db.cms_admins.find_one(
            {"id": payload["sub"]},
            {"_id": 0, "password_hash": 0},
        )
        if not admin:
            raise HTTPException(401, "Admin no longer exists")
        return admin

    def _resolve_range(raw: str) -> NamedRange:
        try:
            return NamedRange(raw)
        except ValueError as exc:
            raise HTTPException(
                400,
                f"Unknown range_kind '{raw}'. Valid values: "
                f"{[r.value for r in NamedRange]}",
            ) from exc

    # -----------------------------------------------------------------
    # GET /analytics/catalogue
    # -----------------------------------------------------------------

    @router.get("/catalogue")
    async def analytics_catalogue(_admin: dict = Depends(current_admin)):
        """Return every registered query for the LLM tool-selector."""
        engine = get_engine()
        return {"queries": engine.catalogue()}

    # -----------------------------------------------------------------
    # POST /analytics/run
    # -----------------------------------------------------------------

    @router.post("/run")
    async def analytics_run(
        body: RunQueryRequest, _admin: dict = Depends(current_admin)
    ):
        """Execute a registered query and return the typed result."""
        engine = get_engine()
        try:
            result = await engine.run(
                body.query_id,
                db=db,
                range_kind=_resolve_range(body.range_kind),
                compare=body.compare,
            )
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        return result.model_dump(mode="json")

    # -----------------------------------------------------------------
    # POST /analytics/drilldown
    # -----------------------------------------------------------------

    @router.post("/drilldown")
    async def analytics_drilldown(
        body: DrilldownRequest, _admin: dict = Depends(current_admin)
    ):
        """Return a paginated list of documents that back a metric.

        This is the entry-point for future "show me those 42 members"
        flows. It resolves the same query's drilldown spec, merges any
        caller-provided filter override, and returns docs.
        """
        engine = get_engine()
        try:
            result = await engine.run(
                body.query_id,
                db=db,
                range_kind=_resolve_range(body.range_kind),
                compare=False,
            )
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc

        spec = result.drilldown
        if spec is None:
            raise HTTPException(
                404,
                f"Query '{body.query_id}' has no drilldown data for this range.",
            )

        merged_filter = dict(spec.filter)
        if body.filter_override:
            # Shallow merge — caller's keys win. Sufficient for MVP; a
            # deeper $and-based composer can be added later.
            merged_filter.update(body.filter_override)

        cursor = db[spec.entity].find(
            merged_filter, spec.default_projection or {"_id": 0}
        )
        if spec.default_sort:
            cursor = cursor.sort(spec.default_sort)
        cursor = cursor.skip(body.skip).limit(body.limit)

        docs = await cursor.to_list(length=body.limit)
        total = await db[spec.entity].count_documents(merged_filter)

        # Strip mongo _id for JSON friendliness.
        for d in docs:
            d.pop("_id", None)

        return {
            "query_id": body.query_id,
            "entity": spec.entity,
            "filter": merged_filter,
            "total": total,
            "returned": len(docs),
            "skip": body.skip,
            "limit": body.limit,
            "items": docs,
        }

    return router


__all__ = ["build_analytics_router"]
