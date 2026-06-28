import axios from 'axios';
import { getSupabase } from './supabase';

// Default to same-origin `/api/` so local Vite proxy still works.
// Set `VITE_API_BASE_URL` for deployed/mobile clients that cannot reach
// `localhost` on the developer machine.
const API_URL = import.meta.env.VITE_API_BASE_URL || '/api/';

/**
 * JWT-aware axios client.
 *
 * Token model
 * -----------
 * We store two tokens in localStorage:
 *   * `access_token`  — short-lived (15 min), sent on every API request
 *   * `refresh_token` — long-lived (7 days), used to mint a fresh access
 *
 * The interceptor below sends `Authorization: Bearer <access>` on every
 * request. If the server replies 401, we transparently POST to
 * `/api/refresh/` (using the current refresh), update both tokens, and replay
 * the failed request exactly once. This keeps the user logged in for the
 * full 7-day refresh window without interrupting their work.
 *
 * On `access_token` refresh failure we drop BOTH tokens and emit a
 * `devrose:auth:logout` event so other components (e.g. Header avatar) can
 * react without polling localStorage.
 *
 * JWT wirings & rotation rationale
 * --------------------------------
 * Why we DON'T read the token from a React context: axios interceptors run
 * OUTSIDE React's render lifecycle. A context-based scheme would force
 * re-registering the interceptor on every user state change — and many
 * in-flight requests would race the re-registration, shipping stale auth
 * headers. localStorage is sync, fast, persistent across reloads, and only
 * updated exactly when login/logout happen — the perfect simple contract
 * for outbound HTTP auth.
 */
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 30s default timeout. Without this, a hung request (proxy drop,
  // server mid-body reset, slow mobile uplink on a 4MB+ base64 body)
  // surfaces as an indefinite spinner and the user has no idea
  // whether to wait or retry. With it, axios rejects with a
  // timeout error → ``err.response`` is undefined → the avatar /
  // cover catch handlers show "Cannot reach server" with a 30s
  // upper bound, not a hang. Per-request overrides still work
  // (e.g. ``api.patch(url, data, { timeout: 60_000 })``).
  timeout: 30000,
});

// Tracks whether a refresh call is already in flight, so a burst of 401s
// only triggers one network round-trip instead of N concurrent refreshes.
let inflightRefresh = null;

// Defaults to 'session_expired' so callers never have to think — the
// only place that explicitly sets 'user' is Settings.jsx when the user
// hits the Logout button themselves (which goes through ``handleLogout``,
// NOT ``broadcastLogout``). Everything else that fires this event is doing
// so in response to a server-side token invalidation (refresh+401 cycle in
// the interceptor below, or a session revoke from another tab). The
// reason travels to the App.jsx listener via CustomEvent.detail so the
// user sees a "Session expired. Please log in again." toast instead of the
// silent drop.
//
// Exported so App.jsx can broadcast from its Supabase ``onAuthStateChange``
// listener — see that handler for the suppression flag that keeps a
// user-initiated logout from firing a second "Session expired" toast
// when Supabase's SIGNED_OUT event fires in response to our own
// ``sb.auth.signOut()`` call.
export function broadcastLogout(reason = 'session_expired') {
  try { window.dispatchEvent(new CustomEvent('devrose:auth:logout', { detail: { reason } })); } catch (_) {}
}

// localStorage keys — kept in one place so admin / logout / migration
// paths don't disagree on spelling. `sb_*` is filled when the user signed
// in via Supabase JS (see Auth.jsx → supabase mode); the Django path
// keeps using `access_token` / `refresh_token` as before.
const LS_KEYS = Object.freeze({
  access: 'access_token',
  refresh: 'refresh_token',
  user: 'user',
  sbAccess: 'sb_access_token',
  sbRefresh: 'sb_refresh_token',
  sbUserMeta: 'sb_user_meta',
  legacyToken: 'token',
});

/**
 * Read the bearer token to send on the next request, prioritizing a
 * Supabase-issued JWT over a Django-issued one. The backend's
 * ``JwtOnlyAuthentication`` validates BOTH shapes against the same
 * ``Authorization`` header (Supabase JWTs go via JWKS; Django JWTs
 * go via the simplejwt signer), so a single header is fine.
 */
