"""Chief-of-Staff George package.

See `/app/memory/mcgs-architecture.md` v3 and `/app/memory/mcgs-phase1-plan.md`
§4 for the design. Two-pass grounded chat pattern:

1. Planner (Haiku) reads the user's question, decides which read-tools
   to invoke or declares insufficient data.
2. Tool executor runs the chosen read-tools deterministically.
3. Synthesizer (Sonnet) produces the streamed answer, grounded strictly
   in the tool results.
"""

from .prompt import (
    build_system_prompt,
    wrap_untrusted,
    CHIEF_OF_STAFF_PERSONA,
)
from .tools import (
    TOOL_REGISTRY,
    tool_schema_for_planner,
    execute_tool,
    ToolError,
)
from .chat import grounded_chat_stream, plan_tool_calls
from .triage import triage_signal_with_haiku

__all__ = [
    "build_system_prompt",
    "wrap_untrusted",
    "CHIEF_OF_STAFF_PERSONA",
    "TOOL_REGISTRY",
    "tool_schema_for_planner",
    "execute_tool",
    "ToolError",
    "grounded_chat_stream",
    "plan_tool_calls",
    "triage_signal_with_haiku",
]
