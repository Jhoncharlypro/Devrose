# backend/api/sessions/

Despite the name, **this folder is NOT where user-session state lives**. The
authoritative user-session state is the `SessionMemory` model in
`backend/api/models/session.py`, exposed via `SessionMemoryViewSet` at
`/api/session/me/`.

This folder is kept for backward-compatibility with the original project
layout (see rules.txt in the project brief). New code should not add files
here — contribute your change against `api/models/session.py` or
`api/views/session.py` instead.

If you found an empty folder while exploring: yes, that's expected.
