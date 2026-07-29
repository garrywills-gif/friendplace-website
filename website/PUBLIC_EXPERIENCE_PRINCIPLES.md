# FriendPlace Public Experience Principles

_Written by Garry, July 2026. Kept here — not in a doc, not in a
tracker — because everything downstream of this file has to live
by it._

---

## The One Principle

_Locked with Garry, Dec 2026, after building /meet, the tour, and
Register Your Interest together._

> **FriendPlace isn't a website. It's a visit.**
>
> George welcomes people at the door, invites them in, then quietly
> lets FriendPlace speak for itself. He never competes with the
> experience. He's simply available whenever someone wants to chat.

This is the one that generates all the others. Before writing a
line of copy, before designing a page, before adding a feature,
before choosing a component, ask:

> **Would this happen in a house you'd want to visit?**

- A host doesn't hover over their guest. → George doesn't narrate
  every page.
- A host doesn't ask you to sign the guestbook before you've seen
  the house. → We don't ask people to register before they've had
  a look around.
- A host doesn't decorate their front door with sales copy. → No
  "download now" pop-ups, no urgency banners, no countdown timers.
- A host doesn't demand your attention. → No push notifications,
  no unread badges, no "chat with George!" pill.
- A host is proud of their home but doesn't oversell it. → The
  pages tell the story plainly; we trust the visitor to feel it.

If a decision would feel wrong in a friend's home, it's wrong in
FriendPlace.

Every downstream principle in this file — the North Star, the
Quiet Host, the Permanent Front Door, the Living Homepage — is a
concrete expression of this one idea. If they ever contradict it,
this one wins.

---

## The North Star

Before every feature, every page and every design decision, ask:

> **Does this make someone feel welcome?**

If the answer is no, rethink it.

---

## Our purpose

Our purpose isn't to impress people.
Our purpose is to welcome them.

Our job isn't to convince people to download an app.
Our job is to make them feel they've found a place where they belong.

If someone leaves the website thinking _"those people seem nice"_ or
_"I'd like to come back when this launches"_, we've succeeded. If
they leave feeling like they've already met George or Georgia, even
better.

The website shouldn't feel like marketing. It should feel like the
front door of FriendPlace.

## The feeling we're aiming for

People should leave every page feeling:

- **More comfortable** than when they arrived.
- **More hopeful** than when they arrived.
- **More connected** than when they arrived.
- **More confident** that FriendPlace is somewhere they belong.

## What this asks of every craft decision

Every animation, every word, every colour and every interaction
should support that feeling.

Practically, this means:

- **Lower the shoulders.** Short sentences. Air around things. No
  urgency, no dark patterns, no countdown timers.
- **No jargon.** If a grandparent wouldn't say it aloud, we don't
  write it.
- **Warm imperfection over polished sterility.** Slightly hand-drawn
  illustrations beat glossy stock photography. A gentle wobble beats
  a hard snap.
- **Every CTA is an invitation, never a demand.** "Come in", not
  "Sign up now". "Have a chat", not "Chat with our AI".
- **George and Georgia are people, not features.** The butterfly
  steps out of the logo. It doesn't pop open.

## The "Welcome back" moment

When someone eventually downloads the app and signs in for the first
time, the companion they chose on the website shouldn't say
_"Welcome to FriendPlace."_

They should simply smile and say:

> **Welcome back.**

If we get that feeling right, everything else becomes much easier.

---

## The Quiet Host

_Locked with Garry, Dec 2026._

> "We've accidentally moved away from designing a website and started
> designing what it feels like to visit someone."

That is the whole thing.

George (and Georgia) are hosts, not narrators. A good host welcomes
you at the door, offers to show you around, and then **steps back
and lets the space speak for itself**. They don't hover. They don't
narrate every room. They're simply there if you need them.

Concretely, on the FriendPlace public site:

- **On `/meet`** — George is fully present. He notices, he flies over,
  he greets you. One invitation, one line: _"Come on, let me show
  you around."_
- **On the tour pages** (`/about`, `/how-it-works`, `/features`) —
  **George is silent**. Not one "George says" panel. Not one
  George-flavoured heading. The pages tell FriendPlace's story in
  their own confident voice. His silence is a feature, not a gap —
  it lets the story land.
- **The only mark of him during the tour** is a small brand-butterfly
  affordance in the corner of every tour page, with a single line
  visible on hover / focus:
  > _"Tap me if you'd like to chat."_

  Tapping opens a soft sheet with two options: _"Take me back to the
  beginning"_ (→ `/meet`) and _"I have a question"_ (→ `/contact` or
  a lightweight message form). He is available; he is never in the
  way.
- **On `/register-interest`** — George's voice returns for exactly
  one line, the closing line of the whole journey:
  > _"If this feels like somewhere you'd like to belong, I'd love to
  > let you know when we open."_

  Because he's been quiet through the tour, that line lands.

Rules that fall out of this:

1. **No George-voice copy** anywhere on the tour pages. If it reads
   like something a host would say to fill silence, cut it. Trust the
   pages.
