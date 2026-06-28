"""
``manage.py setup_supabase`` — provision Supabase STORAGE buckets.

After the Postgres schema is migrated (via ``manage.py migrate``),
the application also wants three Supabase Storage buckets ready:

  * ``avatars``    — public-readable; profile + group photos.
  * ``covers``     — public-readable; wide banner / cover_photo.
  * ``chat-images`` — public-readable; chat image attachments.
  * ``audio``      — public-readable; voice notes.

Each bucket is created on demand (idempotent) and configured public
so unauthenticated clients can fetch a stable CDN URL. Access control
for writes happens upstream via Supabase Row-Level Security on the
``storage.objects`` table if/when the project enables it.

This command REQUIRES ``SUPABASE_URL`` + ``SUPABASE_SERVICE_KEY`` in
the environment (or in the project's .env, picked up by settings.py
on startup). The service key MUST be the ``service_role`` JWT — never
the anon key. The anon key is rate-limited and can't create buckets.

Typical CI use:

    $ python backend/manage.py setup_supabase
    bucket created: avatars (public=true)
    bucket exists: covers (public=true)
    bucket created: chat-images (public=true)
    bucket exists: audio (public=true)
    ✓ 4 buckets ready
"""
import json
import logging
import os
import urllib.parse
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError

from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger(__name__)


# Buckets the application expects to exist. Add to this list (key-order
# is preserved so the output prints in declaration order). The
# ``file_size_limit`` mirrors ``api/storage_utils.py`` so Supabase
# rejects oversize uploads upstream of Django (single source of truth).
EXPECTED_BUCKETS = (
    ('avatars',     'Profile and group photos — public read. 2 MB cap.',       True, 2 * 1024 * 1024),
    ('covers',      'Wide banner images — public read. 5 MB cap.',           True, 5 * 1024 * 1024),
    ('chat-images', 'Chat image attachments — public read. 4 MB cap.',       True, 4 * 1024 * 1024),
    ('audio',       'Voice notes — public read. 2 MB cap.',                   True, 2 * 1024 * 1024),
)


