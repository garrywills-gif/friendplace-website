# Preview URL routing (nginx path-proxy)

Because both the mobile app and the marketing website live under path
`/events`, we route the preview URL (`localhost:3000`) explicitly:

| Path pattern                              | Upstream        | Why |
|-------------------------------------------|-----------------|-----|
| `/events` (exact)                         | Expo (:3002)    | Mobile Local Events screen |
| `/events/new` (exact)                     | Expo (:3002)    | Mobile "Host a new event" |
| `/events/edit/*`                          | Expo (:3002)    | Mobile edit-event screen |
| `/events/{slug}` / `/events/{slug}/rsvp/*`| Next.js (:3001) | Marketing detail + RSVP manage |
| `/api/public/events/*`                    | (backend API)   | Untouched — always /api |

## Do NOT
- Re-merge these into a single `location ^~ /events` block — nginx
  prefix-match precedence puts prefixes before exact-match, but only
  the LONGER prefix wins. Keeping both an exact-match (`= /events`)
  and a prefix (`^~ /events/`) gives us the split we need.
- Change the mobile app's Events route path away from `/events` — the
  route is deeply linked from Home, Coffee Lounge, and George.
- Change the marketing website's `/events/[slug]` paths — these are
  the SEO URLs printed in emails, ICS files and shared invitations.

## In production
This proxy only exists for local/preview. Production is:
- Marketing website: `friendplace.com.au` → Vercel serves Next.js
- Mobile app: shipped via Expo dev/production builds

So there's no path conflict in prod — this note only matters for the
sandbox preview URL.
