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
  listNotices: () => req("/notices"),
  createNotice: (b: any) => req("/notices", { method: "POST", body: JSON.stringify(b) }),
  likeNotice: (id: string, uid: string) => req(`/notices/${id}/like/${uid}`, { method: "POST" }),
  commentNotice: (id: string, b: any) => req(`/notices/${id}/comment`, { method: "POST", body: JSON.stringify(b) }),

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
