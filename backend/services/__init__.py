# FriendPlace backend service modules (long-term refactor target).

# Import-time campaign email hotfix DISABLED (backup commit 36f29a88).
# The custom campaign_email_fix startup monkeypatch is no longer applied, so
# Campaigns fall back to the normal shared FriendPlace email renderer/sender in
# email_service (announcement_template / send_email_detailed) exactly as they
# worked before the Rotary repair work. Transactional email paths are unchanged.
# from . import campaign_email_fix as _campaign_email_fix  # noqa: F401,E402
