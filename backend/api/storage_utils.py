"""
``backend/api/storage_utils`` -- server-side Supabase Storage helpers.

Used by:
  * ``api/views/profile.py``   -- when ``Profile.avatar`` or
    ``Profile.cover_photo`` is a base64 string, upload to the matching
    bucket and replace with the public URL before saving.
  * ``api/views/chat.py``      -- when ``Message.image`` or
    ``Message.audio`` is a base64 string, upload to the matching
    bucket and store the public URL.
  * ``migrations/0015``        -- same logic for legacy rows, batched
    so we don't OOM the Django process during the historical sweep.

Why stdlib urllib + NOT django-storages / boto3:
  Supabase Storage's S3-compatible endpoint requires S3-specific access
  keys (the ``s3-access-key`` machinery, distinct from the ``service_role``
  JWT). This project ships only ``SUPABASE_SERVICE_KEY`` -- using that
  with the REST ``/storage/v1/object/{bucket}/{path}`` endpoint keeps
  dependencies flat (no boto3 install, no django-storages config). The
  same flag values already exist for ``setup_supabase`` so we share one
  env contract.
"""
from __future__ import annotations

import base64
import binascii
import logging
import os
import re
import uuid
from dataclasses import dataclass
from typing import Optional, Tuple
from urllib import request as _urlrequest
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
# Bucket + size + MIME configuration (must agree with setup_supabase.py)
# ----------------------------------------------------------------------
_BUCKET_FOR_KIND = {
    "avatar": "avatars",
    "cover":  "covers",
    "image":  "chat-images",
    "audio":  "audio",
}
# Soft caps. ``setup_supabase.py`` aligns these at the bucket layer so
# Supabase rejects oversize uploads too -- belt + braces.
_SIZE_CAPS_BYTES = {
    "avatar": 2 * 1024 * 1024,    # 2 MB
    "cover":  5 * 1024 * 1024,    # 5 MB
    "image":  4 * 1024 * 1024,    # 4 MB
    "audio":  2 * 1024 * 1024,    # 2 MB (voice notes)
}
_MIME_TO_EXT = {
    "image/png":              "png",
    "image/jpeg":             "jpg",
    "image/jpg":              "jpg",
    "image/webp":             "webp",
    "image/gif":              "gif",
    "audio/webm":             "webm",
    "audio/ogg":              "ogg",
    "audio/mpeg":             "mp3",
    "audio/mp4":              "m4a",
    "audio/wav":              "wav",
    "audio/x-wav":            "wav",
}


# ----------------------------------------------------------------------
# Classification helpers
# ----------------------------------------------------------------------
def classify(value) -> str:
    """Return ('empty' | 'url' | 'base64')."""
    if not value:
        return "empty"
    s = value.strip() if isinstance(value, str) else ""
    if not s:
        return "empty"
    if s.startswith(("http://", "https://")):
        return "url"
    if s.startswith("data:"):
        return "base64"
    # Strip stray whitespace and check if the remainder parses as base64.
    compact = re.sub(r"\s+", "", s)
    if len(compact) >= 8 and re.fullmatch(r"[A-Za-z0-9+/=]+", compact):
        return "base64"
    return "empty"


def extract_data_url(data_url: str) -> Tuple[Optional[str], Optional[bytes], str]:
    """Parse ``data:<mime>(;base64)?,<payload>``.

    Returns ``(mime, raw_bytes, raw_payload_str)``. ``raw_bytes`` is
    ``None`` when the input is raw base64 (no ``data:`` prefix). Raises
    ``ValueError`` on malformed payload.
    """
    if not data_url or not isinstance(data_url, str):
        raise ValueError("not a string")
    if not data_url.startswith("data:"):
        return None, None, data_url
    head, _, payload = data_url.partition(",")
    mime_match = re.match(r"data:([^;]+)", head, re.I)
    mime = (mime_match.group(1).strip().lower() if mime_match else None)
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64 payload: {exc}") from None
    return mime, raw, payload


def _decode_base64(value: str) -> Tuple[Optional[str], bytes]:
    """Best-effort decode of *either* a ``data:`` URL or a raw base64 string."""
    mime = None
    raw: Optional[bytes] = None
    try:
        mime, raw, _ = extract_data_url(value)
    except ValueError:
        # Treat as raw base64.
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", value), validate=True)
        except (binascii.Error, ValueError):
            return None, b""
    if raw is None:
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", value), validate=True)
        except (binascii.Error, ValueError):
            return None, b""
    return mime, raw


def _ext_for(mime: Optional[str]) -> str:
    return _MIME_TO_EXT.get((mime or "").lower(), "bin")


