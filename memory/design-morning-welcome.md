# Morning Welcome Screen — Design Spec

_Locked with Garry, 1 August 2026._

## Intent

The first time a member opens FriendPlace each calendar day (device
local time), George greets them with a warm one-liner and then
quietly returns to his normal position. This is not an engagement
mechanic and not a session counter — it's simply the app saying
_hello_.

> "That would make opening FriendPlace feel like walking into your
> favourite café." — Garry, 1 Aug 2026

## Timing

- **Once per calendar day** (device local time). If a member opens
  the app at 11:55 pm and again at 7:00 am, they get greeted twice.
  Different days, real life.
- **No 20-hour rolling windows, no session dedup, no per-launch
  throttling.** Only "first launch of this calendar date".
- Stored per-user in AsyncStorage: `george_last_greeted_yyyymmdd:{uid}`.

## Time-of-day bands

| Band | Hours (device local) | Opener candidates |
|------|----------------------|-------------------|
| 🌅 Morning | 05:00 – 11:59 | "Good morning, {first_name}." · "Morning, {first_name}." · "Lovely to see you this morning." |
| ☀️ Afternoon | 12:00 – 16:59 | "Good afternoon, {first_name}." · "Hope you're having a lovely afternoon." · "Nice to see you." |
| 🌙 Evening | 17:00 – 04:59 | "Good evening, {first_name}." · "I hope you've had a good day." · "It's lovely to see you this evening." |

## Second line (invitation)

After the greeting, George invites them into the day's moment.
Usually the signature phrase — occasionally the softer variant.

- Signature (most days): **"What's your moment today?"**
- Occasional (roughly 1 in 4): **"I hope today brings a little
  something to smile about."**

## Variation rule

Enough variation that George never sounds scripted. Rotate through
the opener candidates for the current band (never the same opener
two days running). Second line uses signature by default; the
softer variant surfaces about 1 in 4 mornings and evenings, less
often in the afternoon.

## Placement

Full-width greeting card at the top of the Home tab on the day's
first render. Not a modal, not blocking. Dismissible with a small
close affordance OR by scrolling past — it doesn't need
acknowledgment.

If the member has an unread milestone from George (see
"George celebrates the little things"), the greeting slot yields
to the milestone note for that day. The greeting waits until the
following morning.

## Not this

- ❌ No streaks, "days in a row", or session counters.
- ❌ No "You haven't opened FriendPlace for N days" if a member has
  been away — the tone reads "Lovely to see you", never "welcome
  back after all this time".
- ❌ No confetti, no sound, no haptic.
- ❌ No push notification tied to it — this is only what shows
  when they open the app themselves.

## Test

Read the whole card out loud, plus the invitation. If it sounds
like a friend or a favourite café host, ship it. If it sounds
like an engagement banner, cut it.

## Related principles

- `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` §_George
  celebrates the little things._
- `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` §_George
  remembers, gently._
- `/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md` §_No guilt. Ever._
