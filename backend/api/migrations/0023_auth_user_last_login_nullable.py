"""
Phase 9 — Make ``auth_user.last_login`` NULL-able.

Why
---
The dev SQLite DB was initialised with a legacy ``auth_user`` schema
(``username VARCHAR(30)``, ``first_name VARCHAR(30)``,
``last_name VARCHAR(30)``, ``email VARCHAR(75)``,
``last_login DATETIME NOT NULL DEFAULT NULL``) which pre-dates Django
2.0's auth.User column-size bump and the
``last_login = DateTimeField(null=True)`` contract. The mismatch is
harmless for the column sizes (SQLite uses type affinity, not strict
typing) but the ``NOT NULL`` on ``last_login`` actively breaks
``User.objects.create_user()``:

    IntegrityError: NOT NULL constraint failed: auth_user.last_login

Django's ``UserManager.create_user()`` does NOT pre-set ``last_login`` —
it relies on the field defaulting to NULL. The signup view's blanket
``except IntegrityError`` then mis-reports the failure as HTTP 409
"Username already taken." (the wrong code, the wrong field), which
made signup look broken even when both email and username were unique
on a fresh DB. See ``api/views/auth.py::_django_signup_response`` for
the companion code fix that pre-sets ``last_login`` + gives a more
accurate error envelope.

This migration aligns the DB schema with Django's stock model so any
future caller of ``User.objects.create_user()`` (or
``User.objects.create()``) works without a workaround. The companion
code fix remains as a belt-and-suspenders safety net.

Cross-backend support
---------------------
This migration was originally SQLite-only (used ``PRAGMA`` + table
rebuild because SQLite has no ``ALTER COLUMN``). When the project
migrated to Supabase Postgres the PRAGMA path failed with
``syntax error at or near "PRAGMA"``. The fix branches on
``schema_editor.connection.vendor`` and runs the right DDL for each
backend:

  * ``postgresql`` — ``ALTER TABLE auth_user ALTER COLUMN last_login
    DROP NOT NULL`` (idempotent; safe to run on a fresh DB where
    Django stock already created it nullable).
  * ``mysql`` — ``ALTER TABLE auth_user MODIFY COLUMN last_login
    DATETIME NULL``.
  * ``sqlite`` — the original table-rebuild pattern with
    ``PRAGMA foreign_keys=off`` so the FK from ``profile_user``
    (and any other auth_user-referencing table) survives the drop.

Reversibility
-------------
The reverse path runs the opposite DDL for each vendor. On Postgres
``SET NOT NULL`` will fail loudly if any row has NULL ``last_login``;
on SQLite the ``INSERT ... SELECT`` will fail with a NOT NULL
violation. Both are intended guards against silently back-mutating
a column the application has been writing NULL into.
"""
from django.db import migrations


SQLITE_FORWARD = r"""
-- Phase 9: rebuild auth_user with last_login NULL-able to match
-- Django's stock auth.User model. The legacy NOT NULL on last_login
-- breaks User.objects.create_user() because Django doesn't pre-set
-- the field — see the migration docstring for the full root-cause
-- narrative.
PRAGMA foreign_keys=off;
BEGIN TRANSACTION;
CREATE TABLE auth_user_new (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    password varchar(128) NOT NULL,
    last_login datetime NULL,                -- ← was NOT NULL
    is_superuser bool NOT NULL,
    username varchar(30) NOT NULL UNIQUE,   -- legacy size preserved
    first_name varchar(30) NOT NULL,
    last_name varchar(30) NOT NULL,
    email varchar(75) NOT NULL,
    is_staff bool NOT NULL,
    is_active bool NOT NULL,
    date_joined datetime NOT NULL
);
INSERT INTO auth_user_new (
    id, password, last_login, is_superuser, username,
    first_name, last_name, email, is_staff, is_active, date_joined
)
SELECT
    id, password, last_login, is_superuser, username,
    first_name, last_name, email, is_staff, is_active, date_joined
FROM auth_user;
DROP TABLE auth_user;
ALTER TABLE auth_user_new RENAME TO auth_user;
COMMIT;
PRAGMA foreign_keys=on;
"""


