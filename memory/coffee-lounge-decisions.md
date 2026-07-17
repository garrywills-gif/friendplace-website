# Coffee Lounge — product decisions (locked)

## Seat capacity per table: UNCAPPED (deliberate)

**Decision date:** 17 July 2026
**Decided by:** Garry

### What
Coffee Lounge tables (`db.tables`) have no seat limit. Any user can join
any public table via `POST /api/tables/{table_id}/join/{user_id}` and
they will be added to `seated` unconditionally (founder-only tables
still enforce founder status; that guard stays).

### Why
Adding a seat cap risks telling someone "this table is full — you can't
sit here". That's a subtle form of exclusion, and it directly clashes
with the FriendPlace tagline **"Because you belong too."** — the whole
point of the app is that nobody gets turned away.

The café analogy Garry uses:
> *"If a table gets busy, the community answer is another table, not a
> bouncer."*

### Do NOT
- Add `capacity` / `max_seats` to the `Table` model.
- Add "Table full" chips, waitlists, or reject logic to `join_table`.
- Suggest capping as a "polish" fix.

### Do
- Encourage users to spin up a new table if a room feels crowded — the
  Coffee Lounge UI's "Start a table" CTA is the pressure-release valve.
- Consider server-side auto-splitting only if a *single* table ever
  crosses a truly unusable threshold (e.g. >200 concurrent users) — and
  even then, revisit with Garry first.

### Note
The `to_list(50)` in `list_tables` is a **display cap** for the seated
avatar grid (we only render up to 50 avatars), not a seat cap. Real
seated count comes from `len(t.get("seated"))` and is uncapped.
