"""
URL configuration for devrose_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/

Architecture
------------
On Render the frontend (Vite/React) and backend (Django) are deployed as
TWO separate services:

  * Frontend (Static Site)  →  https://devrose.onrender.com  (serves the
                                built ``dist/`` folder as static files).
  * Backend  (Web Service)   →  https://api-devrose.onrender.com
                                (this Django + Daphne ASGI app).

The bare backend host (``/``) therefore does NOT try to serve the SPA shell.
That used to be a ``TemplateView(template_name='index.html')`` lookup,
but the ``dist/`` folder is **not** present on the backend dyno (it's
only on the static-site dyno), so the lookup 500'd with
``TemplateDoesNotExist: index.html``. The root is now a small JSON
envelope — see ``api.views.root.api_root``.

The ``/assets/<path:path>`` route is similarly dev-only. It is wrapped in
an ``os.path.isdir`` guard so a missing ``dist/assets/`` folder (the
normal Render situation) is a silent 404 instead of a 500.
"""
import os

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve

from api.views import api_root


# Optional dev-only routes that depend on a Vite-built ``dist/`` folder
# sitting next to the repo. On Render this folder does NOT exist (the
# static-site service deploys it independently), so we skip these routes
# rather than 500-ing on a missing file.
#
# This check runs at IMPORT time (once per process), not per-request.
# That's the right scope here: Render's deploy either bakes ``dist/`` in
# or doesn't, no mid-flight changes — a per-request check would be
# wasted work.
_DIST_ASSETS = os.path.join(settings.BASE_DIR, '../dist/assets')
if os.path.isdir(_DIST_ASSETS):
    _spa_assets_urlpatterns = [
        path('assets/<path:path>', serve, {'document_root': _DIST_ASSETS}),
    ]
else:
    _spa_assets_urlpatterns = []


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    *_spa_assets_urlpatterns,
    path('', api_root, name='index'),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