function pickAuthHeader() {
  const sbAccess = localStorage.getItem(LS_KEYS.sbAccess);
  if (sbAccess) return sbAccess;
  return localStorage.getItem(LS_KEYS.access);
}

api.interceptors.request.use((config) => {
  const token = pickAuthHeader();
  if (token) {
    // We send the canonical `Authorization: Bearer` header AND the legacy
    // `X-Authorization` header for the migration window. The new server
    // auth class accepts either (see api/auth/custom.py).
    config.headers['Authorization'] = `Bearer ${token}`;
    config.headers['X-Authorization'] = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const refresh = localStorage.getItem('refresh_token');

    // Skip refresh for login/refresh/logout endpoints to avoid infinite loops.
    const skipRefresh =
      original?.url?.includes('/login/') ||
      original?.url?.includes('/logout/') ||
      original?.url?.includes('/refresh/') ||
      original?.url?.includes('/password/');

    if (status === 401 && refresh && !skipRefresh && !original._retry) {
      // Skip Django /api/refresh/ when the active session is a Supabase
      // one — the Django refresh endpoint can only rotate Django refresh
      // tokens. Instead we call supabase.auth.refreshSession(), mirror
      // the new pair back into localStorage, and replay the original
      // request exactly once (same contract as the Django path below).
      const carryingSupabase = Boolean(localStorage.getItem(LS_KEYS.sbAccess));
      if (carryingSupabase) {
        original._retry = true;
        try {
          const fresh = await refreshSupabaseSession();
          if (fresh) {
            original.headers = original.headers || {};
            original.headers['Authorization'] = `Bearer ${fresh}`;
            original.headers['X-Authorization'] = `Bearer ${fresh}`;
            return api(original);
          }
          // Refresh failed → session is dead. Wipe + broadcast so App.jsx
          // bounces back to the login screen instead of looping 401s.
          // (Broadcast MUST be called *after* clearTokenPair — see the
          // note on that helper.)
          clearTokenPair();
          broadcastLogout();
          return Promise.reject(error);
        } catch (_sbRefreshErr) {
          clearTokenPair();
          broadcastLogout();
          return Promise.reject(_sbRefreshErr);
        }
      }
      original._retry = true;
      try {
        inflightRefresh = inflightRefresh || axios.post(`${API_URL}refresh/`, { refresh });
        const { data } = await inflightRefresh;
        inflightRefresh = null;
        if (data?.access) {
          localStorage.setItem('access_token', data.access);
          if (data?.refresh) localStorage.setItem('refresh_token', data.refresh);
        }
        // Replay the original request with the new access token.
        original.headers = original.headers || {};
        original.headers['Authorization'] = `Bearer ${data.access}`;
        original.headers['X-Authorization'] = `Bearer ${data.access}`;
        return api(original);
      } catch (refreshErr) {
        inflightRefresh = null;
        // Refresh failed → session is dead. Wipe local copies and notify.
        clearTokenPair();
        broadcastLogout();
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);

export const courseService = {
  getAll: () => api.get('courses/'),
  getById: (id) => api.get(`courses/${id}/`),
};

/**
 * Auth surface — JWT only.
 *
 *   login:                 POST /api/login/                       → {access, refresh, user}
 *   signup:                POST /api/signup/                      → {access, refresh, user}
 *   logout:                POST /api/logout/                      → blacklists the supplied refresh
 *   refresh:               POST /api/refresh/                     → rotates refresh + new access
 *   forgotPassword:        POST /api/password/forgot/             → dev-mode reset token
 *   resetPasswordConfirm:  POST /api/password/reset/confirm/      → consumes token, sets pw
 *   changePassword:        POST /api/password/change/             → {current_password, new_password}
 *   sendEmailVerification: POST /api/email/verify/send/           → dev-mode verify JWT
 *   confirmEmailVerification: POST /api/email/verify/confirm/     → {token}
 *   deleteAccount:         DELETE /api/account/delete/             → {confirmation: "DELETE"}
 *   getMe:                 GET  /api/me/                          → current user + profile
 *
 * Helper: `applyTokenPair({access, refresh, user})` writes both tokens and
 * the user blob to localStorage in one go so callers can stay declarative.
 */
export function applyTokenPair({ access, refresh, user }) {
  if (access) localStorage.setItem('access_token', access);
  if (refresh) localStorage.setItem('refresh_token', refresh);
  if (user) localStorage.setItem('user', JSON.stringify(user));
}

/**
 * Internal: which localStorage keys are auth-related. Exported for tests.
 */
export const AUTH_LOCALSTORAGE_KEYS = LS_KEYS;

export function clearTokenPair() {
  // Drop EVERYTHING auth-related so a sign-out from a Supabase session
  // doesn't leave a Django JWT stranded in localStorage (and vice versa).
  //
  // Note: this helper intentionally does NOT broadcast the
  // ``devrose:auth:logout`` event. ``broadcastLogout()`` triggers
  // App.jsx's ``onForcedLogout`` listener which calls
  // ``handleLogout`` → which itself calls ``clearTokenPair``. Calling
  // ``broadcastLogout()`` from inside this helper would create an
  // infinite loop (clear → broadcast → listener → clear → …). Each
  // caller that wants to notify the rest of the app should call
  // ``broadcastLogout(reason)`` AFTER invoking this helper — the
  // interceptor and the explicit user-Logout button do exactly that.
  Object.values(LS_KEYS).forEach((k) => {
    try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
  });
}

/**
 * Persist a Supabase-derived session so the axios interceptor (which
 * reads `sb_access_token`) ships the JWT on every subsequent request.
 *
 * IMPORTANT: this helper writes ONLY the sb-token keys + raw user
 * metadata. It deliberately DOES NOT write the `user` slot — that
 * slot must always hold the canonical Django UserSerializer shape,
 * which is populated by `/api/me/`. Writing a half-formed sb `user`
 * object here would corrupt a subsequent /api/me/ hydration on the
 * next page reload.
 *
 * `userMeta` is the raw `session.user.user_metadata` payload, used
 * by Header avatar rendering. Optional.
 */
export function applySupabaseSession({ access_token, refresh_token, userMeta }) {
  if (!access_token) return;
  try {
    localStorage.setItem(LS_KEYS.sbAccess, access_token);
    if (refresh_token) localStorage.setItem(LS_KEYS.sbRefresh, refresh_token);
    if (userMeta) {
      try { localStorage.setItem(LS_KEYS.sbUserMeta, JSON.stringify(userMeta)); } catch (_) {}
    }
  } catch (_) {
    // localStorage quota / disabled-private-mode — surface in console only;
    // we don't want to block sign-in on it.
    // eslint-disable-next-line no-console
    console.warn('applySupabaseSession: localStorage write failed', _);
  }
}

/**
 * Drop ONLY the Supabase session keys (we keep any Django pair intact).
 * Use this when the user wants to switch identity providers without
 * killing the underlying Django session.
 */
export function clearSupabaseSessionOnly() {
  [LS_KEYS.sbAccess, LS_KEYS.sbRefresh, LS_KEYS.sbUserMeta].forEach((k) => {
    try { localStorage.removeItem(k); } catch (_) {}
  });
}

/**
 * Try to refresh the active Supabase session and mirror the new token
 * pair (only the sb_* keys + userMeta — never the `user` blob) back
 * into localStorage. Called from a 401-aware caller; returns the new
 * access token (or null on failure).
 */
export async function refreshSupabaseSession() {
  const client = getSupabase();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.refreshSession();
    if (error || !data?.session) return null;
    applySupabaseSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      userMeta: data.session.user?.user_metadata,
    });
    return data.session.access_token;
  } catch (_err) {
    return null;
  }
}

/**
 * Helper used by App.jsx on boot: "is the current auth state coming from
 * Supabase?" — true when the `sb_access_token` slot is non-empty. The
 * caller can then keep showing the no-refresh / no-/api/refresh/ banner.
 */
export function isSupabaseSessionActive() {
  try { return Boolean(localStorage.getItem(LS_KEYS.sbAccess)); } catch (_) { return false; }
}

export const authService = {
  login: (credentials) => api.post('login/', credentials),
  signup: (userData) => api.post('signup/', userData),
  logout: (refresh) => api.post('logout/', { refresh }),
  refresh: (refresh) => api.post('refresh/', { refresh }),
  getMe: () => api.get('me/'),
  forgotPassword: (email) => api.post('password/forgot/', { email }),
  // Note: dev-mode endpoint returns the token in the response. In prod we'd
  // email a link and never see the token client-side.
  resetPasswordConfirm: (token, new_password) =>
    api.post('password/reset/confirm/', { token, new_password }),
  // Requires the user to be authenticated. Re-verifies the current
  // password on the server so a stolen JWT can't silently rotate it.
  changePassword: ({ current_password, new_password }) =>
    api.post('password/change/', { current_password, new_password }),
  // Dev-mode: returns dev_verify_token + dev_verify_url so the FE can
  // drive an end-to-end UI without SMTP. The FE presents a "paste the
  // token here" input so the dev can simulate clicking an emailed link.
  sendEmailVerification: () => api.post('email/verify/send/', {}),
  confirmEmailVerification: (token) =>
    api.post('email/verify/confirm/', { token }),
  deleteAccount: () => api.delete('account/delete/', { data: { confirmation: 'DELETE' } }),
};

export const progressService = {
  getAll: () => api.get('progress/'),
  update: (id, data) => api.patch(`progress/${id}/`, data),
  create: (data) => api.post('progress/', data),
};

export const enrollmentService = {
  getAll: () => api.get('enrollments/'),
  create: (courseId) => api.post('enrollments/', { course: courseId }),
};

export const favoriteService = {
  getAll: () => api.get('favorites/'),
  create: (courseId) => api.post('favorites/', { course: courseId }),
  remove: (courseId) => api.delete(`favorites/0/?course_id=${courseId}`),
};

export const profileService = {
  // Current user's full profile (UserSerializer shape including date_joined, email_verified).
  getMe: () => api.get('profile/me/'),
  // Update current user's profile + optional `username`. Supports all
  // 0012 fields: cover_photo, interests, social_links, notification_prefs, country.
  updateMe: (data, config) => api.patch('profile/me/', data, config),
  // Fetch another user's public profile (PROFILE module scope: read-only,
  // privacy-aware redaction when scoping == 'private').
  getById: (userId) => api.get(`profile/${userId}/`),
  // ISO-3166 catalog for the country dropdown (cached client-side).
  getCountries: () => api.get('profile/countries/'),
};

export const blocksService = {
  list: () => api.get('blocks/'),
  add: (userId, reason = '') => api.post('blocks/', { user_id: userId, reason }),
  remove: (id) => api.delete(`blocks/${id}/`),
};

export const mutesService = {
  list: () => api.get('mutes/'),
  add: (userId, mute_until = null) => api.post('mutes/', { user_id: userId, mute_until }),
  remove: (id) => api.delete(`mutes/${id}/`),
};

export const sessionService = {
  get: () => api.get('session/me/'),
  update: (data) => api.patch('session/me/', data),
};

export const chatService = {
  getThreads: () => api.get('chat/threads/'),
  createThread: (userId) => api.post('chat/threads/', { user_id: userId }),
  getMessages: (threadId) => api.get(`chat/threads/${threadId}/messages/`),
  sendMessage: (threadId, data) => api.post(`chat/threads/${threadId}/send_message/`, data),
  markRead: (threadId, messageIds) => api.post(`chat/threads/${threadId}/mark_read/`, { message_ids: messageIds }),
  getUsers: () => api.get('chat/users/'),
  searchGlobal: (q) => api.get(`chat/search/global_search/?q=${encodeURIComponent(q)}`),
  publishStory: (data) => api.post('chat/stories/', data),
  getStories: () => api.get('chat/stories/'),
};

export const liveRoomService = {
  getRecent: () => api.get('live/rooms/'),
  getMine: () => api.get('live/rooms/mine/'),
  getActive: () => api.get('live/rooms/active/'),
  restore: (data) => api.post('live/rooms/restore/', data),
  resolve: (data) => api.post('live/rooms/resolve/', data),
  sync: (data) => api.post('live/rooms/sync/', data),
  updateState: (roomId, data) => api.patch(`live/rooms/${encodeURIComponent(roomId)}/state/`, data),
};

// AI proxy: backend holds the Gemini API key, frontend just forwards prompts.
// See backend/api/views/ai.py for the server-side endpoint.
export const aiService = {
  generate: ({ prompt, system_instruction, model } = {}) =>
    api.post('ai/generate/', { prompt, system_instruction, model }),
};

export default api;