class Command(BaseCommand):
    help = "Create (or verify) the Supabase Storage buckets the app expects."

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print the actions we would take; do not mutate remote state.',
        )

    def handle(self, *args, **options):
        supabase_url = os.environ.get('SUPABASE_URL', '').strip()
        supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
        if not supabase_url or not supabase_key:
            raise CommandError(
                "setup_supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY "
                "in the environment (or in the project's .env, loaded by "
                "settings.py at startup).\n"
                "Find the service_role key under Supabase dashboard → "
                "Project Settings → API → service_role (secret).\n"
                "Find SUPABASE_URL under Project Settings → API → Project URL."
            )

        parsed = urllib.parse.urlparse(supabase_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            raise CommandError(
                f"SUPABASE_URL is not a valid http(s) URL: {supabase_url!r}"
            )

        base = supabase_url.rstrip('/')
        # NOTE: render / Cloudflare / corporate egress often bounces
        # requests without a ``User-Agent`` header on Supabase Storage.
        # Set one explicitly + carry the service ``apikey`` token.
        headers = {
            'Authorization': f'Bearer {supabase_key}',
            'apikey': supabase_key,
            'Content-Type': 'application/json',
            'User-Agent': 'devrose-setup-supabase/1.0',
        }

        # List existing buckets once so we don't hammer the API per-bucket.
        existing = self._list_buckets(base, headers)
        created_count = exists_count = reconfigured_count = 0
        for name, description, public, size_cap in EXPECTED_BUCKETS:
            if name in existing:
                # Bucket exists -- check if its size cap matches the
                # current spec; reconfigure if the cap drifted (operator
                # may have used old ``5 MB`` cap for avatars previously).
                if not options['dry_run']:
                    reconfigured = self._ensure_size_cap(
                        base, headers, name, size_cap,
                    )
                    if reconfigured:
                        reconfigured_count += 1
                self.stdout.write(f"  bucket exists: {name} (public=true)")
                exists_count += 1
                continue
            if options['dry_run']:
                self.stdout.write(f"  [dry-run] would create: {name}")
                continue
            try:
                self._create_bucket(base, headers, name, description, public, size_cap)
            except HTTPError as exc:
                # If create fails because the bucket suddenly exists
                # between our list and create (race with another deploy),
                # treat as success.
                if exc.code == 409:
                    self.stdout.write(f"  bucket exists (raced): {name}")
                    exists_count += 1
                    continue
                raise CommandError(
                    f"failed to create bucket {name!r}: "
                    f"{exc.code} {exc.read().decode('utf-8', errors='replace')}"
                )
            else:
                self.stdout.write(
                    self.style.SUCCESS(f"  bucket created: {name} (public=true)")
                )
                created_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\n✓ {created_count + exists_count} buckets ready "
                f"({created_count} created, {exists_count} already existed, "
                f"{reconfigured_count} re-sized)."
            )
        )

    # ------------------------------------------------------------------
    def _http_json(self, url, headers, method='GET', payload=None):
        """
        Wrapper around urllib for the Supabase Storage REST endpoints.

        Centralises:
          * User-Agent override (Cloudflare / Render / corp egress
            frequently bounce unidentified UAs).
          * Timeout enforcement (``socket.timeout`` isn't an
            ``URLError`` subclass on py3.10 — catch it explicitly).
          * JSON decode fallback when the body is a Cloudflare HTML
            error page (instead of crashing with ``ValueError``).
        """
        import socket
        kwargs = {'headers': headers, 'method': method}
        if payload is not None:
            kwargs['data'] = payload
        req = urlrequest.Request(url, **kwargs)
        try:
            with urlrequest.urlopen(req, timeout=10) as resp:
                body = resp.read().decode('utf-8', errors='replace')
        except (URLError, HTTPError, socket.timeout, OSError) as exc:
            raise CommandError(f"Supabase Storage call failed: {method} {url} → {exc}") from exc
        try:
            return json.loads(body) if body else []
        except ValueError:
            return []

    def _list_buckets(self, base, headers):
        data = self._http_json(f"{base}/storage/v1/bucket", headers)
        return {b['name'] for b in data if isinstance(b, dict) and 'name' in b}

    def _create_bucket(self, base, headers, name, description, public, size_cap):
        payload = json.dumps({
            'name': name,
            'public': public,
            'description': description,
            'file_size_limit': size_cap,
        }).encode('utf-8')
        self._http_json(
            f"{base}/storage/v1/bucket", headers,
            method='POST', payload=payload,
        )

    def _ensure_size_cap(self, base, headers, name, size_cap):
        """
        ``PUT /storage/v1/bucket/{name}`` to update the size cap.

        Returns True if the bucket was reconfigured (cap drifted), False
        if it already matched. Idempotent and safe to re-run.
        """
        # Get current state. If we can't read it, leave the bucket alone
        # rather than risk an unintended reset.
        try:
            current = self._http_json(
                f"{base}/storage/v1/bucket/{name}", headers,
            )
        except Exception:
            logger.warning("could not fetch current %s bucket state; skipping reconf", name)
            return False
        if not isinstance(current, dict):
            return False
        existing_cap = current.get("file_size_limit")
        if existing_cap == size_cap:
            return False
        # Read-modify-write the bucket config so we don't accidentally
        # erase an operator-tuned ``allowed_mime_types`` allow-list (e.g.
        # restricting the ``audio`` bucket to ``audio/webm`` only). A
        # blank PUT would clobber that allow-list silently because the
        # Supabase REST PUT overwrites the whole config blob.
        reconf = {
            'public': current.get("public", True),
            'file_size_limit': size_cap,
            'description': current.get("description", ""),
        }
        existing_mime_types = current.get("allowed_mime_types")
        if isinstance(existing_mime_types, list):
            reconf['allowed_mime_types'] = existing_mime_types
        payload = json.dumps(reconf).encode('utf-8')
        try:
            self._http_json(
                f"{base}/storage/v1/bucket/{name}", headers,
                method='PUT', payload=payload,
            )
            self.stdout.write(self.style.WARNING(
                f"    ↳ re-sized {name}: {existing_cap} → {size_cap} bytes"
            ))
            return True
        except Exception as exc:
            logger.warning("could not resize %s bucket: %s", name, exc)
            return False
