"""
YouBelong Milestones engine.

Curated, community-focused milestones (NOT competitive). Each milestone has:
  * key            — stable id
  * group          — Welcome / Activity / Points / Anniversary / Spirit / Birthday
  * label          — friendly display name
  * emoji          — celebratory symbol
  * message        — celebratory copy shown when achieved
  * threshold      — number required (interpreted by `compute_value`)
  * compute_value(user, stats) → number — current progress

Evaluation is lazy: call `evaluate(user, stats)` to get earned + next-up.
We DO NOT award arbitrary "points"; reaching a milestone just unlocks the
celebration card and a community notification.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s)
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _days_on_platform(user: Dict) -> int:
    t = _parse_iso(user.get("created_at"))
    if not t:
        return 0
    return max(0, (datetime.now(timezone.utc) - t).days)


MILESTONES: List[Dict] = [
    # Welcome & Community
    {"key": "new_member",     "group": "Welcome",   "label": "New member",                  "emoji": "👋", "threshold": 1,
     "message": "Welcome to YouBelong — we're so glad you're here.",
     "value": lambda u, s: 1},
    {"key": "first_friend",   "group": "Welcome",   "label": "First friend made",           "emoji": "🤝", "threshold": 1,
     "message": "You made your first friend on YouBelong!",
     "value": lambda u, s: len(u.get("friends") or [])},
    {"key": "friends_5",      "group": "Welcome",   "label": "5 friends",                   "emoji": "👥", "threshold": 5,
     "message": "5 friends — your circle is growing!",
     "value": lambda u, s: len(u.get("friends") or [])},
    {"key": "friends_10",     "group": "Welcome",   "label": "10 friends",                  "emoji": "🌟", "threshold": 10,
     "message": "10 friends — you're becoming a true neighbour.",
     "value": lambda u, s: len(u.get("friends") or [])},
    {"key": "friends_25",     "group": "Welcome",   "label": "25 friends",                  "emoji": "💞", "threshold": 25,
     "message": "25 friends — what a lovely community you've built!",
     "value": lambda u, s: len(u.get("friends") or [])},

    # Activity
    {"key": "first_lounge",   "group": "Activity",  "label": "First Coffee Lounge visit",   "emoji": "☕", "threshold": 1,
     "message": "You pulled up a chair in the Coffee Lounge.",
     "value": lambda u, s: s.get("lounge_visits", 0)},
    {"key": "first_event",    "group": "Activity",  "label": "First event attended",        "emoji": "🎉", "threshold": 1,
     "message": "First event attended — what a lovely way to meet people.",
     "value": lambda u, s: s.get("events_attended", 0)},
    {"key": "first_game",     "group": "Activity",  "label": "First game completed",        "emoji": "🎮", "threshold": 1,
     "message": "Your first game on YouBelong — well done!",
     "value": lambda u, s: s.get("games_completed", 0)},
    {"key": "games_10",       "group": "Activity",  "label": "10 games completed",          "emoji": "🧩", "threshold": 10,
     "message": "10 games — you're getting the hang of it!",
     "value": lambda u, s: s.get("games_completed", 0)},
    {"key": "games_50",       "group": "Activity",  "label": "50 games completed",          "emoji": "🏆", "threshold": 50,
     "message": "50 games — what a lovely streak of fun.",
     "value": lambda u, s: s.get("games_completed", 0)},
    {"key": "games_100",      "group": "Activity",  "label": "100 games completed",         "emoji": "🎖️", "threshold": 100,
     "message": "100 games — a true YouBelong regular!",
     "value": lambda u, s: s.get("games_completed", 0)},

    # Community Points
    {"key": "points_100",     "group": "Points",    "label": "100 Community Points",         "emoji": "✨", "threshold": 100,
     "message": "100 Community Points — kindness pays!",
     "value": lambda u, s: int(u.get("points") or 0)},
    {"key": "points_500",     "group": "Points",    "label": "500 Community Points",         "emoji": "🌟", "threshold": 500,
     "message": "500 Community Points — what a lovely contribution.",
     "value": lambda u, s: int(u.get("points") or 0)},
    {"key": "points_1000",    "group": "Points",    "label": "1,000 Community Points",       "emoji": "💫", "threshold": 1000,
     "message": "1,000 Community Points — you're a YouBelong star.",
     "value": lambda u, s: int(u.get("points") or 0)},
    {"key": "points_5000",    "group": "Points",    "label": "5,000 Community Points",       "emoji": "🏵️", "threshold": 5000,
     "message": "5,000 Community Points — extraordinary!",
     "value": lambda u, s: int(u.get("points") or 0)},

    # YouBelong Anniversaries
    {"key": "anniv_1m",       "group": "Anniversary", "label": "1 month on YouBelong",       "emoji": "🌱", "threshold": 30,
     "message": "Happy 1-month anniversary on YouBelong!",
     "value": lambda u, s: _days_on_platform(u)},
    {"key": "anniv_6m",       "group": "Anniversary", "label": "6 months on YouBelong",      "emoji": "🌿", "threshold": 180,
     "message": "6 months in — thank you for being part of YouBelong.",
     "value": lambda u, s: _days_on_platform(u)},
    {"key": "anniv_1y",       "group": "Anniversary", "label": "1 year on YouBelong",        "emoji": "🎂", "threshold": 365,
     "message": "Happy YouBelong-versary — 1 wonderful year!",
     "value": lambda u, s: _days_on_platform(u)},
    {"key": "anniv_2y",       "group": "Anniversary", "label": "2 years on YouBelong",       "emoji": "🌳", "threshold": 730,
     "message": "2 years on YouBelong — what a journey!",
     "value": lambda u, s: _days_on_platform(u)},

    # Community Spirit badges (mirror existing badge names; awarded by badge presence)
    {"key": "badge_friendly_member",  "group": "Spirit", "label": "Friendly Member badge",   "emoji": "🌼", "threshold": 1,
     "message": "You've earned the Friendly Member badge.",
     "value": lambda u, s: 1 if "Friendly Member" in (u.get("badges") or []) else 0},
    {"key": "badge_community_builder","group": "Spirit", "label": "Community Builder badge", "emoji": "🛠️", "threshold": 1,
     "message": "You've earned the Community Builder badge.",
     "value": lambda u, s: 1 if "Community Builder" in (u.get("badges") or []) else 0},
    {"key": "badge_social_star",      "group": "Spirit", "label": "Social Star badge",       "emoji": "⭐", "threshold": 1,
     "message": "You've earned the Social Star badge.",
     "value": lambda u, s: 1 if "Social Star" in (u.get("badges") or []) else 0},
    {"key": "badge_helpful_neighbour","group": "Spirit", "label": "Helpful Neighbour badge", "emoji": "🌷", "threshold": 1,
     "message": "You've earned the Helpful Neighbour badge.",
     "value": lambda u, s: 1 if "Helpful Neighbour" in (u.get("badges") or []) else 0},
]


def evaluate(user: Dict, stats: Dict) -> Dict:
    """Returns earned + next-up milestones (with progress %)."""
    earned: List[Dict] = []
    upcoming: List[Dict] = []
    for m in MILESTONES:
        current = int(m["value"](user, stats) or 0)
        threshold = int(m["threshold"])
        progress = min(1.0, current / threshold) if threshold > 0 else 0.0
        out = {
            "key": m["key"], "group": m["group"], "label": m["label"], "emoji": m["emoji"],
            "message": m["message"], "threshold": threshold,
            "current": current, "progress": round(progress, 3),
            "earned": current >= threshold,
        }
        (earned if out["earned"] else upcoming).append(out)
    return {"earned": earned, "upcoming": upcoming}