SQLITE_REVERSE = r"""
-- Reverse: rebuild auth_user with last_login NOT NULL. The INSERT
-- below will fail with a NOT NULL violation if any row has a NULL
-- last_login at reverse time — that's the intended guard against
-- silently losing data the application has been writing. The ``id``
-- column is left bare (no COALESCE) so a corrupt source row with a
-- NULL PK would surface as a loud constraint violation rather than
-- being silently coerced to id=0.
PRAGMA foreign_keys=off;
BEGIN TRANSACTION;
CREATE TABLE auth_user_new (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    password varchar(128) NOT NULL,
    last_login datetime NOT NULL,            -- ← restored
    is_superuser bool NOT NULL,
    username varchar(30) NOT NULL UNIQUE,
    first_name varchar(30) NOT NULL,
    last_name varchar(30) NOT NULL,
    email varchar(75) NOT NULL,
    is_staff bool NOT NULL,
    is_active bool NOT NULL,
    date_joined datetime NOT NULL
);
INSERT INTO auth_user_new (
    id, password, last_login, is_superuser, username,
    first_name, last_name, email, is_staff, is_active, date_joined
)
SELECT
    id, password, last_login, is_superuser, username,
    first_name, last_name, email, is_staff, is_active, date_joined
FROM auth_user;
DROP TABLE auth_user;
ALTER TABLE auth_user_new RENAME TO auth_user;
COMMIT;
PRAGMA foreign_keys=on;
"""


def make_nullable(apps, schema_editor):
    """Forward op — drop the NOT NULL on ``auth_user.last_login`` for
    the active DB vendor. See module docstring for the full
    per-vendor rationale."""
    vendor = schema_editor.connection.vendor
    if vendor == 'sqlite':
        # SQLite has no ALTER COLUMN; we have to rebuild the table.
        # ``schema_editor.execute`` runs a single statement at a time
        # so we split on ';' and feed each non-empty segment. The
        # PRAGMA lines must run OUTSIDE the implicit Django
        # transaction — see ``atomic = False`` below — which is why
        # the original RunSQL also used ``atomic = False``.
        for stmt in SQLITE_FORWARD.split(';'):
            if stmt.strip():
                schema_editor.execute(stmt)
    elif vendor == 'postgresql':
        # Postgres supports ALTER COLUMN directly. Idempotent: on a
        # fresh Supabase DB where Django stock already created the
        # column nullable, this is a no-op (PG won't error).
        schema_editor.execute(
            'ALTER TABLE auth_user ALTER COLUMN last_login DROP NOT NULL'
        )
    elif vendor == 'mysql':
        schema_editor.execute(
            'ALTER TABLE auth_user MODIFY COLUMN last_login DATETIME NULL'
        )
    else:
        raise NotImplementedError(
            f'last_login nullability not implemented for DB vendor: {vendor}'
        )


def reverse_nullable(apps, schema_editor):
    """Reverse op — restore the NOT NULL. Loud-fails if any row has
    a NULL ``last_login`` (matches the SQLite design's intent)."""
    vendor = schema_editor.connection.vendor
    if vendor == 'sqlite':
        for stmt in SQLITE_REVERSE.split(';'):
            if stmt.strip():
                schema_editor.execute(stmt)
    elif vendor == 'postgresql':
        # SET NOT NULL fails loudly with a constraint violation if any
        # row has NULL — the intended guard against silently
        # back-mutating a column the app has been writing NULL into.
        schema_editor.execute(
            'ALTER TABLE auth_user ALTER COLUMN last_login SET NOT NULL'
        )
    elif vendor == 'mysql':
        schema_editor.execute(
            'ALTER TABLE auth_user MODIFY COLUMN last_login DATETIME NOT NULL'
        )
    else:
        raise NotImplementedError(
            f'last_login reverse-nullability not implemented for DB vendor: {vendor}'
        )


class Migration(migrations.Migration):
    """Phase 9 — make ``auth_user.last_login`` NULL-able dynamically across vendors.

    ``atomic = False`` is REQUIRED for the SQLite branch: the table-rebuild
    pattern needs ``PRAGMA foreign_keys=off`` BEFORE the DROP, and
    SQLite's ``PRAGMA foreign_keys`` is a no-op inside a transaction
    (see https://www.sqlite.org/pragma.html#pragma_foreign_keys). Django
    wraps every migration in a transaction by default, so we opt out
    via ``atomic = False``. The Postgres and MySQL branches don't
    need the PRAGMA, so they're unaffected by the opt-out.

    We use ``RunPython`` (not ``RunSQL``) because the SQL string is
    selected at runtime by ``connection.vendor`` — ``RunSQL.sql`` is
    evaluated at migration-load time, before any DB connection
    exists, so it can't be made vendor-aware without this wrapper.
    """

    dependencies = [
        ('api', '0022_alter_chatfoldermembership_options_and_more'),
    ]

    atomic = False

    operations = [
        migrations.RunPython(make_nullable, reverse_nullable),
    ]
