"""
``/`` — JSON API root for the DevRose Academy backend.

WHY this exists
----------------
The previous root URL handler was ``TemplateView.as_view(template_name='index.html')``,
which tried to render the Vite-built SPA shell from the ``dist/`` folder. On
Render the frontend is deployed as a **separate static site** (served at
``https://devrose.onrender.com``), so the ``dist/`` folder is **not** present
on the backend dyno. The old handler therefore 500'd with
``TemplateDoesNotExist: index.html`` on every request to the bare backend
host (e.g. https://api-devrose.onrender.com/).

This view returns a small JSON envelope so the bare backend host answers
cleanly without depending on any frontend artefacts:

  {
    "name":    "DevRose Academy API",
    "status":  "ok",
    "version": "1.0",
    "docs":    "/api/",
    "healthz": "/api/healthz/",
    "frontend": "https://devrose.onrender.com"
  }

CORS / cross-origin
-------------------
The frontend lives at ``https://devrose.onrender.com`` (separate Render
static site). The browser never actually loads this page — but a curious
operator pasting the API URL into a tab or a load balancer probe is now
met with a clean JSON response (200) instead of a 500 stack trace.
"""
import os

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(['GET'])
@permission_classes([AllowAny])
def api_root(request):
    """
    GET /

    Returns a small JSON envelope describing the API + pointers to
    /api/ (DRF router root) and /api/healthz/ (liveness probe).
    """
    # Surface the frontend URL only when explicitly configured. We do NOT
    # hard-code it so an operator can spin up a preview deploy with a
    # different frontend host (e.g. https://devrose-preview.onrender.com)
    # without re-touching the backend.
    frontend_url = (
        os.environ.get('FRONTEND_URL', '').strip()
        or 'https://devrose.onrender.com'
    )
    return Response({
        'name': 'DevRose Academy API',
        'status': 'ok',
        'version': '1.0',
        'docs': '/api/',
        'healthz': '/api/healthz/',
        'frontend': frontend_url,
    })
