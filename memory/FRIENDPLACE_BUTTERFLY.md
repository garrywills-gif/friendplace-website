# The FriendPlace Butterfly — Brand Principle (LOCKED)

*Locked by Garry, 1 August 2026. Protected from redesign or
reinterpretation. Any agent working on FriendPlace MUST read this
file before touching the butterfly.*

---

## The single canonical butterfly

The one true FriendPlace butterfly is:

- **Web master**    → `/app/website/public/brand-assets/butterfly.png`
- **Mobile master** → `/app/frontend/assets/brand/friendplace-butterfly.png`
  *(byte-identical mirror of the web master)*

Both files must stay in sync. If the master artwork changes, replace
BOTH files (byte-identical) and every surface picks it up
automatically.

## The single component that renders it

- **Web**    → `/app/website/components/george/GeorgeButterflyMark.tsx`
  Renders the master PNG via `<img src="/brand-assets/butterfly.png" />`.
- **Mobile** → `/app/frontend/src/components/george/GeorgeButterflyMark.tsx`
  Renders the master PNG via `<Image source={require(...)} />`.

Every surface that shows the butterfly imports `GeorgeButterflyMark`
and passes a `size` prop. There is **no other component** authorised
to draw a butterfly.

## What the butterfly means

The butterfly is not just an icon. It is the visual identity of
FriendPlace and has been part of the project since day one. It
represents:

- Two people coming together
- Belonging
- Friendship
- Hope
- Community

The **heart created between the upper wings is intentional** and is
part of the design language. Do not fill it, close it, replace it,
or "clean it up".

## Do not, ever

- Redesign the butterfly
- Reinterpret the shape
- Change the palette (blue gradient wings, deeper blue lower wings,
  pale luminous orbs)
- Swap it for the 🦋 emoji (renders differently on every OS/font)
- Draw a "new" version in SVG paths from scratch
- Replace it with a stylised icon-set version
- Add extra decoration (sparkles, glow, wobbles baked in) to the mark
  itself — animation lives in the parent wrapper, never in the mark

## If animation is required

Animate the *mark* — do not replace it with a different butterfly.
The current animated wrapper lives in `GeorgeButterfly.tsx`
(both web and mobile). It applies Reanimated / CSS transforms to the
single `GeorgeButterflyMark` component. All future animation should
follow that pattern.

## One butterfly everywhere

The same butterfly must appear across:

- FriendPlace mobile app
- FriendPlace website
- Mission Control (MCGS)
- George (Workspace + Presence Card + floating chat)
- Loading screens
- Empty states
- Celebration screens
- Emails
- Marketing surfaces
- Flyers
- Any icon slot large enough to render it clearly

## What to do if you find a legacy artefact

- A hand-drawn SVG butterfly (teal/mint gradient, tiny body) → replace
  with `GeorgeButterflyMark`
- A 🦋 emoji → replace with `GeorgeButterflyMark`
- A different PNG → replace with `GeorgeButterflyMark` (or the master
  PNG file if you need it in an email/HTML template)

## When updating the master artwork

If Garry provides a refined master butterfly:

1. Replace both PNG files (web + mobile) with the new artwork,
   byte-identical.
2. Do **not** touch `GeorgeButterflyMark.tsx` — it doesn't need to
   change.
3. Do **not** touch any caller — sizes are passed via the `size` prop.
4. Regenerate raster derivatives from the master (favicon,
   splash-icons, adaptive-icon, email banner). Track those in the
   `/app/frontend/assets/brand/` and `/app/website/public/brand-assets/`
   folders.
