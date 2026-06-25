const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  signup: (b: any) => req("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (username: string, password: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  demoLogin: (username: string) =>
    req("/auth/demo-login", { method: "POST", body: JSON.stringify({ username }) }),
  googleAuth: (session_id: string, referrer_id?: string | null) =>
    req("/auth/google", { method: "POST", body: JSON.stringify({ session_id, referrer_id: referrer_id || null }) }),
  appleAuth: (identity_token: string, first_name?: string | null, last_name?: string | null, referrer_id?: string | null) =>
    req("/auth/apple", {
      method: "POST",
      body: JSON.stringify({
        identity_token,
        first_name: first_name || null,
        last_name: last_name || null,
        referrer_id: referrer_id || null,
      }),
    }),
  demoAccounts: () => req("/auth/demo-accounts"),
  forgot: (identifier: string) =>
    req("/auth/forgot-password", { method: "POST", body: JSON.stringify({ identifier }) }),
  reset: (identifier: string, code: string, new_password: string) =>
    req("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ identifier, code, new_password }),
    }),
  me: (token: string) =>
    req("/auth/me", { headers: { Authorization: `Bearer ${token}` } }),
  // User-initiated account deletion. Requires a Bearer token. Server purges
  // the user + their content; on success the client must clear local
  // session and route back to the welcome screen.
  deleteAccount: (token: string, reason?: string) =>
    req("/users/me", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: reason || null }),
    }),

  // Pre-launch programmes
  founderStatus: () => req("/founders/status"),
  founders: (params?: { limit?: number; skip?: number }) => {
    const q = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}` : "";
    return req(`/founders${q}`);
  },
  /** Opt-in: promote the signed-in user to a Founding Member. Requires
   *  Bearer token. Returns `{ founder_number, user }` on success. */
  claimFounder: (token: string) =>
    req("/founders/claim", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  joinWaitlist: (body: { email: string; name?: string; suburb?: string; source?: string; note?: string; referrer_id?: string | null }) =>
    req("/waitlist", { method: "POST", body: JSON.stringify(body) }),
  waitlistStats: () => req("/waitlist/stats"),

  listUsers: (params: { suburb?: string; interest?: string; q?: string; viewer_id?: string; near_lat?: number; near_lng?: number; radius_km?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as any).toString();
    return req(`/users${qs ? `?${qs}` : ""}`);
  },
  getUser: (id: string) => req(`/users/${id}`),
  blockUser: (uid: string, other: string) => req(`/users/${uid}/block/${other}`, { method: "POST" }),
  unblockUser: (uid: string, other: string) => req(`/users/${uid}/unblock/${other}`, { method: "POST" }),
  reportUser: (uid: string, other: string, reason = "") =>
    req(`/users/${uid}/report/${other}?reason=${encodeURIComponent(reason)}`, { method: "POST" }),

  // friend
  sendFriendReq: (from_id: string, to_id: string) =>
    req("/friends/request", { method: "POST", body: JSON.stringify({ from_id, to_id }) }),
  myRequests: (uid: string) => req(`/friends/requests/${uid}`),
  friendsInbox: (uid: string) => req(`/friends/inbox/${uid}`),
  acceptReq: (rid: string) => req(`/friends/accept/${rid}`, { method: "POST" }),
  declineReq: (rid: string) => req(`/friends/decline/${rid}`, { method: "POST" }),
  cancelReq: (rid: string) => req(`/friends/cancel/${rid}`, { method: "POST" }),
  removeFriend: (uid: string, fid: string) => req(`/friends/${uid}/${fid}`, { method: "DELETE" }),

  // notifications
  notifications: (uid: string, unreadOnly = false) => req(`/notifications/${uid}${unreadOnly ? "?unread_only=true" : ""}`),
  notificationCount: (uid: string) => req(`/notifications/${uid}/count`),
  readNotification: (id: string) => req(`/notifications/${id}/read`, { method: "POST" }),
  readAllNotifications: (uid: string) => req(`/notifications/${uid}/read-all`, { method: "POST" }),

  // presence & privacy
  heartbeat: (uid: string) => req(`/users/${uid}/heartbeat`, { method: "POST" }),
  userStatus: (uid: string) => req(`/users/${uid}/status`),
  statusOptions: () => req(`/status-options`),
  setStatus: (uid: string, status: string | null) =>
    req(`/users/${uid}/status`, { method: "POST", body: JSON.stringify({ status }) }),

  // suburbs / location
  suburbsSearch: (q: string, limit = 10) => req(`/suburbs/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  suburbsNearest: (lat: number, lng: number) => req(`/suburbs/nearest?lat=${lat}&lng=${lng}`),
  setLocation: (uid: string, body: { suburb?: string; postcode?: string; state?: string; lat?: number; lng?: number; prefer_not_to_say?: boolean }) =>
    req(`/users/${uid}/location`, { method: "POST", body: JSON.stringify(body) }),
  setPrivacy: (uid: string, privacy: "everyone" | "friends" | "invisible") =>
    req(`/users/${uid}/privacy`, { method: "PATCH", body: JSON.stringify({ privacy }) }),

  // jigsaw
  jigsawCatalog: () => req("/games/jigsaw/catalog"),
  jigsawDaily: () => req("/games/jigsaw/daily"),
  jigsawProgress: (uid: string) => req(`/games/jigsaw/progress/${uid}`),
  jigsawProgressOne: (uid: string, pid: string, diff: string) => req(`/games/jigsaw/progress/${uid}/${pid}/${diff}`),
  jigsawSaveProgress: (uid: string, body: { puzzle_id: string; difficulty: string; order: number[]; percent: number; completed: boolean }) =>
    req(`/games/jigsaw/progress/${uid}`, { method: "PUT", body: JSON.stringify(body) }),
  jigsawCompleted: (uid: string) => req(`/games/jigsaw/completed/${uid}`),
  jigsawStats: (uid: string) => req(`/games/jigsaw/stats/${uid}`),
  jigsawRandom: () => req("/games/jigsaw/random"),

  // trivia
  triviaCatalog: () => req("/games/trivia/catalog"),
  triviaDaily: () => req("/games/trivia/daily"),
  triviaStart: (uid: string, body: { category?: string; difficulty: string; daily?: boolean }) =>
    req(`/games/trivia/session/${uid}`, { method: "POST", body: JSON.stringify(body) }),
  triviaGetSession: (uid: string, sid: string) => req(`/games/trivia/session/${uid}/${sid}`),
  triviaAnswer: (uid: string, sid: string, body: { qid: string; picked: number; lifelines?: any; advance?: boolean }) =>
    req(`/games/trivia/session/${uid}/${sid}/answer`, { method: "POST", body: JSON.stringify(body) }),
  triviaComplete: (uid: string, sid: string) =>
    req(`/games/trivia/session/${uid}/${sid}/complete`, { method: "POST" }),
  triviaSessions: (uid: string) => req(`/games/trivia/sessions/${uid}`),
  triviaStats: (uid: string) => req(`/games/trivia/stats/${uid}`),

  // bingo
  bingoCatalog: () => req("/games/bingo/catalog"),
  bingoDaily: () => req("/games/bingo/daily"),
  bingoCommunityEvents: () => req("/games/bingo/community-events"),
  bingoLeaderboard: (eid: string) => req(`/games/bingo/community-events/${eid}/leaderboard`),
  bingoStart: (uid: string, body: { difficulty: string; daily?: boolean; event_id?: string }) =>
    req(`/games/bingo/session/${uid}`, { method: "POST", body: JSON.stringify(body) }),
  bingoGetSession: (uid: string, sid: string) => req(`/games/bingo/session/${uid}/${sid}`),
  bingoUpdate: (uid: string, sid: string, body: { call_index?: number; marked?: any }) =>
    req(`/games/bingo/session/${uid}/${sid}`, { method: "PUT", body: JSON.stringify(body) }),
  bingoComplete: (uid: string, sid: string) =>
    req(`/games/bingo/session/${uid}/${sid}/complete`, { method: "POST" }),
  bingoSessions: (uid: string) => req(`/games/bingo/sessions/${uid}`),
  bingoStats: (uid: string) => req(`/games/bingo/stats/${uid}`),

  // word search
  wsCatalog: () => req("/games/wordsearch/catalog"),
  wsPuzzle: (theme: string, difficulty: string, seed?: number) =>
    req(`/games/wordsearch/puzzle?theme=${encodeURIComponent(theme)}&difficulty=${encodeURIComponent(difficulty)}${seed !== undefined ? `&seed=${seed}` : ""}`),
  wsDaily: () => req("/games/wordsearch/daily"),
  wsGetProgress: (uid: string, puzzle_id: string) =>
    req(`/games/wordsearch/progress/${uid}?puzzle_id=${encodeURIComponent(puzzle_id)}`),
  wsSaveProgress: (uid: string, body: { puzzle_id: string; theme: string; difficulty: string; found_words: string[]; hints_used: number; seconds: number; completed: boolean; is_daily?: boolean }) =>
    req(`/games/wordsearch/progress/${uid}`, { method: "POST", body: JSON.stringify(body) }),

  // memory match
  mmCatalog: () => req("/games/memory/catalog"),
  mmPuzzle: (theme: string, difficulty: string, seed?: number) =>
    req(`/games/memory/puzzle?theme=${encodeURIComponent(theme)}&difficulty=${encodeURIComponent(difficulty)}${seed !== undefined ? `&seed=${seed}` : ""}`),
  mmDaily: () => req("/games/memory/daily"),
  mmGetProgress: (uid: string, puzzle_id: string) =>
    req(`/games/memory/progress/${uid}?puzzle_id=${encodeURIComponent(puzzle_id)}`),
  mmSaveProgress: (uid: string, body: { puzzle_id: string; theme: string; difficulty: string; matched_pairs: string[]; moves: number; seconds: number; completed: boolean; is_daily?: boolean }) =>
    req(`/games/memory/progress/${uid}`, { method: "POST", body: JSON.stringify(body) }),

  // sudoku
  sdCatalog: () => req("/games/sudoku/catalog"),
  sdPuzzle: (difficulty: string, seed?: number) =>
    req(`/games/sudoku/puzzle?difficulty=${encodeURIComponent(difficulty)}${seed !== undefined ? `&seed=${seed}` : ""}`),
  sdDaily: () => req("/games/sudoku/daily"),
  sdCheck: (difficulty: string, seed: number, row: number, col: number, value: number) =>
    req(`/games/sudoku/check?difficulty=${encodeURIComponent(difficulty)}&seed=${seed}&row=${row}&col=${col}&value=${value}`),
  sdHint: (difficulty: string, seed: number, row: number, col: number) =>
    req(`/games/sudoku/hint?difficulty=${encodeURIComponent(difficulty)}&seed=${seed}&row=${row}&col=${col}`),
  sdGetProgress: (uid: string, puzzle_id: string) =>
    req(`/games/sudoku/progress/${uid}?puzzle_id=${encodeURIComponent(puzzle_id)}`),
  sdSaveProgress: (uid: string, body: { puzzle_id: string; difficulty: string; entries: number[][]; notes: number[][][]; hints_used: number; mistakes: number; seconds: number; completed: boolean; is_daily?: boolean }) =>
    req(`/games/sudoku/progress/${uid}`, { method: "POST", body: JSON.stringify(body) }),

  // crossword
  xwLevels: () => req("/games/crossword/levels"),
  xwActive: (level: string) => req(`/games/crossword/active/${encodeURIComponent(level)}`),
  xwPuzzle: (puzzle_id: string) => req(`/games/crossword/${encodeURIComponent(puzzle_id)}`),
  xwDaily: () => req("/games/crossword/daily"),
  xwCheck: (puzzle_id: string, guesses: (string | null)[][], user_id?: string) =>
    req(`/games/crossword/${encodeURIComponent(puzzle_id)}/check`, {
      method: "POST",
      body: JSON.stringify({ guesses, user_id: user_id || null }),
    }),
  xwReveal: (puzzle_id: string, row: number, col: number) =>
    req(`/games/crossword/${encodeURIComponent(puzzle_id)}/reveal/${row}/${col}`),
  xwGetProgress: (uid: string, puzzle_id: string) =>
    req(`/games/crossword/progress/${uid}?puzzle_id=${encodeURIComponent(puzzle_id)}`),
  xwSaveProgress: (uid: string, body: { puzzle_id: string; guesses: (string | null)[][]; revealed: boolean[][]; seconds: number; completed: boolean }) =>
    req(`/games/crossword/progress/${uid}`, { method: "POST", body: JSON.stringify(body) }),

  // spot the difference
  stdCatalog: () => req("/games/spot/catalog"),
  // Invitation analytics + admin flyer (Share YouBelong follow-ons)
  inviteStats: (user_id: string) => req(`/users/${user_id}/invite-stats`),
  inviter: (user_id: string) => req(`/users/${user_id}/inviter`),
  inviteFlyerUrl: (admin_id: string, venue: string, url: string) =>
    `${BASE}/api/admin/invite-flyer?admin_id=${encodeURIComponent(admin_id)}&venue=${encodeURIComponent(venue)}&url=${encodeURIComponent(url)}`,
  stdPuzzle: (theme: string, difficulty: string, seed?: number) =>
    req(`/games/spot/puzzle?theme=${encodeURIComponent(theme)}&difficulty=${encodeURIComponent(difficulty)}${seed !== undefined ? `&seed=${seed}` : ""}`),
  stdDaily: () => req("/games/spot/daily"),
  stdLibrary: () => req("/games/spot/library"),
  stdLibraryPuzzle: (puzzle_id: string, seed?: number) =>
    req(`/games/spot/library/${encodeURIComponent(puzzle_id)}${seed !== undefined ? `?seed=${seed}` : ""}`),
  stdGetProgress: (uid: string, puzzle_id: string) =>
    req(`/games/spot/progress/${uid}?puzzle_id=${encodeURIComponent(puzzle_id)}`),
  stdSaveProgress: (uid: string, body: { puzzle_id: string; theme: string; difficulty: string; found_ids: string[]; hints_used: number; seconds: number; completed: boolean; is_daily?: boolean; beat_the_clock?: boolean }) =>
    req(`/games/spot/progress/${uid}`, { method: "POST", body: JSON.stringify(body) }),
  stdBests: (uid: string) => req(`/games/spot/bests/${uid}`),

  // safety + admin + support
  safetyReasons: () => req("/safety/report-reasons"),
  // community
  communityToday: (uid?: string) => req(`/community/today${uid ? `?user_id=${uid}` : ""}`),
  submitReport: (body: { reporter_id: string; target_user_id?: string; target_type?: string; target_id?: string; reason: string; notes?: string }) =>
    req("/reports", { method: "POST", body: JSON.stringify(body) }),
  submitSupportTicket: (body: { user_id?: string; user_email?: string; category: string; subject: string; message: string }) =>
    req("/support/tickets", { method: "POST", body: JSON.stringify(body) }),

  adminSummary: (admin_id: string) => req(`/admin/summary?admin_id=${admin_id}`),
  adminPolicy: () => req(`/admin/policy`),
  adminRepeatOffenders: (admin_id: string, min_reporters = 2, days = 30) =>
    req(`/admin/repeat-offenders?admin_id=${admin_id}&min_reporters=${min_reporters}&days=${days}`),
  adminClearRestriction: (admin_id: string, target_user_id: string, clear_flag = true, notes = "") =>
    req(`/admin/users/clear-restriction`, { method: "POST", body: JSON.stringify({ admin_id, target_user_id, clear_flag, notes }) }),
  adminReports: (admin_id: string, status = "all") => req(`/admin/reports?admin_id=${admin_id}&status=${status}`),
  adminReport: (id: string, admin_id: string) => req(`/admin/reports/${id}?admin_id=${admin_id}`),
  adminSetReportStatus: (id: string, status: string, body: { admin_id: string; note?: string }) =>
    req(`/admin/reports/${id}/status?status=${status}`, { method: "POST", body: JSON.stringify(body) }),
  adminWarn: (body: { admin_id: string; user_id: string; reason?: string; report_id?: string }) =>
    req(`/admin/users/warn`, { method: "POST", body: JSON.stringify(body) }),
  adminSuspend: (body: { admin_id: string; user_id: string; reason?: string; duration_hours?: number; report_id?: string }) =>
    req(`/admin/users/suspend`, { method: "POST", body: JSON.stringify(body) }),
  adminBan: (body: { admin_id: string; user_id: string; reason?: string; report_id?: string }) =>
    req(`/admin/users/ban`, { method: "POST", body: JSON.stringify(body) }),
  adminRestore: (body: { admin_id: string; user_id: string }) =>
    req(`/admin/users/restore`, { method: "POST", body: JSON.stringify(body) }),
  adminRemoveContent: (body: { admin_id: string; target_type: string; target_id: string; reason?: string; report_id?: string }) =>
    req(`/admin/content/remove`, { method: "POST", body: JSON.stringify(body) }),
  adminTickets: (admin_id: string, status = "all") => req(`/admin/support/tickets?admin_id=${admin_id}&status=${status}`),
  adminResolveTicket: (id: string, body: { admin_id: string; note?: string }) =>
    req(`/admin/support/tickets/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  adminUserModeration: (user_id: string, admin_id: string) =>
    req(`/admin/users/${user_id}/moderation?admin_id=${admin_id}`),
  adminAddUserNote: (user_id: string, body: { admin_id: string; note: string }) =>
    req(`/admin/users/${user_id}/notes`, { method: "POST", body: JSON.stringify(body) }),
  adminListAdmins: (admin_id: string) => req(`/admin/admins?admin_id=${admin_id}`),
  adminSearchUsers: (admin_id: string, q: string, limit = 25) =>
    req(`/admin/users/search?admin_id=${admin_id}&q=${encodeURIComponent(q)}&limit=${limit}`),
  adminSetAdminFlag: (body: { admin_id: string; target_user_id: string; make_admin: boolean; reason?: string }) =>
    req(`/admin/users/admin-flag`, { method: "POST", body: JSON.stringify(body) }),
  sendChatAlert: (body: { user_id: string; audience: "friends" | "nearby" | "selected"; recipient_ids?: string[]; radius_km?: number; message?: string }) =>
    req(`/community/chat-alert`, { method: "POST", body: JSON.stringify(body) }),
  updatePreferences: (user_id: string, body: { read_messages_aloud?: boolean; text_scale?: number; high_contrast?: boolean; large_text?: boolean; nearby_chat_alerts?: boolean }) =>
    req(`/users/${user_id}/preferences`, { method: "PATCH", body: JSON.stringify(body) }),

  // profile / onboarding
  updateProfile: (uid: string, body: any) => req(`/users/${uid}/profile`, { method: "PATCH", body: JSON.stringify(body) }),
  /** Change the signed-in user's password. Requires the current
   *  password as a confirmation step (defence against session theft). */
  changePassword: (token: string, uid: string, current_password: string, new_password: string) =>
    req(`/users/${uid}/password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password, new_password }),
    }),
  updatePrivacySettings: (uid: string, body: any) => req(`/users/${uid}/privacy-settings`, { method: "PATCH", body: JSON.stringify(body) }),
  completeOnboarding: (uid: string) => req(`/users/${uid}/onboarding-complete`, { method: "POST" }),

  // Onboarding wizard (data-collection — interests, suburb, photo, groups)
  onboardingSuggestedGroups: (uid: string) =>
    req(`/onboarding/suggested-groups?user_id=${encodeURIComponent(uid)}`),
  onboardingFinish: (body: {
    user_id: string;
    interests?: string[];
    suburb?: string;
    suburb_postcode?: string;
    suburb_state?: string;
    location_visibility?: "suburb" | "private";
    avatar?: string;
    group_ids?: string[];
    joined_all?: boolean;
  }) => req("/onboarding/complete", { method: "POST", body: JSON.stringify(body) }),

  // unified games hub
  gamesStats: (uid: string) => req(`/games/stats/${uid}`),
  gamesDailies: () => req("/games/dailies"),
  gameCheer: (fromId: string, toId: string, kind: "well_done" | "congrats" | "coffee" | "flutter") =>
    req(`/games/cheer/${fromId}`, { method: "POST", body: JSON.stringify({ to_user_id: toId, kind }) }),

  // tables
  listTables: (user_id?: string) => req(user_id ? `/tables?user_id=${encodeURIComponent(user_id)}` : "/tables"),
  createTable: (b: any) => req("/tables", { method: "POST", body: JSON.stringify(b) }),
  getTable: (id: string) => req(`/tables/${id}`),
  tableMessages: (id: string) => req(`/tables/${id}/messages`),
  joinTable: (id: string, uid: string) => req(`/tables/${id}/join/${uid}`, { method: "POST" }),
  leaveTable: (id: string, uid: string) => req(`/tables/${id}/leave/${uid}`, { method: "POST" }),

  // groups
  listGroups: () => req("/groups"),
  /** User-submitted group suggestion. Awaits admin approval before
   *  appearing in the public listing. */
  suggestGroup: (token: string, body: { name: string; emoji?: string; description?: string; reason?: string }) =>
    req("/groups/suggest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  /** Admin only — list groups waiting on approval. */
  adminPendingGroups: (token: string) =>
    req("/admin/groups/pending", { headers: { Authorization: `Bearer ${token}` } }),
  adminApproveGroup: (token: string, gid: string) =>
    req(`/admin/groups/${gid}/approve`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  adminRejectGroup: (token: string, gid: string, reason?: string) =>
    req(`/admin/groups/${gid}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: reason || "" }),
    }),
  createGroup: (b: any) => req("/groups", { method: "POST", body: JSON.stringify(b) }),
  joinGroup: (gid: string, uid: string) => req(`/groups/${gid}/join/${uid}`, { method: "POST" }),
  groupPosts: (gid: string) => req(`/groups/${gid}/posts`),
  createGroupPost: (gid: string, b: any) => req(`/groups/${gid}/posts`, { method: "POST", body: JSON.stringify(b) }),
  likeGroupPost: (pid: string, uid: string) => req(`/groups/posts/${pid}/like/${uid}`, { method: "POST" }),
  commentGroupPost: (pid: string, b: any) => req(`/groups/posts/${pid}/comment`, { method: "POST", body: JSON.stringify(b) }),

  // events
  listEvents: () => req("/events"),
  rsvpEvent: (id: string, uid: string, response: "going" | "maybe" | "cant" = "going") =>
    req(`/events/${id}/rsvp/${uid}`, { method: "POST", body: JSON.stringify({ response }) }),
  unrsvpEvent: (id: string, uid: string) => req(`/events/${id}/unrsvp/${uid}`, { method: "POST" }),
  createEvent: (body: { title: string; emoji?: string; description?: string; location?: string; date?: string; time?: string; capacity?: number | null; host_id?: string; recurrence?: "weekly" | "fortnightly" | "monthly" | null; recurrence_count?: number | null }) =>
    req(`/events`, { method: "POST", body: JSON.stringify(body) }),
  // Business-event heuristic preflight — called before createEvent so we
  // can surface the friendly "this looks like a business event" modal.
  eventPreflight: (body: { title: string; description?: string; location?: string; host_id?: string }) =>
    req(`/events/preflight`, { method: "POST", body: JSON.stringify(body) }),
  // User self-identifies as a business / venue. Stores business_name and
  // unlocks the "Sponsored by …" footer + free-listing perk path.
  claimBusiness: (token: string, business_name: string) =>
    req(`/users/me/business`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ business_name }),
    }),
  updateEvent: (id: string, body: { actor_id: string; title?: string; emoji?: string; description?: string; location?: string; date?: string; time?: string; capacity?: number | null; notify_changes?: boolean }) =>
    req(`/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  cancelEvent: (id: string, body: { actor_id: string; reason?: string }) =>
    req(`/events/${id}/cancel`, { method: "POST", body: JSON.stringify(body) }),
  restoreEvent: (id: string, body: { actor_id: string; reason?: string }) =>
    req(`/events/${id}/restore`, { method: "POST", body: JSON.stringify(body) }),
  adminHardDeleteEvent: (id: string, admin_id: string, reason?: string) =>
    req(`/admin/events/${id}?admin_id=${admin_id}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`, { method: "DELETE" }),
  adminListEvents: (admin_id: string, status: "all" | "active" | "cancelled" | "archived" = "all") =>
    req(`/admin/events?admin_id=${admin_id}&status=${status}`),
  adminArchiveEvent: (id: string, admin_id: string, reason?: string) =>
    req(`/admin/events/${id}/archive`, { method: "POST", body: JSON.stringify({ admin_id, reason }) }),
  adminUnarchiveEvent: (id: string, admin_id: string) =>
    req(`/admin/events/${id}/unarchive`, { method: "POST", body: JSON.stringify({ admin_id }) }),
  adminHardDeleteNotice: (id: string, admin_id: string, reason?: string) =>
    req(`/admin/notices/${id}?admin_id=${admin_id}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`, { method: "DELETE" }),
  adminHardDeleteUser: (user_id: string, admin_id: string, reason?: string) =>
    req(`/admin/users/${user_id}?admin_id=${admin_id}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`, { method: "DELETE" }),

  // notices
  listNotices: (opts: { user_id?: string; q?: string; category?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.user_id) params.set("user_id", opts.user_id);
    if (opts.q) params.set("q", opts.q);
    if (opts.category && opts.category !== "All") params.set("category", opts.category);
    const qs = params.toString();
    return req(`/notices${qs ? `?${qs}` : ""}`);
  },
  createNotice: (b: any) => req("/notices", { method: "POST", body: JSON.stringify(b) }),
  editNotice: (id: string, payload: any) => req(`/notices/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteNotice: (id: string, user_id: string) => req(`/notices/${id}?user_id=${user_id}`, { method: "DELETE" }),
  reactNotice: (id: string, user_id: string, kind: string) =>
    req(`/notices/${id}/react/${user_id}`, { method: "POST", body: JSON.stringify({ kind }) }),
  likeNotice: (id: string, uid: string) => req(`/notices/${id}/like/${uid}`, { method: "POST" }),
  commentNotice: (id: string, b: any) => req(`/notices/${id}/comment`, { method: "POST", body: JSON.stringify(b) }),
  replyNoticeComment: (id: string, comment_id: string, b: any) =>
    req(`/notices/${id}/comment/${comment_id}/reply`, { method: "POST", body: JSON.stringify(b) }),
  solveNotice: (id: string, user_id: string, solved: boolean) =>
    req(`/notices/${id}/solve/${user_id}`, { method: "POST", body: JSON.stringify({ solved }) }),
  reportNotice: (id: string, user_id: string, reason: string) =>
    req(`/notices/${id}/report/${user_id}`, { method: "POST", body: JSON.stringify({ reason }) }),

  // dm
  myConversations: (uid: string) => req(`/dm/${uid}/conversations`),
  startDm: (uid: string, other: string) => req("/dm/start", { method: "POST", body: JSON.stringify({ user_id: uid, other_id: other }) }),
  dmMessages: (cid: string) => req(`/dm/${cid}/messages`),

  // flutter
  sendFlutter: (body: { from_id: string; to_id: string; message?: string }) =>
    req("/flutters/send", { method: "POST", body: JSON.stringify(body) }),
  myFlutters: (uid: string) => req(`/flutters/${uid}`),
  markFlutterRead: (fid: string) => req(`/flutters/${fid}/read`, { method: "POST" }),

  // recipes
  listRecipes: (viewer_id?: string, q?: string) =>
    req(`/recipes?${viewer_id ? `viewer_id=${viewer_id}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  getRecipe: (id: string, viewer_id?: string) =>
    req(`/recipes/${id}${viewer_id ? `?viewer_id=${viewer_id}` : ""}`),
  createRecipe: (body: { user_id: string; title: string; ingredients?: string; instructions?: string; tips?: string; photo?: string }) =>
    req(`/recipes`, { method: "POST", body: JSON.stringify(body) }),
  updateRecipe: (id: string, body: any) =>
    req(`/recipes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRecipe: (id: string, user_id: string) =>
    req(`/recipes/${id}?user_id=${user_id}`, { method: "DELETE" }),
  addRecipeComment: (id: string, user_id: string, body: string) =>
    req(`/recipes/${id}/comments`, { method: "POST", body: JSON.stringify({ user_id, body }) }),
  deleteRecipeComment: (id: string, cid: string, user_id: string) =>
    req(`/recipes/${id}/comments/${cid}?user_id=${user_id}`, { method: "DELETE" }),
  toggleRecipeLike: (id: string, user_id: string) =>
    req(`/recipes/${id}/like`, { method: "POST", body: JSON.stringify({ user_id }) }),
};

export function wsUrl(path: string): string {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/^http/, "ws");
  return `${base}/api${path}`;
}
