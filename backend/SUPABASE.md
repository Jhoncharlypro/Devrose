# DevRose Academy — Concrete Supabase Deployment Guide

This document describes the **concrete steps** to bring the DevRose
backend up on Supabase. It is the operator-side complement to the
run-time autodetection in `backend/devrose_backend/settings.py`.

## TL;DR

```bash
# 1. Create a Supabase project + database at https://supabase.com/dashboard
# 2. Copy the connection string into .env at the repo root
cp backend/.env.example .env
#    ... edit DATABASE_URL with the Supabase Transaction-mode (port 6543) URL
#    ... export SUPABASE_URL + SUPABASE_SERVICE_KEY if you'll use Storage

# 3. Apply migrations. Use the DIRECT connection (port 5432) so Django
#    gets full DDL access — see "Migrations: which pooler?" below.
DATABASE_URL='postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:5432/postgres' \
    python backend/manage.py migrate

# 4. Probe connectivity.
python backend/manage.py check_supabase

# 5. Provision Storage buckets (idempotent).
python backend/manage.py setup_supabase

# 6. Run the server.
python backend/manage.py runserver  # dev
#    or
daphne -b 0.0.0.0 -p 8000 devrose_backend.asgi:application  # prod (HTTP + WS)
```

## Requirements

| Tool   | Version | Note                                   |
| ------ | ------- | -------------------------------------- |
| Python | 3.12+   |                                        |
| Django | 5.2+    | locked in `requirements.txt`           |
| Daphne | 4.1+    | for WebSocket fanout                   |
| psycopg2-binary | 2.9+ | Postgres driver                    |
| dj-database-url | 3.1+ | URL parser                         |

`pip install -r backend/requirements.txt` once per environment.

## Environment variables

| Name                    | Where to find it                                          | Required? | Default |
| ----------------------- | --------------------------------------------------------- | --------- | ------- |
| `DATABASE_URL`          | Supabase → Project Settings → Database → Connection string | **Yes** (for prod) | unset → falls back to SQLite |
| `DJANGO_SECRET_KEY`     | `python -c "import secrets; print(secrets.token_urlsafe(50))"` | **Yes** (for prod) | dev key + loud warning |
| `DJANGO_ALLOWED_HOSTS`  | your domain(s), comma-separated                           | **Yes** (for prod) | `['*']` on SQLite |
| `DJANGO_DEBUG`          | `0` prod, `1` dev                                         | No, defaults | `0` once Supabase is configured |
| `SUPABASE_URL`          | Project Settings → API → Project URL                     | Only for Storage / Auth REST | unset |
| `SUPABASE_SERVICE_KEY`  | Project Settings → API → service_role (secret)            | Only for Storage / Auth REST | unset |
| `DATABASE_POOL_MODE`    | `transaction` or `session`                               | No (auto-sniffed by port) | auto |
| `REDIS_URL`             | (TODO) Redis URL for horizontal scaling                   | No (InMemoryChannelLayer is the dev default) | unset |

`.env` lives at the **repo root**, NOT inside `backend/`. `settings.py`
detects both automatically (see `_load_dotenv(BASE_DIR.parent / '.env')`).

## Migrations: which pooler?

Django migrations run DDL (`ALTER TABLE`, `CREATE INDEX`,
`ADD CONSTRAINT`) and **must** happen against a connection that
supports multi-statement transactions. PgBouncer Transaction-mode
(port **6543**) breaks Django migrations because each statement opens
a new transaction implicitly in the client, not the server, and
`BEGIN`/`COMMIT` can't span them.

### Option A — split-URL convention (recommended)

Set both env vars in `.env`:

```bash
DATABASE_URL=postgresql://postgres.[REF]:[PASSWORD]@aws-1-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[REF]:[PASSWORD]@aws-1-[REGION].pooler.supabase.com:5432/postgres
```

`settings.py` detects `migrate`/`makemigrations`/`sqlmigrate` in
`sys.argv` and transparently swaps `DATABASES['default']` to use
`DIRECT_URL` for the duration of the DDL run. After migrate exits,
all subsequent commands (`runserver`, `daphne`, `shell`, the WSGI
process) reconnect to the pooler (`DATABASE_URL`) automatically.

The `?pgbouncer=true` flag is consumed by the Supabase *pooler*
middleware, not libpq — `settings.py` strips it before
`dj_database_url` parses the URL so libpq never sees it (libpq
would otherwise reject with **invalid connection option 'pgbouncer'**).