def public_url_for(bucket: str, path: str) -> str:
    """
    Construct the canonical public URL for an uploaded object.

    Assumes the bucket was created with ``public=true`` (the default
    in ``setup_supabase.py``). If the operator flipped a bucket to
    private, this URL won't serve -- configure ``CORS`` + signed
    URLs at the bucket level instead.
    """
    base = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL is required to build a public URL")
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


# ----------------------------------------------------------------------
# Result type -- carries the value AND a structured fallback flag so
# callers can surface upload failures via response headers / body
# instead of silently persisting base64.
# ----------------------------------------------------------------------
@dataclass
class Media:
    """
    Result of ``ensure_url``.

    Attributes:
        value:      the string to persist (``<URL>`` on success,
                     ``<base64>`` if the upload was skipped or failed,
                     ``""`` if the input was empty).
        uploaded:   ``True`` only when bytes were POSTed successfully
                     to Supabase Storage. Empty / URL inputs and
                     decode failures leave this ``False``.
        fallback:   ``True`` when ``value`` is base64 because either
                     the env wasn't configured OR the upload call
                     raised. Callers should expose this to the FE
                     (``X-Devrose-Storage-Fallback`` header + a
                     ``__storage_warning`` field in the response body)
                     so the operator can react.
        reason:     short tag for logs (``ok``, ``empty``, ``already_url``,
                     ``env_unset``, ``decode_failed``, ``oversize``,
                     ``http_error``).
    """
    value: str
    uploaded: bool = False
    fallback: bool = False
    reason: str = "ok"


# ----------------------------------------------------------------------
# Public entry point -- handles upload + fallback
# ----------------------------------------------------------------------
def ensure_url(user, kind: str, value) -> Media:
    """
    Resolve ``value`` to a ``Media`` result.

    Behaviour:
      * Empty/None input → ``Media(value="", reason="empty")``.
      * Already http(s) URL → ``Media(value=value, reason="already_url")``
        — never re-uploaded.
      * Base64 input → upload to the bucket for ``kind``. On success
        returns a ``Media(value=<URL>, uploaded=True, fallback=False)``.
        On env-unset / decode / network / oversize → ``Media`` carrying
        the original base64 and ``fallback=True`` with a tagged ``reason``.
    """
    kind_class = classify(value)
    if kind_class == "empty":
        return Media(value="", reason="empty")
    if kind_class == "url":
        return Media(value=value, reason="already_url")

    bucket = _BUCKET_FOR_KIND.get(kind)
    if not bucket:
        logger.warning("ensure_url: unknown media kind %r; keeping as-is", kind)
        return Media(value=value, fallback=True, reason="unknown_kind")

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not supabase_url or not supabase_key:
        # No bucket configured (dev / CI / first-deploy path). Don't drop
        # the user's media -- keep the base64 in DB until the operator
        # provisions Supabase Storage.
        logger.info(
            "ensure_url: SUPABASE_URL/SERVICE_KEY unset; keeping base64 in DB "
            "(kind=%s, user_id=%s)",
            kind, getattr(user, "id", "?"),
        )
        return Media(value=value, fallback=True, reason="env_unset")

    mime, raw = _decode_base64(value)
    if not raw:
        return Media(value=value, fallback=True, reason="decode_failed")

    cap = _SIZE_CAPS_BYTES[kind]
    if len(raw) > cap:
        logger.warning(
            "ensure_url: %s payload is %d bytes (cap=%d); keeping base64",
            kind, len(raw), cap,
        )
        return Media(value=value, fallback=True, reason="oversize")

    # Storage path: <uid>/<uuid4_hex>.<ext>  -- unguessable so a
    # ``public=true`` bucket can't be folder-enumerated.
    uid = getattr(user, "id", "anon")
    path = f"{uid}/{uuid.uuid4().hex}.{_ext_for(mime)}"

    object_url = (
        f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}"
    )
    try:
        req = _urlrequest.Request(
            object_url,
            data=raw,
            method="POST",
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "apikey": supabase_key,
                "Content-Type": (mime or _default_mime_for(kind)),
                "x-upsert": "false",
                "User-Agent": "devrose-storage-upload/1.0",
            },
        )
        with _urlrequest.urlopen(req, timeout=60) as resp:
            if resp.status not in (200, 201):
                raise IOError(f"unexpected status {resp.status}")
        return Media(
            value=public_url_for(bucket, path),
            uploaded=True,
            fallback=False,
        )
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        logger.warning(
            "ensure_url: upload failed (kind=%s bucket=%s); keeping base64. err=%s",
            kind, bucket, exc,
        )
        return Media(value=value, fallback=True, reason="http_error")
    except Exception as exc:  # last-resort guard
        logger.exception("ensure_url: unexpected upload error: %s", exc)
        return Media(value=value, fallback=True, reason="http_error")


def _default_mime_for(kind: str) -> str:
    if kind in ("avatar", "cover", "image"):
        return "image/jpeg"
    return "audio/webm"
