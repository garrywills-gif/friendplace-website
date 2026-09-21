/**
 * Profile-completeness gate (iter191).
 *
 * Social sign-in (Google / Apple) authenticates the member but must NOT skip
 * the normal new-member profile setup. Email signup always captures a suburb
 * (or an explicit "hide my suburb"), so "has the member set a location yet?"
 * is our reliable signal for whether profile setup has happened. A brand-new
 * Google/Apple account has neither, so it is routed through setup first; an
 * existing social member who already completed setup continues normally.
 */
export function needsProfileSetup(user: any): boolean {
  if (!user) return false;
  if (user.profile_complete === true) return false;
  const hasLocation = !!(user.suburb || user.suburb_hidden);
  return !hasLocation;
}
