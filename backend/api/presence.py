"""
``api.presence`` -- cluster-aware presence/typing/room-connection store.

Replaces four process-local Python dicts in ``api/consumers.py``:

  * ``online_users``       -> SET per user (``presence:online:{uid}``) + a
    global SET of online user ids (``presence:online_set``) so a
    presence broadcast across workers can iterate online members.
  * ``typing_users``       -> ZSET per thread (``presence:typing:{tid}``)
    with ``score = epoch-seconds`` and ``member = uid``. Pruning is
    one ``ZREMRANGEBYSCORE`` per get, then ``ZRANGE`` for the survivors.
  * ``room_connections``   -> HASH per room (``presence:room_conn:{room}``)
    -- ``channel_name -> JSON(user_info)``.
  * ``room_user_channels`` -> HASH per room (``presence:room_user:{room}``)
    -- ``uid -> channel_name``.

TWO BACKENDS
------------
A factory in ``get_backend()`` returns either a ``RedisBackend`` (when
``REDIS_URL`` is configured) or a ``LocalMemoryBackend`` (DEV fallback
that keeps the same dict shape for tests / single-worker dev). The
choice is read once per process and memoised -- swap ``REDIS_URL`` and
restart Daphne.

ASYNC / SYNC SURFACES
---------------------
The Daphne consumer is async (Channels). DRF views are sync. To avoid
the ``async_to_sync(redis.asyncio.foo)`` deadlock pattern that surfaces
under load (event loop already entered by the WSGI/ASGI thread, async
client stalls), we expose:

  * Async facade: ``mark_online_async``, ``is_online_async``,
    ``mark_typing_async``, ``stop_typing_async``, ``get_typing_async``,
    ``room_join_async``, ``room_leave_async``, ``room_list_async``,
    ``room_count_async``, ``room_set_user_channel_async``,
    ``room_get_user_channel_async``, ``room_clear_async``.
    Callers do ``await presence.foo(...)``. Backed by
    ``redis.asyncio.Redis``.

  * Sync facade: ``is_online(uid)``, ``get_typing(thread_id)``,
    ``room_count(room)``, ``room_list(room)``. Callers do
    ``presence.foo(...)`` synchronously. Backed by ``redis.Redis``
    (NOT asyncio) with a thread-safe connection pool.

Both surfaces are wrappers over the same backend abstraction, so the
``LocalMemoryBackend`` is a single impl shared by sync + async paths.

WHY THE REDIS KEYS USE A NAMESPACE PREFIX
------------------------------------------
Every key is prefixed ``presence:`` so the backend can be flushed
independently during tests (``redis-cli DEL presence:*``). The prefix
matches no other Django / Channels key in the project.

TTL / EVICTION NOTE
-------------------
``channels-redis`` cleans up its own group keys on consumer expiry but
NOT our ``presence:*`` keys if Daphne is killed (SIGKILL, hard OOM).
To stop zombie entries we bump a 24h ``EXPIRE`` every write. A
heartbeat (``every 30s from the client -> presence.heartbeat_async``)
can shorten this further; it's documented in ``backend/SUPABASE.md``
as a TODO so a follow-up can wire it without re-architecting this
module.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# Configuration / constants (single source of truth across both faces)
# ----------------------------------------------------------------------
_KEY_PREFIX = "presence:"
# 24h TTL is bumped on every write. A shorter TTL (30-60s) needs a
# frontend heartbeat to keep an idle-but-connected user from rolling
# offline spuriously.
_DEFAULT_TTL_SECONDS = 24 * 60 * 60
# Typing entries are ZSET members; we bump this TTL too so abandoned
# typers vanish within 30 min of inactivity.
_TYPING_TTL_SECONDS = 30 * 60


# ----------------------------------------------------------------------
# Backend protocol (duck-typed, no abc to keep import cheap)
# ----------------------------------------------------------------------
class _Backend:
    """Interface implemented by both Redis and LocalMemory backends."""

    # --- presence (online_users) ---
    async def mark_online(self, uid: int, channel_name: str, username: str) -> int: ...
    async def is_online(self, uid: int) -> bool: ...
    async def mark_offline(self, uid: int, channel_name: str) -> int: ...
    async def online_user_ids(self) -> Set[int]: ...

    # --- typing ---
    async def mark_typing(self, thread_id: int, uid: int) -> None: ...
    async def stop_typing(self, thread_id: int, uid: int) -> None: ...
    async def get_typing(self, thread_id: int) -> List[int]: ...

    # --- classroom room conns ---
    async def room_join(self, room: str, channel_name: str, user_info: Dict[str, Any]) -> int: ...
    async def room_leave(self, room: str, channel_name: str) -> int: ...
    async def room_count(self, room: str) -> int: ...
    async def room_list(self, room: str) -> Dict[str, Dict[str, Any]]: ...
    async def room_set_user_channel(self, room: str, uid: int, channel_name: str) -> None: ...
    async def room_get_user_channel(self, room: str, uid: int) -> Optional[str]: ...
    async def room_clear_user_channel(self, room: str, uid: int) -> None: ...
    async def room_clear(self, room: str) -> None: ...

    # SYNC mirror (used by DRF views). The ``LocalMemoryBackend`` shares
    # state with its async surface so we don't need async here at all,
    # but ``RedisBackend`` has TWO clients (one async, one sync).
    def sync_is_online(self, uid: int) -> bool: ...
    def sync_scard_online_set(self) -> int: ...
    def sync_get_typing(self, thread_id: int) -> List[int]: ...
    def sync_room_count(self, room: str) -> int: ...
    def sync_room_list(self, room: str) -> Dict[str, Dict[str, Any]]: ...

    # --- healthcheck ---
    async def ping(self) -> bool: ...


# ----------------------------------------------------------------------
# Local-memory backend (dev / single-worker)
# ----------------------------------------------------------------------
class LocalMemoryBackend(_Backend):
    """
    In-process dict mirror of the Redis storage shape.

    Used when ``REDIS_URL`` is unset. Multi-worker Daphne MUST set
    ``REDIS_URL`` or the chat fabric will fragment -- every worker has
    its own copy of these dicts.

    The shape matches ``_Backend`` so that calls have IDENTICAL semantics
    between dev and prod. In particular, ``room_join`` returns the new
    viewer count after the join (mirrors Redis HASH ``HLEN``).
    """

    def __init__(self):
        self._lock = threading.RLock()
        # mirrors Redis SETs: presence:online:{uid} -> {channel_name, ...}
        self._online: Dict[int, Set[str]] = {}
        # mirrors Redis global SET: presence:online_set
        self._online_set: Set[int] = set()
        # mirrors presence:typing:{tid} -> {(uid, ts)}
        self._typing: Dict[int, Dict[int, float]] = {}
        # mirrors presence:room_conn:{room} -> {channel_name: user_info}
        self._room_conn: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # mirrors presence:room_user:{room} -> {uid: channel_name}
        self._room_user: Dict[str, Dict[int, str]] = {}
        # mirrors presence:online_meta:{uid} -> {channel, username}
        self._online_meta: Dict[int, Dict[str, str]] = {}

    # ---- presence ----
    async def mark_online(self, uid, channel_name, username):
        with self._lock:
            channels = self._online.setdefault(uid, set())
            channels.add(channel_name)
            self._online_set.add(uid)
            if username:
                self._online_meta[uid] = {'channel': channel_name, 'username': username}
            return len(channels)

    async def is_online(self, uid):
        with self._lock:
            return bool(self._online.get(uid))

    async def mark_offline(self, uid, channel_name):
        with self._lock:
            channels = self._online.get(uid)
            if channels and channel_name in channels:
                channels.discard(channel_name)
            remaining = len(channels or set())
            if remaining == 0:
                self._online.pop(uid, None)
                self._online_set.discard(uid)
                self._online_meta.pop(uid, None)
            return remaining

    async def online_user_ids(self):
        with self._lock:
            return set(self._online_set)

    # ---- typing ----
    async def mark_typing(self, thread_id, uid):
        with self._lock:
            self._typing.setdefault(thread_id, {})[uid] = time.time()

    async def stop_typing(self, thread_id, uid):
        with self._lock:
            d = self._typing.get(thread_id, {})
            d.pop(uid, None)
            if not d:
                self._typing.pop(thread_id, None)

    async def get_typing(self, thread_id, max_age_seconds=4):
        with self._lock:
            d = self._typing.get(thread_id, {})
            cutoff = time.time() - max_age_seconds
            survivors = {uid for uid, ts in d.items() if ts >= cutoff}
            # prune stale entries
            for uid in list(d.keys()):
                if d[uid] < cutoff:
                    del d[uid]
            if not d:
                self._typing.pop(thread_id, None)
            return list(survivors)

    # ---- room conns ----
    async def room_join(self, room, channel_name, user_info):
        with self._lock:
            d = self._room_conn.setdefault(room, {})
            d[channel_name] = user_info
            return len(d)

    async def room_leave(self, room, channel_name):
        with self._lock:
            d = self._room_conn.get(room)
            if d and channel_name in d:
                del d[channel_name]
                if not d:
                    self._room_conn.pop(room, None)
                    return 0
            return len(d or {})

    async def room_count(self, room):
        """Cheap count -- no JSON parse. Mirrors Redis HLEN."""
        with self._lock:
            return len(self._room_conn.get(room, {}))

    async def room_list(self, room):
        with self._lock:
            # return a deep copy so callers can mutate without
            # surprising concurrent writers.
            return {k: dict(v) for k, v in self._room_conn.get(room, {}).items()}

    async def room_set_user_channel(self, room, uid, channel_name):
        with self._lock:
            self._room_user.setdefault(room, {})[uid] = channel_name

    async def room_get_user_channel(self, room, uid):
        with self._lock:
            return self._room_user.get(room, {}).get(uid)

    async def room_clear_user_channel(self, room, uid):
        with self._lock:
            d = self._room_user.get(room)
            if d and uid in d:
                del d[uid]
                if not d:
                    self._room_user.pop(room, None)

    async def room_clear(self, room):
        with self._lock:
            self._room_conn.pop(room, None)
            self._room_user.pop(room, None)

    # ---- SYNC mirror (no event-loop needed; same lock) ----
    def sync_is_online(self, uid):
        with self._lock:
            return bool(self._online.get(uid))

    def sync_scard_online_set(self):
        """Return the number of users currently online (no SMEMBERS)."""
        with self._lock:
            return len(self._online_set)

    def sync_username_for(self, uid):
        with self._lock:
            meta = self._online_meta.get(uid)
            return meta.get('username') if meta else None

    def sync_get_typing(self, thread_id, max_age_seconds=4):
        with self._lock:
            d = self._typing.get(thread_id, {})
            cutoff = time.time() - max_age_seconds
            survivors = {uid for uid, ts in d.items() if ts >= cutoff}
            for uid in list(d.keys()):
                if d[uid] < cutoff:
                    del d[uid]
            if not d:
                self._typing.pop(thread_id, None)
            return list(survivors)

    def sync_room_count(self, room):
        with self._lock:
            return len(self._room_conn.get(room, {}))

    def sync_room_list(self, room):
        with self._lock:
            return {k: dict(v) for k, v in self._room_conn.get(room, {}).items()}

    # ---- healthcheck ----
    async def ping(self):
        return True


# ----------------------------------------------------------------------
# Redis backend
# ----------------------------------------------------------------------
# Lua script: atomically SREM a channel_name from a user's online SET
# and DEL the SET when the last channel closes. Avoids the
# ``SREM -> SCARD -> DEL`` race where a concurrent SADD from another
# tab races past.
#
# KEYS[1] = user's online SET (presence:online:{uid})
# KEYS[2] = global online set (presence:online_set)
# ARGV[1] = the channel_name being removed
# ARGV[2] = the uid-as-string (member of KEYS[2] to SREM if we empty out)
#
# Returns the number of channels remaining for the user (0 -> caller
# treats them as fully offline).
#
# KEYS and ARGV are separated so Redis Cluster can route the script
# by its KEYS (just 2 keys, both presence:*). ARGV[2] is a string
# member-not-key so it doesn't trip the cluster "keys must hash to
# the same slot" assertion.
_LUA_DISCONNECT_ONLINE = """
-- KEYS[1] = user's online SET (presence:online:{uid})
-- KEYS[2] = global online set (presence:online_set)
-- KEYS[3] = user meta HASH (presence:online_meta:{uid})
-- ARGV[1] = the channel_name being removed
-- ARGV[2] = the uid-as-string (member of KEYS[2] to SREM if we empty out)
local removed = redis.call('SREM', KEYS[1], ARGV[1])
local count = redis.call('SCARD', KEYS[1])
if count == 0 then
    redis.call('DEL', KEYS[1])
    redis.call('SREM', KEYS[2], ARGV[2])
    redis.call('DEL', KEYS[3])
