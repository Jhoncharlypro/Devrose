#!/bin/bash
# run_vite.sh — launcher that always CD's to the project root before running Vite.
cd /home/jhoncharlyreactive/.work
exec npm run dev -- --host 0.0.0.0 --port 3000