```bash
# Works on .env with both URL set:
python backend/manage.py migrate            # → uses DIRECT_URL
python backend/manage.py makemigrations     # → uses DIRECT_URL
python backend/manage.py runserver          # → uses DATABASE_URL
```

### Option B — manual swap (legacy)

If you only have `DATABASE_URL`, briefly flip its port to `5432`
for the duration of `manage.py migrate`, then revert:

```bash
MIGRATE_URL="${DATABASE_URL/6543/5432}"
DATABASE_URL="$MIGRATE_URL" python backend/manage.py migrate --noinput
DATABASE_URL="$DATABASE_URL" python backend/manage.py runserver
```

`python manage.py check_supabase` will tell you when applied
migrations drift from local model state (it runs
`makemigrations --dry-run --check` and exits 2 when there's drift),
AND it now pings `DIRECT_URL` as a separate `direct` component so you
can see at a glance whether the DDL path is reachable.

## Pool mode auto-detection

`settings.py` reads `DATABASE_URL`'s port and chooses:

- **Port 6543** → Transaction-mode → `CONN_MAX_AGE=0`,
  `ATOMIC_REQUESTS=False`, `DISABLE_SERVER_SIDE_CURSORS=True`.
- **Port 5432** (or anything besides 6543) → Session-mode →
  `CONN_MAX_AGE=60`, `ATOMIC_REQUESTS=True`,
  `DISABLE_SERVER_SIDE_CURSORS=True`.
- Override with `DATABASE_POOL_MODE=transaction|session` if your
  provider uses an unusual port.

The chosen mode is exposed as `settings.SUPABASE_POOL_MODE` and
echoed in `GET /api/healthz/` so you can confirm at runtime.

## IPv4 vs IPv6

Supabase free-tier **Direct connection (port 5432)** publishes AAAA-only
DNS records on the public DNS. IPv4-only container hosts will see
`EADDRNOTAVAIL` ("Cannot assign requested address"). `settings.py` does
an `AF_INET` `getaddrinfo` lookup at startup and replays the resolved
IPv4 address into `DATABASES['HOST']` so libpq never has to walk the
AAAA records. If the AF_INET lookup itself fails (AAAA-only host), it
emits a `v4_record_missing` warning that tells the operator to switch
to the **pooler (port 6543)** which is dual-stack.

## Storage buckets

`manage.py setup_supabase` creates, idempotently:

| Bucket       | Visibility | Used for                  | Per-file cap |
| ------------ | ---------- | ------------------------- | ------------ |
| `avatars`    | Public     | Profile + group photos    | 2 MB         |
| `covers`     | Public     | Cover banner (`cover_photo`) | 5 MB     |
| `chat-images`| Public     | Chat image attachments    | 4 MB         |
| `audio`      | Public     | Voice notes               | 2 MB         |

Each per-file cap is enforced BOTH server-side (Supabase rejects
oversized uploads at the gateway) AND in Django
(`api/storage_utils._SIZE_CAPS_BYTES` + `ProfileSerializer` /
`MessageSerializer`). Belt + braces. If you need bigger files (e.g.
long-form audio), edit `backend/api/storage_utils.py` AND
`backend/api/management/commands/setup_supabase.py` together — the
two are the single source of truth. Re-running `setup_supabase` is
idempotent and **re-sizes** an existing bucket if the cap drifted.

## Healthcheck / uptime probes

```bash
curl -fsS https://api.example.com/api/healthz/ | jq
```

Returns:

- `200 {"status":"ok","components":{"db":"ok","rest":"ok","pool_mode":"transaction"}}`
- `200 {"status":"degraded","components":{"db":"ok","rest":"down","pool_mode":"transaction"}}`
- `503 {"status":"down","components":{"db":"down","pool_mode":"transaction"}}`

Neither version of Postgres nor the connection string is leaked in
the response.

## Where is the data?

Migration 0011 → 0014 already created the Supabase tables:

- `auth_*`                     — Django built-in (User, Group, Permission).
- `api_profile`                — Profile (with cover_photo, interests,
  social_links, notification_prefs, country, email_verified,
  profile_visibility, last_seen_visibility).
- `api_blockeduser`            — Block / unblock log.
- `api_muteduser`              — Mute / unmute log.
- `api_chatthread`             — Chat threads (M2M participants).
- `api_message`                — Messages (forwarded_from,
  forward_sender_name included).
- `api_messagereaction`        — One row per (user, message, emoji).
  Unique constraint `unique_usr_msg_emoji` keeps toggling idempotent.
- `api_userstory`              — User stories (24-hour window).
- `api_liveroom`               — Live classroom metadata.
- `api_course` / `api_enrollment` / `api_progress` / `api_session`
  / `api_favorite`             — Course domain.

Cross-table references: `models.Index(fields=['message','-created_at'])`
on MessageReaction (index name `react_msg_created_idx`) — works on
Postgres 15+. `UniqueConstraint(fields=('message','user','emoji'),
name='unique_usr_msg_emoji')` is also PG-native.

## Media (avatars, covers, chat-images, audio)

`api/storage_utils.ensure_url(user, kind, value)` runs at the moment a
view persists the row:

  * If `value` is already an `http(s)://` URL, it's saved as-is.
  * If `value` is base64 (DataURL or raw), it's uploaded to the bucket
    for `kind` (`avatars` / `covers` / `chat-images` / `audio`) via
    `POST /storage/v1/object/{bucket}/{uid}/{uuid4}.{ext}` and the
    public URL replaces the column.
  * If Supabase env isn't configured, base64 is kept in DB (dev path).
  * If the upload fails (timeout, network), we keep the base64 in DB
    and log a warning — the user never loses their media mid-flight.

`TextField` columns (Profile.avatar, Profile.cover_photo, Message.image,
Message.audio, UserStory.content for image stories) accept both base64
AND URLs because HTML5 `<img src=...>` and `<audio src=...>` natively
support both. No schema change required.

### Migrating existing base64 rows to Storage

After deploying the storage-migration code:

```bash
# 1. Connect with envs in place (Supabase URL + service key).
export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...

# 2. Migrate legacy rows. Idempotent: rows whose value already starts
#    with http(s):// are skipped. Re-runs are no-ops.
DATABASE_URL='postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:5432/postgres' \
    python backend/manage.py migrate
```

Migration `0015_media_to_supabase_storage` batches 500 rows at a time
so a dataset of any size won't OOM the Django process. Each batch logs
`uploaded / kept base64 / already URL` counts so you can confirm progress.

If `SUPABASE_URL` is unset (dev / first deploy before Storage is
configured), the migration is a no-op — rows remain base64-in-DB until
the operator provisions Supabase Storage and re-runs `migrate`.

## Known limitations of this setup

1. `CORS_ALLOW_ALL_ORIGINS = True` — fine for local dev, **restrict
   to your domain(s) in production**. Add a `CORS_ALLOWED_ORIGINS`
   comma-separated env var once `settings.py` is hardened.

## Horizontal scale-out (Redis)

`backend/api/presence.py` is a Redis-backed layer for everything that
used to be process-local in `consumers.py`:

  * `online_users`     → SET per user (`presence:online:{uid}`)
  * `online_user_ids`  → global SET (`presence:online_set`)
  * `typing_users`     → ZSET per thread (`presence:typing:{tid}`,
                         score = epoch-seconds, member = uid)
  * `room_connections` → HASH per room (`presence:room_conn:{room}`,
                         field = channel_name, value = JSON)
  * `room_user_channels` → HASH per room (`presence:room_user:{room}`,
                            field = uid, value = channel_name)

`CHANNEL_LAYERS` auto-selects:

  * `REDIS_URL` set     → `channels_redis.core.RedisChannelLayer`
                          + `RedisBackend` for the presence ledger
  * `REDIS_URL` unset   → `channels.layers.InMemoryChannelLayer`
                          + `LocalMemoryBackend` (DEV / single-worker)

To scale Daphne beyond 1 worker:

```bash
# Render Redis (free tier available) or use Upstash:
export REDIS_URL='redis://default:[pw]@[host].upstash.io:6379/0'

# Daphne accepts ``-w N`` for ``N`` workers; with REDIS_URL set they
# all share the same chat fabric.
daphne -b 0.0.0.0 -p 8000 -w 4 devrose_backend.asgi:application
```

Without Redis, ``-w`` must be 1 (else presence + typing fragment across
workers). The ``/api/healthz/`` endpoint pages ``redis: ok|down`` so
uptime monitors can alert when the channel layer drops out.

TTL: every ``presence:*`` key is bumped to a 24-hour expiry on each
write. ``presence:typing:*`` uses a tighter 30-minute TTL so abandoned
typing indicators vanish within a session lifetime. To shorten this
further (e.g. 120s) wire a frontend heartbeat (``shared.ts`` / ws ping
every 30s) that calls a future ``presence.heartbeat_async(uid)`` —
that hook is a single Redis ``EXPIRE`` and is documented as a TODO
inside ``backend/api/presence.py``.
