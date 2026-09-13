# FriendPlace backend service modules (long-term refactor target).

# Import-time campaign email hotfix. This patches only the lazily imported
# MCGS campaign renderer/sender in email_service; transactional email paths
# remain unchanged.
from . import campaign_email_fix as _campaign_email_fix  # noqa: F401,E402
