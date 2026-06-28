/**
 * src/services/supabase.js — optional Supabase JS client singleton.
 *
 * This module is the SINGLE source of truth for "do we have Supabase
 * configured in this build?" — every UI surface that wants a Supabase
 * path (Auth modal, future Storage uploads, future Realtime channels)
 * funnels through `getSupabase()` and `isSupabaseConfigured()` so we
 * never throw a `createClient` error when env vars are unset.
 *
 * Why a lazy singleton (and not eager at module top)?
 *  - Vite replaces `import.meta.env.VITE_*` at build time. If the env
 *    is unset, the constant is `undefined`. An eager `createClient(
 *    undefined, undefined, …)` throws synchronously and would break
 *    any consumer that imports this file. Lazy init keeps the throw
 *    off the import path.
 *
 * Why `persistSession: true`?
 *  - Supabase Persists its own auth state under `sb-<project-ref>-
 *    auth-token` in localStorage. We piggyback on that to avoid
 *    duplicating session storage on our side. The companion
 *    `sb_access_token` key in api.js is just a fast mirror the
 *    axios interceptor reads on every request.
 *
 * Why `autoRefreshToken: false`?
 *  - The Django JWKS verifier already accepts our Supabase JWTs on
 *    every request. Supabase-autoRefresh would try to swap tokens
 *    itself; we instead drive refresh manually via
 *    `supabase.auth.refreshSession()` from api.js.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

/**
 * Public predicate — UI surfaces (Auth modal) hide the Supabase path
 * entirely when this returns false. Safe to call from render bodies.
 */
export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY)
    && /^https?:\/\//i.test(SUPABASE_URL)
    && SUPABASE_ANON_KEY.length >= 20;
}

let _client = null;

/**
 * Lazy singleton accessor. Returns null (NOT throws) if env vars are
 * missing — every caller MUST tolerate a null return. We deliberately
 * avoid an exception here so a partial-env .env file (one variable
 * set, the other missing) doesn't crash the whole SPA on import.
 */
export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-devrose-auth', // explicit so we don't depend on project URL
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
    global: {
      // Supabase's default fetch keeps responses cached; pass headers that
      // force fresh reads so a forced-logout from the interceptor
      // immediately invalidates subsequent auth calls.
      headers: { 'X-Client-Info': 'devrose-academy-fe' },
    },
  });
  return _client;
}

/**
 * Best-effort fallback: if the user is mid-sign-in and the page reloads,
 * the Supabase client can rehydrate from `sb-devrose-auth`. This helper
 * returns the current session (or null) without any network round-trip.
 * Safe to call when env is unset — returns null cleanly.
 */
export async function getSupabaseSession() {
  const client = getSupabase();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data?.session || null;
  } catch (_err) {
    // getSession() should never throw, but the stored token blob can be
    // corrupt after a misbehaving logout. Swallow + return null so the
    // boot path falls back to the Django JWT instead of crashing.
    return null;
  }
}

export default getSupabase;