end
return count
"""

# IMPORTANT — Redis Cluster compatibility
# ----------------------------------------
# This script passes three KEYS that share the ``presence:`` prefix but
# DO NOT share a Redis Cluster hash tag (``{tag}``). On a single-node
# Redis (the typical deploy target — Upstash, Render Redis, Fly Redis,
# small self-hosted instances) the slot check is skipped and the script
# runs as expected. On a true Redis Cluster deployment, however, the EVAL
# would fail with ``CROSSSLOT Keys in request don't hash to the same
# slot`` because the three keys hash to three different slots.
#
# Mitigation paths if you ever migrate to Redis Cluster:
#   1. Namespace every key under ``{presence}:...`` (rename ``online:{uid}``
#      to ``{presence}:online:{uid}``, ``online_set`` to
#      ``{presence}:online_set``, etc.). The hash tag forces all keys
#      into the same slot regardless of the suffix.
#   2. OR replace the multi-key EVAL with three single-key ops wrapped in
#      a ``MULTI/EXEC`` transaction. Loses atomicity (a concurrent
#      SADD could race past) but stays cluster-safe.
#
# For now, the README (and the dedicated SUPABASE.md) documents that
# ``REDIS_URL`` must point at a single-node Redis — sufficient for the
# chat-class workload this project targets.


class RedisBackend(_Backend):
    """
    Redis-backed backend using ``redis.asyncio`` for consumers and
    ``redis.Redis`` (sync pool) for DRF views.

    The async + sync clients share the same physical Redis but use
    independent connection pools so the DRF thread doesn't have to
    await an ``async_to_sync`` wrapper that may already have an event
    loop running.
    """

    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self._async = None  # built lazily in aio-friendly contexts
        self._sync = None   # built lazily in sync contexts
        self._lua_sha_disconnect: Optional[bytes] = None

    # ----- lazy client builders -------------------------------------
    def _get_async(self):
        if self._async is None:
            import redis.asyncio as aioredis
            self._async = aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
                health_check_interval=30,
                socket_timeout=5,
                socket_connect_timeout=5,
            )
        return self._async

    def _get_sync(self):
        if self._sync is None:
            import redis as redislib
            self._sync = redislib.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
                health_check_interval=30,
                socket_timeout=5,
                socket_connect_timeout=5,
            )
        return self._sync

    # ----- helpers --------------------------------------------------
    @staticmethod
    def _k_online(uid: int) -> str:
        return f"{_KEY_PREFIX}online:{uid}"

    @staticmethod
    def _k_online_set() -> str:
        return f"{_KEY_PREFIX}online_set"

    @staticmethod
    def _k_online_meta(uid: int) -> str:
        return f"{_KEY_PREFIX}online_meta:{uid}"

    @staticmethod
    def _k_typing(thread_id: int) -> str:
        return f"{_KEY_PREFIX}typing:{thread_id}"

    @staticmethod
    def _k_room_conn(room: str) -> str:
        return f"{_KEY_PREFIX}room_conn:{room}"

    @staticmethod
    def _k_room_user(room: str) -> str:
        return f"{_KEY_PREFIX}room_user:{room}"

    # ----- presence -----
    async def mark_online(self, uid, channel_name, username):
        r = self._get_async()
        key = self._k_online(uid)
        global_set = self._k_online_set()
        meta_key = self._k_online_meta(uid)
        # SADD + EXPIRE + add to global set -- not atomic by default
        # but the only loss is a momentarily stale global-set membership
        # which the next ``mark_offline`` will fix.
        await r.sadd(key, channel_name)
        await r.expire(key, _DEFAULT_TTL_SECONDS)
        await r.sadd(global_set, str(uid))
        # Persist the username in a side-channel HASH so presence
        # snapshots (and DB-less healthchecks) can show the user without
        # a JOIN against auth_user.
        if username:
            await r.hset(meta_key, mapping={'channel': channel_name, 'username': username})
            await r.expire(meta_key, _DEFAULT_TTL_SECONDS)
        return await r.scard(key)

    def sync_username_for(self, uid):
        """Sync helper used by DRF views to look up a username from Redis."""
        try:
            return self._get_sync().hget(self._k_online_meta(uid), 'username')
        except Exception:
            return None

    async def is_online(self, uid):
        r = self._get_async()
        return bool(await r.exists(self._k_online(uid)))

    async def mark_offline(self, uid, channel_name):
        r = self._get_async()
        key = self._k_online(uid)
        global_set = self._k_online_set()
        meta_key = self._k_online_meta(uid)
        # Lua makes (SREM, SCARD, DEL-on-empty, SREM-global-set, DEL-meta)
        # atomic, so a race (SREM arrives after SADD for a new tab)
        # can't transition us to ``offline`` while another tab is open.
        remaining = None
        try:
            if self._lua_sha_disconnect is None:
                self._lua_sha_disconnect = await r.script_load(_LUA_DISCONNECT_ONLINE)
            remaining = await r.evalsha(
                self._lua_sha_disconnect, 3,  # exactly 3 KEYS for cluster routing
                key, global_set, meta_key,   # KEYS[1], KEYS[2], KEYS[3]
                channel_name, str(uid),      # ARGV[1], ARGV[2]
            )
        except Exception as e:
            # NOSCRIPT after FLUSHALL -- fall back to plain SREM+SCARD
            # + DEL. Slightly less atomic but correct.
            logger.debug("redis backend lua mark_offline fallback: %s", e)
            await r.srem(key, channel_name)
            remaining = await r.scard(key)
            if remaining == 0:
                await r.delete(key)
                await r.srem(global_set, str(uid))
                await r.delete(meta_key)
        return int(remaining or 0)

    async def online_user_ids(self):
        r = self._get_async()
        members = await r.smembers(self._k_online_set())
        return {int(m) for m in members if str(m).isdigit()}

    # ----- typing -----
    async def mark_typing(self, thread_id, uid):
        r = self._get_async()
        key = self._k_typing(thread_id)
        await r.zadd(key, {str(uid): time.time()})
        await r.expire(key, _TYPING_TTL_SECONDS)

    async def stop_typing(self, thread_id, uid):
        r = self._get_async()
        await r.zrem(self._k_typing(thread_id), str(uid))

    async def get_typing(self, thread_id, max_age_seconds=4):
        r = self._get_async()
        key = self._k_typing(thread_id)
        cutoff = time.time() - max_age_seconds
        # Prune anything older than ``cutoff`` first.
        await r.zremrangebyscore(key, "-inf", cutoff)
        members = await r.zrange(key, 0, -1)
        return [int(m) for m in members if str(m).isdigit()]

    # ----- room conns -----
    async def room_join(self, room, channel_name, user_info):
        r = self._get_async()
        key = self._k_room_conn(room)
        await r.hset(key, channel_name, json.dumps(user_info))
        await r.expire(key, _DEFAULT_TTL_SECONDS)
        return await r.hlen(key)

    async def room_leave(self, room, channel_name):
        r = self._get_async()
        key = self._k_room_conn(room)
        await r.hdel(key, channel_name)
        remaining = await r.hlen(key)
        if remaining == 0:
            await r.delete(key)
            await r.delete(self._k_room_user(room))
        return remaining

    async def room_count(self, room):
        """Cheap count -- no JSON parse. Direct Redis HLEN."""
        r = self._get_async()
        return await r.hlen(self._k_room_conn(room))

    async def room_list(self, room):
        r = self._get_async()
        raw = await r.hgetall(self._k_room_conn(room))
        out = {}
        for chan, payload in raw.items():
            try:
                out[chan] = json.loads(payload)
            except (TypeError, ValueError):
                out[chan] = {"raw": payload}
        return out

    async def room_set_user_channel(self, room, uid, channel_name):
        r = self._get_async()
        await r.hset(self._k_room_user(room), str(uid), channel_name)
        await r.expire(self._k_room_user(room), _DEFAULT_TTL_SECONDS)

    async def room_get_user_channel(self, room, uid):
        r = self._get_async()
        return await r.hget(self._k_room_user(room), str(uid))

    async def room_clear_user_channel(self, room, uid):
        r = self._get_async()
        await r.hdel(self._k_room_user(room), str(uid))

    async def room_clear(self, room):
        r = self._get_async()
        await r.delete(self._k_room_conn(room))
        await r.delete(self._k_room_user(room))

    # ----- SYNC mirror (DRF views) -----
    def sync_is_online(self, uid):
        return bool(self._get_sync().exists(self._k_online(uid)))

    def sync_scard_online_set(self):
        """Cheap count of online users -- one Redis SCARD, no parse."""
        try:
            return int(self._get_sync().scard(self._k_online_set()) or 0)
        except Exception:
            return 0

    def sync_get_typing(self, thread_id, max_age_seconds=4):
        r = self._get_sync()
        key = self._k_typing(thread_id)
        cutoff = time.time() - max_age_seconds
        r.zremrangebyscore(key, "-inf", cutoff)
        members = r.zrange(key, 0, -1)
        return [int(m) for m in members if str(m).isdigit()]

    def sync_room_count(self, room):
        return self._get_sync().hlen(self._k_room_conn(room))

    def sync_room_list(self, room):
        r = self._get_sync()
        raw = r.hgetall(self._k_room_conn(room))
        return {
            chan: (json.loads(payload) if isinstance(payload, str) else payload)
            for chan, payload in raw.items()
        }

    # ----- healthcheck -----
    async def ping(self):
        return bool(await self._get_async().ping())


# ----------------------------------------------------------------------
# Backend selection (memoised per-process)
# ----------------------------------------------------------------------
_BACKEND: Optional[_Backend] = None
_BACKEND_LOCK = threading.Lock()


def _redis_url() -> Optional[str]:
    return os.environ.get("REDIS_URL", "").strip() or None


def get_backend() -> _Backend:
    """
    Return the singleton backend for this process.

    Two workers with two different process-local singletons both point
    at the SAME Redis URL -- they read/write shared state in Redis, so
    horizontal scale-out is safe.
    """
    global _BACKEND
    if _BACKEND is not None:
        return _BACKEND
    with _BACKEND_LOCK:
        if _BACKEND is not None:
            return _BACKEND
        url = _redis_url()
        if url:
            _BACKEND = RedisBackend(url)
            logger.info("presence backend: redis (%s)", _redact(url))
        else:
            _BACKEND = LocalMemoryBackend()
            logger.info("presence backend: local memory (REDIS_URL unset)")
        return _BACKEND


def _redact(url: str) -> str:
    """Strip the password from a Redis URL for safe logging."""
    if "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        return f"{scheme}://{user}:***@{host}"
    return f"{scheme}://***@{host}"


def is_redis() -> bool:
    """Convenience for /healthz -- True iff the chosen backend is Redis."""
    return _redis_url() is not None


# ----------------------------------------------------------------------
# Public facade -- async (consumers)
# ----------------------------------------------------------------------
async def mark_online_async(uid: int, channel_name: str, username: str) -> int:
    return await get_backend().mark_online(uid, channel_name, username)


async def is_online_async(uid: int) -> bool:
    return await get_backend().is_online(uid)


async def mark_offline_async(uid: int, channel_name: str) -> int:
    """
    Returns the remaining channel count for ``uid``. ``0`` means the
    user is fully offline -- callers should follow up with a presence
    broadcast.
    """
    return await get_backend().mark_offline(uid, channel_name)


async def online_user_ids_async() -> Set[int]:
    return await get_backend().online_user_ids()


async def mark_typing_async(thread_id: int, uid: int) -> None:
    await get_backend().mark_typing(thread_id, uid)


async def stop_typing_async(thread_id: int, uid: int) -> None:
    await get_backend().stop_typing(thread_id, uid)


async def get_typing_async(thread_id: int, max_age_seconds: int = 4) -> List[int]:
    return await get_backend().get_typing(thread_id, max_age_seconds=max_age_seconds)


async def room_join_async(room: str, channel_name: str, user_info: Dict[str, Any]) -> int:
    return await get_backend().room_join(room, channel_name, user_info)


async def room_leave_async(room: str, channel_name: str) -> int:
    return await get_backend().room_leave(room, channel_name)


async def room_list_async(room: str) -> Dict[str, Dict[str, Any]]:
    return await get_backend().room_list(room)


async def room_count_async(room: str) -> int:
    """
    Hot-path viewer-count broadcast. Goes straight to Redis ``HLEN``
    (one round-trip, zero parse) instead of ``HGETALL + len``.
    """
    return await get_backend().room_count(room)


async def room_set_user_channel_async(room: str, uid: int, channel_name: str) -> None:
    await get_backend().room_set_user_channel(room, uid, channel_name)


async def room_get_user_channel_async(room: str, uid: int) -> Optional[str]:
    return await get_backend().room_get_user_channel(room, uid)


async def room_clear_user_channel_async(room: str, uid: int) -> None:
    await get_backend().room_clear_user_channel(room, uid)


async def room_clear_async(room: str) -> None:
    await get_backend().room_clear(room)


async def ping_async() -> bool:
    return await get_backend().ping()


# ----------------------------------------------------------------------
# Public facade -- sync (DRF views -- views/chat.py)
# ----------------------------------------------------------------------
def is_online(uid: int) -> bool:
    """Sync-side helper for DRF views. SAFE in non-async contexts."""
    return get_backend().sync_is_online(uid)


def count_online() -> int:
    """
    Return the total number of users currently online (DRF-side / sync).

    The dashboard's "Online users" card calls this once per 30s refresh.
    For Redis we use ``SCARD`` on the global online-set (O(1)) instead of
    iterating ``SMEMBERS`` and counting client-side — the SCARD round-trip
    is one packet and never deserializes members. For the local-memory
    backend we read ``len(self._online_set)`` under the same RLock that
    guards writes, so a torn read is impossible.

    Failures (e.g. Redis briefly unreachable) are swallowed and return
    ``-1`` so callers can render a "—" placeholder instead of a 500.
    """
    try:
        backend = get_backend()
        # ``LocalMemoryBackend`` exposes the set directly via
        # ``_online_set``; ``RedisBackend`` exposes ``sync_scard_online_set``
        # so we don't have to add a new method on each backend class.
        if hasattr(backend, 'sync_scard_online_set'):
            return int(backend.sync_scard_online_set() or 0)
        # Fallback: if the backend doesn't expose the fast SCARD, return -1
        # (rendered as "—" on the FE) rather than allocating a Python set.
        return -1
    except Exception:  # pragma: no cover - defensive
        logger.warning("presence.count_online lookup failed")
        return -1


def get_typing(thread_id: int, max_age_seconds: int = 4) -> List[int]:
    return get_backend().sync_get_typing(thread_id, max_age_seconds=max_age_seconds)


def room_count(room: str) -> int:
    return get_backend().sync_room_count(room)


def room_list(room: str) -> Dict[str, Dict[str, Any]]:
    return get_backend().sync_room_list(room)


def username_for(uid: int) -> Optional[str]:
    """
    Sync-side helper: return the cached username for an online user.

    Returns ``None`` if the user has never been online through this
    pipeline, if the entry has expired (24h TTL), or if the chosen
    backend does not expose ``sync_username_for`` (defensive default).

    Wrapped in ``try/except`` so a transient backend init failure (e.g.
    a Redis connection error mid-bootstrap) surfaces as ``None`` to the
    DRF caller rather than propagating a 500 through ``views/chat.py``.
    """
    try:
        backend = get_backend()
        getter = getattr(backend, 'sync_username_for', None)
        if getter is None:
            return None
        return getter(uid)
    except Exception:  # pragma: no cover - defensive
        logger.warning("presence.username_for lookup failed for uid=%s", uid)
        return None