2. **Registration is not a persuasion page.** By the time a visitor
   reaches it they've had the whole story. RYI's job is to be the
   moment they say yes, nothing more. Short line, four fields.
3. **The tour has one entry and one exit.** In: `/meet`. Out:
   `/register-interest`. Anyone who lands mid-tour from Google can
   still tap the little butterfly to meet George — but we never
   redirect them there, and we never lecture them for arriving
   sideways.
4. **The butterfly-in-the-corner is quiet on purpose.** No pulsing
   badges. No unread counts. No "Chat with George!" pill. It's just
   there, breathing, the way a host stands quietly at the end of a
   room until you catch their eye.

If a change makes George feel like an assistant, a chatbot, or a
narrator, the change goes back.

## The Living Homepage

_Locked with Garry, Nov 2026._

Most websites greet you with the same words for years. FriendPlace
should not.

The structure of `/meet` never changes — the butterfly flight, the
pause, the choice of companion, the arrival, the wings, the voice.
That's the permanent room. But **what George or Georgia says inside
that room may occasionally change** to match the time of year, a
milestone, or a community moment. Examples:

- **Christmas / Holidays.** _"Hello. I'm George. Merry Christmas! I'm
  really pleased you dropped in today."_
- **New Year.** _"Hello. I'm Georgia. Happy New Year — I'm so glad
  you found us."_
- **Easter.** A gentle acknowledgement of the season.
- **FriendPlace milestones.** _"Hello. I'm George. We just welcomed
  our thousandth Founding Member — thank you for finding us on such
  a special day."_
- **Community campaigns.** A one-week hand-crafted welcome tied to
  something the community is doing together.

Practical rules:

1. **The default welcome is the ground truth.** If nothing else is
   scheduled, George and Georgia use their permanent lines. A blank
   catalog must never break the page.
2. **Seasonal welcomes are additive, not clever.** Only the words
   change — the shot list, the timing and the pauses do not. A
   holiday welcome takes exactly as long to land as the default.
3. **In-voice, not in-writing.** Every variant ships with its own
   Ash / Nova audio so the greeting is spoken naturally, never
   Frankenstein-spliced.
4. **A named human is accountable for every variant.** George and
   Georgia (via the Communications Manager pilot in `/admin/drafts`)
   are the ones who write and voice new welcomes. Nothing goes live
   without a person's name on it.
5. **The change is a heartbeat, not a promotion.** Never sale copy,
   never dark patterns, never a countdown timer. The point is that
   a real person would greet you differently in December — so we
   do too.

The catalog + selection logic live in `/app/website/lib/welcomes.ts`.
Read that file before adding a variant.

## The Permanent Front Door

_Locked with Garry, Nov 2026._

`/meet` is not a launch page. It is not marketing. It is the permanent
front door of FriendPlace — the first chapter of everyone's journey,
before launch and forever after.

**The welcome never changes. Only the next step changes.**

Everything above the fold is permanent:

- The soft cream room.
- The words _"Come in."_ (they stay through launch and every year
  after).
- The question _"Who would you like to show you around today?"_
- The two choice cards — George and Georgia, always both, always
  the same warmth.
- The butterfly lifting off the chosen card and coming over.
- The three-line greeting: _"Hello. I'm George. I'm really pleased
  you found us."_
- The pauses, the wings, the eye contact, the voice.

What changes is what George or Georgia offer at the end. In
pre-launch mode, they invite the visitor to _"register your
interest"_ or _"ask a question"_. In launched mode, they simply say:

> **FriendPlace is ready now.**

…and the two soft CTAs become **App Store / Google Play / Scan the
QR code**. Nothing else moves. Same room, same welcome, same person;
the door at the end just leads somewhere different.

This has three practical consequences for every craft decision on
`/meet` and every downstream surface:

1. **Nothing about the arrival, the pause, the greeting, the wings,
   the audio, the copy or the choice of companion is "launch
   temporary"**. All of it stays. Build to keep, not to replace.
2. **CTAs are behind a mode switch.** The choreography must never
   need to know whether we're pre-launch or launched. Only the final
   couple of lines and the buttons underneath change. Any code that
   couples the two goes back.
3. **The "register your interest" list is not a mailing list.** It's
   the list of early friends George and Georgia already know by name.
   When those people first open the app, the "Welcome back" moment
   above has to feel earned — because on the site, they've already
   met.

If a change makes `/meet` feel like a temporary landing page rather
than a permanent room, the change goes back.

## How this file is used

Every PR that touches anything under `app/(public)/*`, `components/public/*`,
or the public-facing part of the backend must be answerable to this
file. If a reviewer can't point at a line above that a change serves,
the change goes back.

This isn't marketing copy. It's the acceptance criteria.

## Related files

- `/app/JOURNEY_CONTINUITY.md` — the cross-surface principle that
  sits above this one. If you're touching two or more surfaces
  (website + email, website + app, app + Mission Control), read that
  file **first**.
