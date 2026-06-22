# YouBelong — First-Time-User QA Checklist (TestFlight)

> Tick each item off on a fresh install of the TestFlight build. Aim to use a brand-new Apple ID (or fully sign out of your existing account) so you experience the app as a first-timer would. Reset by deleting + reinstalling between major flows.
>
> 🦋 = blocker for App Store submission · ✨ = polish item (won't block review but worth fixing)

---

## 0. Install & First Launch
- [ ] 🦋 App installs from TestFlight without errors
- [ ] 🦋 App icon shows the YouBelong butterfly on the home screen (not the placeholder Expo icon)
- [ ] 🦋 App display name reads **YouBelong** (not "frontend")
- [ ] 🦋 Splash screen shows briefly, then app loads within 5 seconds
- [ ] 🦋 App does NOT crash on cold launch
- [ ] ✨ Splash screen background matches the brand palette (navy/teal)
- [ ] ✨ Status bar text legible against background (no white-on-white)

## 1. Welcome / Sign Up
- [ ] 🦋 Welcome screen explains what YouBelong is in one sentence
- [ ] 🦋 "Sign up" button visible, large (≥48pt), and accessible
- [ ] 🦋 "Sign in" link for returning users is visible
- [ ] 🦋 Sign up with email + password works
- [ ] 🦋 Password rules are explained (min length, no spaces, etc.)
- [ ] 🦋 "Sign in with Google" works on a real Google account
- [ ] 🦋 Error messages are friendly (not raw API errors) e.g. "Email already in use"
- [ ] 🦋 Tapping Privacy Policy / Terms opens the in-app legal pages
- [ ] ✨ Keyboard auto-dismisses on submit
- [ ] ✨ "Show password" eye toggle is present and usable

## 2. Onboarding
- [ ] 🦋 Name, suburb, interests selection works
- [ ] 🦋 Suburb suggestions show real Australian suburbs
- [ ] 🦋 At least 4 interests selectable (more allowed)
- [ ] 🦋 Profile photo upload works from gallery (test with portrait + landscape image)
- [ ] 🦋 Profile photo upload works from camera
- [ ] 🦋 Camera permission prompt is contextual (only shown when the user taps the camera button)
- [ ] 🦋 Photo library permission prompt is contextual
- [ ] 🦋 "Skip for now" exits onboarding gracefully
- [ ] ✨ Onboarding copy is warm and inclusive (no "living alone" framing)
- [ ] ✨ Progress indicator shown (e.g. "Step 2 of 4")

## 3. Home / Today
- [ ] 🦋 Home shows the day's highlights (upcoming event, friend suggestions, daily crossword)
- [ ] 🦋 Butterfly Points balance + 🦋 icon visible at top
- [ ] 🦋 "Find friends" tile clickable
- [ ] 🦋 "Coffee Lounge" tile clickable
- [ ] 🦋 "Today's Crossword" tile clickable → goes to the daily puzzle
- [ ] ✨ Empty states are friendly ("No events yet — be the first to start one!")

## 4. Find Friends
- [ ] 🦋 Suggested friends list loads
- [ ] 🦋 Search by name, suburb, or interest returns results
- [ ] 🦋 Tapping a profile opens the full profile screen
- [ ] 🦋 Send Flutter (friend request) works
- [ ] 🦋 Founder users show the 🦋 butterfly mark next to their name
- [ ] 🦋 Distance filter works (e.g. "Within 50km")
- [ ] ✨ Empty search shows a clear message ("No matches — try a different interest")

## 5. Profile (yours and others')
- [ ] 🦋 Your own profile shows your photo, name, suburb, interests, butterflies, badges
- [ ] 🦋 Tap-to-edit works on name, suburb, interests, bio
- [ ] 🦋 Photo update from gallery + camera works
- [ ] 🦋 Other user's profile shows their info + "Send Flutter" or "Message" buttons
- [ ] 🦋 Block + Report user options visible and work
- [ ] 🦋 If you Block, the user disappears from search and DMs
- [ ] ✨ Report flow has multiple reason categories (harassment, dating-app behavior, spam, other)
- [ ] ✨ Profile loads in ≤2 seconds

## 6. Direct Messages
- [ ] 🦋 Existing DM threads list loads
- [ ] 🦋 Open a thread — messages render correctly
- [ ] 🦋 Send a text message → appears immediately
- [ ] 🦋 Receive a real-time message (test with two devices / accounts)
- [ ] 🦋 Send a photo from gallery
- [ ] 🦋 Read receipts work correctly
- [ ] 🦋 Block from within a DM thread works
- [ ] 🦋 Report a message → reaches moderator queue
- [ ] ✨ Typing indicator shows when other side is typing
- [ ] ✨ Sending an empty message is disabled
- [ ] ✨ Long-press a message → Copy / Report options

## 7. Coffee Lounge (Tables)
- [ ] 🦋 Lounge list shows active tables + persistent tables (Founders Lounge, Today's Crossword)
- [ ] 🦋 "Today's Crossword ✏️" table is at the top or easy to find
- [ ] 🦋 "Create Table" button is visible (teal, top of screen)
- [ ] 🦋 Create a new table → join automatically as host
- [ ] 🦋 Join an existing table → see other seated members
- [ ] 🦋 Send a table chat message → appears in real time for everyone seated
- [ ] 🦋 Leave a table → seat freed for others
- [ ] 🦋 Founders Lounge accessible only to Founder users (gated)
- [ ] 🦋 Empty Lounge state shows a helpful message + "Create a Table" button
- [ ] ✨ Table emoji / theme picker works on Create
- [ ] ✨ Seat-count indicator updates live

## 8. Community Groups
- [ ] 🦋 Groups list loads with categories (Hobbies, Local, Faith, etc.)
- [ ] 🦋 Join a group → appears in My Groups
- [ ] 🦋 Post in a group → others see it
- [ ] 🦋 Like / comment on a group post
- [ ] 🦋 Report a post → reaches moderator queue
- [ ] 🦋 Group admin can pin / remove posts (test as admin)
- [ ] ✨ "Leave group" with confirmation works

## 9. Events / RSVPs
- [ ] 🦋 Events list shows upcoming events, sorted nearest-first
- [ ] 🦋 Tap event → full detail (venue, time, description, host, RSVPs)
- [ ] 🦋 RSVP "Going" / "Maybe" / "Not Going" works
- [ ] 🦋 Your RSVPs appear in "My Events"
- [ ] 🦋 Create new event → appears for others nearby
- [ ] 🦋 Business event heuristic: posting an event with words like "sale", "discount", "book now" triggers the "Are you a business?" gate
- [ ] 🦋 Business trial subscription (5 free events/month) flow works
- [ ] ✨ Event reminder 24h before triggers a push (when push is set up)
- [ ] ✨ Map view (if implemented) shows event location correctly

## 10. Notice Board
- [ ] 🦋 Local notice board shows community posts
- [ ] 🦋 Post a notice → visible to others in your suburb
- [ ] 🦋 Generate printable flyer (admin feature) — text supersized, butterfly + "Founding Member" ribbon
- [ ] ✨ Filter by category (Lost & Found, For Sale, Free, etc.)

## 11. Games Hub & Daily Crossword
- [ ] 🦋 Games hub shows all games (Crossword, Sudoku, Word Search, Trivia, Bingo, Jigsaw)
- [ ] 🦋 Tap Crossword → Daily card at top + 4 levels below
- [ ] 🦋 Daily Crossword loads with theme + date
- [ ] 🦋 "Discuss today's puzzle ☕" → opens Coffee Lounge table
- [ ] 🦋 Tap any cell → bright yellow highlight, pale-blue active word
- [ ] 🦋 Type letters via on-screen keyboard
- [ ] 🦋 Tap a cell twice → direction toggles (across ↔ down)
- [ ] 🦋 Previous / Next clue buttons work
- [ ] 🦋 Hint button reveals one letter
- [ ] 🦋 Clear answer wipes the current word only
- [ ] 🦋 Check marks wrong letters red
- [ ] 🦋 Solve a puzzle → win modal + Butterfly Points awarded
- [ ] 🦋 Re-solving the same puzzle does NOT re-award points
- [ ] 🦋 Progress auto-saves: close app mid-puzzle, reopen — letters restored
- [ ] 🦋 Easy, Medium, Hard, Expert level puzzles all playable
- [ ] ✨ TTS ("speaker" icon) reads the active clue aloud
- [ ] ✨ Expert puzzles feel meaningfully harder (more clues, denser grid)

## 12. Butterfly Points & Achievements
- [ ] 🦋 Points balance updates immediately after any award
- [ ] 🦋 Profile shows total Butterfly Points + recent badges
- [ ] 🦋 Milestone badges unlock at the right thresholds (100, 500, 1000, 5000 pts)
- [ ] 🦋 Milestone toast appears when crossing a threshold
- [ ] 🦋 Achievements screen lists all unlocked + locked badges with descriptions
- [ ] ✨ Tap a badge → detail modal

## 13. Founder Features
- [ ] 🦋 First 100 sign-ups (or whatever threshold) get Founder status
- [ ] 🦋 🦋 butterfly mark appears next to founder names everywhere (DMs, profiles, group posts, leaderboards)
- [ ] 🦋 Founders Wall accessible from profile or settings
- [ ] 🦋 Tap a founder on the Wall → opens their profile (no 404)
- [ ] 🦋 Founders Lounge table visible only to founders
- [ ] ✨ Welcome banner for new founders explains their perks

## 14. Accessibility
- [ ] 🦋 Text-size slider in Settings actually scales body text app-wide
- [ ] 🦋 At 1.5× scale, no text is clipped or overlapping
- [ ] 🦋 Buttons remain tappable at all scales (≥44pt)
- [ ] 🦋 VoiceOver reads every screen correctly (turn on iOS Settings → Accessibility → VoiceOver and walk a few screens)
- [ ] 🦋 Color contrast passes WCAG AA on key text (use a contrast checker on screenshots)
- [ ] 🦋 TTS "speaker" button reads aloud on Help, Crossword clues, and event descriptions
- [ ] ✨ Haptics on key actions (sending a Flutter, solving a puzzle)
- [ ] ✨ Dark mode renders correctly (if the user has system Dark Mode on)

## 15. Settings
- [ ] 🦋 Notifications toggles work (when push is set up — test placeholder for now)
- [ ] 🦋 Privacy controls: who can find me, who can message me
- [ ] 🦋 Blocked users list shows correctly, unblock works
- [ ] 🦋 Text size slider works
- [ ] 🦋 Sign out works → returns to Welcome screen
- [ ] 🦋 Privacy Policy + Terms links open the in-app pages
- [ ] 🦋 Contact email shows `support@youbelongapp.com`
- [ ] ✨ App version + build number visible at the bottom

## 16. Account Deletion (Apple-mandated)
- [ ] 🦋 Settings → red **Delete Account** row visible
- [ ] 🦋 Tap → confirmation modal "Are you sure? This action cannot be undone."
- [ ] 🦋 [Cancel] button closes modal, user remains signed in
- [ ] 🦋 [Delete Account] permanently removes account (test with a throw-away user!)
- [ ] 🦋 After deletion: user is signed out, returned to Welcome screen
- [ ] 🦋 Re-attempting sign-in with deleted email shows "Account not found"
- [ ] 🦋 Admin accounts cannot self-delete (shows polite error)

## 17. Edge Cases & Stress
- [ ] 🦋 App handles airplane mode gracefully (shows offline banner, retries)
- [ ] 🦋 Slow 3G network — no timeouts longer than 30s
- [ ] 🦋 Backgrounding mid-action (mid-typing in a clue) doesn't lose data
- [ ] 🦋 Killing the app mid-action doesn't corrupt local state
- [ ] 🦋 Rapid taps on a button don't fire the action multiple times
- [ ] 🦋 Deep link from `youbelong://invite/xyz` opens the invite page even if app is killed
- [ ] ✨ Memory usage stays under 200MB during a 15-min play session
- [ ] ✨ Battery drain is reasonable (compare to a similar messaging app)

## 18. Apple Review Concerns
- [ ] 🦋 App does NOT mention dating, romance, or partner-finding ANYWHERE in copy
- [ ] 🦋 "This is a friendship community, NOT a dating app" appears in onboarding/community guidelines
- [ ] 🦋 Block + Report visible on every user-touchpoint (DMs, profiles, group posts, events)
- [ ] 🦋 Privacy disclosures in app match what's declared in App Store Connect → App Privacy
- [ ] 🦋 No external payment links (Apple disallows them outside IAP)
- [ ] 🦋 No "crashes on first launch" — confirmed by 2 testers on different iOS versions

## 19. Sign-Off
- [ ] Tester name(s): _______________
- [ ] Date: _______________
- [ ] iOS versions tested: _______________
- [ ] Devices tested: _______________
- [ ] Critical issues found: 0 / Total
- [ ] Ready to start App Store listing prep: ☐ Yes  ☐ No (issues to fix first)
