#!/bin/bash
# run_daphne.sh — launcher for the Django Channels ASGI server (HTTP + WebSockets).
#
# Use this in addition to vite (`run_vite.sh`) — vite serves the React frontend on
# :3000, while Daphne serves the Django API + Kot3Chat / LiveClassroom WebSockets
# on :8000. Vite's dev-server proxies /api and /ws to this Daphne process.
#
# Stop with Ctrl-C. Run in its own terminal tab alongside vite for full-stack dev.
cd "$(dirname "$0")/backend"

# Make sure the Python deps are installed before launching Daphne so the failure
# mode is clear (and not a confusing `ModuleNotFoundError: No module named 'daphne'`).
if ! python -c "import daphne, channels, rest_framework, corsheaders" 2>/dev/null; then
  echo "❌ Missing Python dependencies."
  echo "   Run:  pip install -r backend/requirements.txt"
  exit 1
fi

exec python -m daphne -b 0.0.0.0 -p 8000 devrose_backend.asgi:application
