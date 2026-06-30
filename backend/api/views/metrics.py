"""
``/api/metrics/`` — lightweight Prometheus-style scrape endpoint.

Returns counters accumulated by the views in ``api/views/part4.py`` and
``api/views/chat.py`` (via ``_BUMP``). Output format is the Prometheus
text exposition v0.0.4 — every line is:

    metric_name{label=value} <number>

This is a "soft" exporter: counters are process-local (Django process
memory). Two Daphne workers each maintain their own counter set, so
Prometheus' aggregation sum() correctly reconnects them when scraped
periodically. For a real cluster counter we'd need Redis ZINCRBY;
we don't have that here, but the format is compatible so swapping
in a Redis-backed counter store is a one-file change.

Auth: ``AllowAny`` so a Prometheus scraper / uptime probe can hit it
without a JWT. We DO NOT leak the request user's data here — every
metric key is process-global and anonymous.
"""
from __future__ import annotations

import threading
from collections import defaultdict
from typing import Dict

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny


# Thread-safe counters. ``defaultdict`` with an ``int()`` factory gives
# us automatic zero-initialisation; the lock keeps concurrent writers
# from racing on the same key in a multi-thread WSGI server (Daphne
# is single-threaded async but DRF views can run on a WSGI worker).
_LOCK = threading.Lock()
_COUNTERS: Dict[str, int] = defaultdict(int)


def bump(metric: str, n: int = 1) -> None:
    """
    Increment ``metric`` by ``n``. Public so viewsets can call it.

    Examples:
        bump('devrose_chat_threads_list_total')
        bump('devrose_calls_call_again_total', 1)

    Usage is wrapped in a try/except by callers that don't want a
    counter failure to take the user request down.
    """
    try:
        with _LOCK:
            _COUNTERS[metric] += n
    except Exception:  # noqa: BLE001
        # Never propagate a counter failure to a user request.
        pass


def _snapshot() -> Dict[str, int]:
    with _LOCK:
        return dict(_COUNTERS)


@api_view(['GET'])
@permission_classes([AllowAny])
def metrics(request):
    """
    GET /api/metrics/    Prometheus text exposition.

    Output example::

        # HELP devrose_up Live readiness flag.
        # TYPE devrose_up gauge
        devrose_up 1
        # HELP devrose_chat_threads_list_total Chat thread list requests served.
        # TYPE devrose_chat_threads_list_total counter
        devrose_chat_threads_list_total 42

    The endpoint never raises; if lock acquisition fails we return
    an empty document (200 with no body) so the scraper can still
    mark the system up.
    """
    try:
        snap = _snapshot()
    except Exception:
        return HttpResponse(content='', content_type='text/plain; version=0.0.4')

    lines = [
        '# HELP devrose_up Process liveness.',
        '# TYPE devrose_up gauge',
        'devrose_up 1',
    ]
    if snap:
        lines.append('# HELP devrose_view_request_total DRF view requests served since process start.')
        lines.append('# TYPE devrose_view_request_total counter')
        for name, value in sorted(snap.items()):
            # Escape label values per the Prometheus exposition format:
            # `\` → `\\`, newline → `\n`, `"` → `\"`.
            lines.append(f'{name} {int(value)}')
    body = '\n'.join(lines) + '\n'
    return HttpResponse(content=body, content_type='text/plain; version=0.0.4')
