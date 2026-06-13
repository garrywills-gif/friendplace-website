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

  listUsers: (params: { suburb?: string; interest?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as any).toString();
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

  // safety + admin + support
  safetyReasons: () => req("/safety/report-reasons"),
  // community
  communityToday: (uid?: string) => req(`/community/today${uid ? `?user_id=${uid}` : ""}`),
  submitReport: (body: { reporter_id: string; target_user_id?: string; target_type?: string; target_id?: string; reason: string; notes?: string }) =>
    req("/reports", { method: "POST", body: JSON.stringify(body) }),
  submitSupportTicket: (body: { user_id?: string; user_email?: string; category: string; subject: string; message: string }) =>
    req("/support/tickets", { method: "POST", body: JSON.stringify(body) }),

  adminSummary: (admin_id: string) => req(`/admin/summary?admin_id=${admin_id}`),
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

  // profile / onboarding
  updateProfile: (uid: string, body: any) => req(`/users/${uid}/profile`, { method: "PATCH", body: JSON.stringify(body) }),
  updatePrivacySettings: (uid: string, body: any) => req(`/users/${uid}/privacy-settings`, { method: "PATCH", body: JSON.stringify(body) }),
  completeOnboarding: (uid: string) => req(`/users/${uid}/onboarding-complete`, { method: "POST" }),

  // unified games hub
  gamesStats: (uid: string) => req(`/games/stats/${uid}`),
  gamesDailies: () => req("/games/dailies"),
  gameCheer: (fromId: string, toId: string, kind: "well_done" | "congrats" | "coffee" | "flutter") =>
    req(`/games/cheer/${fromId}`, { method: "POST", body: JSON.stringify({ to_user_id: toId, kind }) }),

  // tables
  listTables: () => req("/tables"),
  createTable: (b: any) => req("/tables", { method: "POST", body: JSON.stringify(b) }),
  getTable: (id: string) => req(`/tables/${id}`),
  tableMessages: (id: string) => req(`/tables/${id}/messages`),
  joinTable: (id: string, uid: string) => req(`/tables/${id}/join/${uid}`, { method: "POST" }),
  leaveTable: (id: string, uid: string) => req(`/tables/${id}/leave/${uid}`, { method: "POST" }),

  // groups
  listGroups: () => req("/groups"),
  createGroup: (b: any) => req("/groups", { method: "POST", body: JSON.stringify(b) }),
  joinGroup: (gid: string, uid: string) => req(`/groups/${gid}/join/${uid}`, { method: "POST" }),
  groupPosts: (gid: string) => req(`/groups/${gid}/posts`),
  createGroupPost: (gid: string, b: any) => req(`/groups/${gid}/posts`, { method: "POST", body: JSON.stringify(b) }),
  likeGroupPost: (pid: string, uid: string) => req(`/groups/posts/${pid}/like/${uid}`, { method: "POST" }),
  commentGroupPost: (pid: string, b: any) => req(`/groups/posts/${pid}/comment`, { method: "POST", body: JSON.stringify(b) }),

  // events
  listEvents: () => req("/events"),
  rsvpEvent: (id: string, uid: string) => req(`/events/${id}/rsvp/${uid}`, { method: "POST" }),
  unrsvpEvent: (id: string, uid: string) => req(`/events/${id}/unrsvp/${uid}`, { method: "POST" }),

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
  sendFlutter: (from_id: string, to_id: string) => req("/flutters/send", { method: "POST", body: JSON.stringify({ from_id, to_id }) }),
  myFlutters: (uid: string) => req(`/flutters/${uid}`),
  markFlutterRead: (fid: string) => req(`/flutters/${fid}/read`, { method: "POST" }),
};

export function wsUrl(path: string): string {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/^http/, "ws");
  return `${base}/api${path}`;
}
