# Changelog

All notable changes to DevRose Academy are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Supabase split-URL convention (`DATABASE_URL` + `DIRECT_URL`):
  - `backend/devrose_backend/settings.py` — reads `DIRECT_URL` and,
    when the management command is `migrate` / `makemigrations` /
    `sqlmigrate`, transparently swaps `DATABASES['default']` onto it
    so PgBouncer transaction-mode (port 6543) is never asked to run
    multi-statement DDL. Strips `?pgbouncer=true` (and other
    pooler-only markers) before `dj-database-url` parses the URL so
    libpq doesn't reject them. Exposes `SUPABASE_DIRECT_URL_SET` /
    `SUPABASE_DIRECT_DB_CONFIG` / `SUPABASE_DIRECT_HOST` /
    `SUPABASE_DIRECT_PORT` for ops tooling.
  - `backend/api/management/commands/check_supabase.py` — pings
    `DIRECT_URL` as a separate `direct` component alongside the
    runtime pooler, so `manage.py check_supabase` surfaces whether
    the DDL-side connection is reachable.
  - `backend/.env.example` — both URLs in the Supabase canonical
    format (port 6543 + `?pgbouncer=true` for runtime, port 5432
    for DDL).
- Supabase Storage migration for media (avatars, covers, chat-images,
  audio):
  - `backend/api/storage_utils.py` — server-side upload helpers. Detects
    base64 vs URL, uploads via Supabase REST Storage API with stdlib
    urllib (no extra deps). Bucket layout `<uid>/<uuid4>.<ext>` (paths
    unguessable on `public=true` buckets so a folder-enumeration attack
    can't enumerate users). Per-bucket size cap enforced both client-side
    (Supabase) and server-side (Django).
  - `backend/api/views/profile.py` + `backend/api/views/chat.py` —
    `avatar` / `cover_photo` / `image` / `audio` / story image are
    routed through `ensure_url()` before save. TextField columns accept
    both base64 (legacy) and URL (new path) so HTML5 rendering works
    for both without FE changes.
  - `backend/api/migrations/0015_media_to_supabase_storage.py` — one-shot
    data migration that uploads existing base64 rows to the matching
    bucket and replaces each row with the public URL. Batches 500
    rows at a time so it doesn't OOM the Django process. Idempotent
    via `startswith('http')` predicate (re-runs are no-ops). No-op on
    SQLite / unset-env, leaving new work until Supabase Storage is
    provisioned.
  - `backend/api/management/commands/setup_supabase.py` — per-bucket
    size caps (avatars 2MB / covers 5MB / chat-images 4MB / audio 2MB)
    AND idempotent reconfigure of existing buckets whose cap drifted.
- Horizontal scale-out via Redis (channels-redis + presence ledger):
  - `backend/api/presence.py` — RedisBackend (when `REDIS_URL` set) +
    LocalMemoryBackend (DEV fallback). Replaces the four process-local
    dicts in `consumers.py` (`online_users`, `typing_users`,
    `room_connections`, `room_user_channels`). Both async (consumers)
    and sync (DRF views) surfaces share the same ledger.
  - `channels-redis>=4.2,<5.0` + `redis>=5.0,<6.0` pinned in
    `backend/requirements.txt`.
  - `CHANNEL_LAYERS` auto-selects `channels_redis.core.RedisChannelLayer`
    when `REDIS_URL` is set; falls back to `InMemoryChannelLayer`
    otherwise. Multi-worker Daphne now safe (`daphne -w 4 …`).
  - `/api/healthz/` + `manage.py check_supabase` get a `redis` component
    that surfaces channel-layer reachability.
- Concrete Supabase deployment surface:
  - `backend/SUPABASE.md` — zero→prod checklist, env-var reference, pool-mode
    table, IPv6 work-around docs, bucket layout, healthcheck contract,
    horizontal scale-out section.
  - `GET /api/healthz/` — public endpoint that probes Postgres + Redis +
    (optionally) Supabase Auth/Storage. Returns `200 ok|degraded` or `503 down`.
  - `backend/api/management/commands/check_supabase.py` — CI-gatable probe
    that verifies DB + Redis + migration drift + (optional) Rest reach.
    Exits non-zero on any failure.
  - `backend/api/management/commands/setup_supabase.py` — idempotently
    creates the four required Storage buckets (`avatars`, `covers`,
    `chat-images`, `audio`) with public-read visibility.
- `LICENSE` at repo root (MIT, Copyright (c) 2026 DevRose Academy)
- Backend proxy `backend/api/views/ai.py` exposing `POST /api/ai/generate/` for Google Gemini
- `kot3chat/` frontend module split (`constants.js`, `audioUtils.js`)
- `run_daphne.sh` launcher for Django + Channels ASGI
- `backend/requirements.txt` with version pins
- Header comments explaining design decisions across `src/App.jsx`, `src/services/api.js`, `backend/api/auth/custom.py`, `backend/api/middleware.py`, `backend/api/consumers.py`, `backend/devrose_backend/settings.py`

### Changed
- `backend/devrose_backend/settings.py` — Postgres branch now auto-detects
  pool mode from `DATABASE_URL`'s port (6543 → transaction-mode,
  5432 → session-mode, override via `DATABASE_POOL_MODE`). On
  transaction-mode we set `CONN_MAX_AGE=0`, `ATOMIC_REQUESTS=False`,
  and move `DISABLE_SERVER_SIDE_CURSORS=True` into `OPTIONS` per the
  Django docs (`https://docs.djangoproject.com/en/5.2/ref/databases/#transaction-pooling-mode`).
  Adds `SUPABASE_POOL_MODE` setting so `manage.py` / `/healthz/` can
  surface the mode without re-parsing the URL.
- `STATIC_ROOT` now configured (was missing) so `manage.py collectstatic`
  works on Render/Railway/Fly/Heroku deploys.
- `@google/generative-ai` removed from frontend deps; backend proxies Gemini now
- Gemini key moved from `VITE_GEMINI_API_KEY` to backend `GEMINI_API_KEY`
- DRF throttling added (`UserRateThrottle` at 30/min)
- README Licence section references `LICENSE` + MIT badge

### Removed
- 24 one-off dev/patch scripts (`apply_*`, `patch_*`, `fix_*`, `refactor_*`, `find_*`, `trace_*`, `diag_picker.py`, `rules.txt`, `Kot3Chat.jsx.bk-v4`)
- `kot3_dark_mode` boolean localStorage key; replaced with `kot3_active_theme` (8 themes)

### Fixed
- Gemini API-key leak risk removed
- Settings.py Django version comment updated to `Django 5.2 LTS`
- `kot3chat/constants.js` HMR sentinel `const` → `let` to avoid TypeError
- `audioUtils.js` `startCallingSounds()` now idempotent; ramp-down timer cancellation
