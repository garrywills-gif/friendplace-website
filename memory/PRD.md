# YouBelong — Friendship & Community App

YouBelong is a mobile-first friendship and community app for older adults, retirees, widows, and anyone seeking belonging. It is **not a dating app** — its core is the **Coffee Lounge**: virtual tables where people pull up a chair and have a real-time chat.

## Stack
- **Frontend**: Expo Router (React Native Web), TypeScript
- **Backend**: FastAPI + Motor (async MongoDB)
- **Real-time**: WebSockets (FastAPI native) at `/api/ws/table/{id}` and `/api/ws/dm/{conv_id}`
- **Storage**: MongoDB (collections: users, tables, groups, group_posts, events, notices, dm_conversations, messages, friend_requests, flutters, reports)
- **Auth**: Prototype username-only (no passwords). Seeded demo accounts available.

## Key Features

### Welcome screen
- Real YouBelong butterfly logo
- Primary tagline "Find Your People."
- Secondary tagline "Because You Belong Too."
- Sign Up, Log In, Continue with Apple, Continue with Google (Apple/Google trigger a quick demo login as Margaret)

### Home
- 7 large tiles: Coffee Lounge (hero), Find Friends, Local Events, Community Groups, Notice Board, Games, My Profile
- Brand logo + greeting
- Butterfly Points card with earned badges
- **Flutter inbox banner** — when friends send you a Flutter, the banner appears on home with Reply/Dismiss buttons

### Coffee Lounge (CORE feature)
- Seeded tables: Morning Coffee, Gardening Chat, Men's Shed, Book Club, Pet Lovers, New Friends, Sydney Locals
- **Occupancy indicators**: Empty Table / 1 Person / 2 People / 5 People / Full Table
- **"Active Now"** green badge when ≥ 2 are seated
- Public + Friends-only visibility
- Create your own table from the FAB (emoji picker, name, description, visibility)
- Real-time WebSocket chat with presence (join/leave)
- 1 point per message, 10 points for creating a table

### Find Friends
- Search by name / interest, filter chips by suburb
- Each friend card has 3 actions: Add Friend, **🦋 Flutter**, Message
- View profile screen: Add, Flutter, Message, Block, Report

### Flutter (warm online ping)
- Backend: `/api/flutters/send`, `/api/flutters/{user_id}`, `/api/flutters/{flutter_id}/read`
- Recipients see a purple Flutter banner on Home with Reply (opens DM) and Dismiss
- Sender earns 2 Butterfly Points

### Private Messaging
- Inbox accessible from Friends tab
- Real-time WebSocket DM (`/api/ws/dm/{conv_id}`)
- Conversation list with last message preview

### Community Groups
- Seeded: Walking Group, Community Volunteers, Garden Club, Travel Enthusiasts, Coffee Catch-Ups
- Join/open, post text updates with likes

### Notice Board
- Categories: Announcement, Share, Ask, Activity
- Like and comment posts
- 4 points for posting a notice

### Local Events
- Seeded: Coffee Morning, Community Morning Tea, Walking Group, Men's Shed BBQ, Community Market, Library Book Club, Trivia Afternoon
- RSVP / un-RSVP (6 points on RSVP)
- Date, time, location displayed

### Games
- Bingo (5×5 generated card, randomly called numbers, win-line detection)
- Trivia (multi-question Australia-flavoured)
- Word Search (10×10 grid with 6 words to find)
- Jigsaw (3×3 sliding puzzle)
- **Daily Quiz** — 5 questions deterministically selected per calendar date

### Butterfly Points & Badges
- Friendly Butterfly (10+ points)
- Helpful Neighbour (30+)
- Social Star (60+)
- Community Builder (100+)
- Earned via posting, messaging, RSVPs, creating tables, fluttering

### Profile
- Hero with avatar, name, suburb, bio
- Stats: Points, Friends count, Badges count
- Badges (locked/unlocked grid)
- Interests
- Friends grid (clickable)
- Settings & Log Out

### Settings & Accessibility
- **Large text** toggle (1.2× font scale across whole app)
- **High contrast** colour palette toggle (deep blue on white)
- Voice-to-text hint (uses native keyboard mic)
- Community Guidelines list
- Safety info

### Safety
- Report user button (saves to `reports` collection)
- Block user button (adds to user's `blocked` list)
- Community Guidelines visible in Settings

## URL Conventions
- All backend routes prefixed with `/api`
- Frontend fetches via `EXPO_PUBLIC_BACKEND_URL + /api/...`
- WebSocket: `wss://.../api/ws/table/{id}?user_id=...`

## Seed Data
On first startup the backend seeds 8 demo users, 7 tables (with starter messages), 5 groups (with sample posts), 7 events (with RSVPs), 4 notices, 2 incoming Flutters for Margaret, and 1 DM thread between Margaret and Joyce.

## Files of Note
- `/app/backend/server.py` — all FastAPI routes + WS hubs + seed
- `/app/frontend/app/index.tsx` — Welcome
- `/app/frontend/app/auth/{login,signup}.tsx`
- `/app/frontend/app/(tabs)/{home,lounge,friends,profile}.tsx`
- `/app/frontend/app/table/[id].tsx` — WS table chat
- `/app/frontend/app/dm/[id].tsx` — WS DM
- `/app/frontend/app/events.tsx`, `groups.tsx`, `group/[id].tsx`, `notices.tsx`, `messages.tsx`, `settings.tsx`, `user/[id].tsx`
- `/app/frontend/app/games/{index,bingo,trivia,wordsearch,jigsaw,quiz}.tsx`
- `/app/frontend/src/lib/{theme,auth,api,toast}.tsx`
- `/app/frontend/src/components/{Button,Header}.tsx`

## Future / Backlog (parked — not building yet)

### Local Business Sponsorships (V2 — after user growth)
- **Why parked**: Need a critical mass of engaged members before ad inventory is valuable to local businesses. Build the audience first, monetisation second.
- **Concept**: Local cafés, libraries, RSL clubs, fitness studios pay (or free for charities) to host/sponsor real-world events. Returns: sponsor profile card, branded event tile, member perks (e.g. "10% off"), map pin in "Friendly Places Near Me", optional Sponsor-of-the-Week spotlight.
- **Tiers**: Free Community (libraries/charities) · Local ~$15–30/mo · Partner ~$80/mo.
- **"First Post Free" hook**: When auto-detector flags commercial content from a non-sponsor, show friendly modal — "Your first post is on us 🎁" — then prompt to subscribe. One-shot per email+phone, 7-day expiry, still wears "Sponsored" chip, still moderated by Maggie. Acts as both growth funnel AND moderation tool (same keyword detector powers both).
- **Anti-promotion guardrails to build alongside**: Community Rules screen + signup tickbox · "Promoting a business" report reason · Auto-flag URLs/prices/commercial keywords → admin queue · Rate-limits for new accounts (2 posts/day, 1 event/week for first 48 hrs) · Business-name detection on profiles.
- **Tech**: New `sponsors` collection · `events.sponsor_id` linkage · Stripe Subscriptions (test key already in pod) · Admin approval queue in existing Maggie dashboard.
- **Trust**: All sponsors manually approved · No DMs to members · No tracking pixels · Clear "Sponsored" labels.
- **Trigger to revisit**: When DAU > ~500 or specific local businesses start asking how they can promote.
