#!/bin/bash
# run_vite.sh — launcher that always CD's to the project root before running Vite.
# Uses $(dirname "$0") so the script works regardless of where it is cloned to.
cd "$(dirname "$0")"

# Make sure node_modules is installed before launching Vite so the failure mode is clear.
if [ ! -d node_modules ]; then
  echo "❌ Missing node_modules."
  echo "   Run:  npm install"
  exit 1
fi

exec npm run dev -- --host 0.0.0.0 --port 3000
