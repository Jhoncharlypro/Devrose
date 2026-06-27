# Changelog

All notable changes to DevRose Academy are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `LICENSE` at repo root (MIT, Copyright (c) 2026 DevRose Academy)
- Backend proxy `backend/api/views/ai.py` exposing `POST /api/ai/generate/` for Google Gemini
- `kot3chat/` frontend module split (`constants.js`, `audioUtils.js`)
- `run_daphne.sh` launcher for Django + Channels ASGI
- `backend/requirements.txt` with version pins
- Header comments explaining design decisions across `src/App.jsx`, `src/services/api.js`, `backend/api/auth/custom.py`, `backend/api/middleware.py`, `backend/api/consumers.py`, `backend/devrose_backend/settings.py`

### Changed
- `@google/generative-ai` removed from frontend deps; backend proxies Gemini now
- Gemini key moved from `VITE_GEMINI_API_KEY` to backend `GEMINI_API_KEY`
- DRF throttling added (`UserRateThrottle` at 30/min)
- README Licence section references `LICENSE` + MIT badge

### Removed
- 24 one-off dev/patch scripts (`apply_*`, `patch_*`, `fix_*`, `refactor_*`, `find_*`, `trace_*`, `diag_picker.py`, `rules.txt`, `Kot3Chat.jsx.bk-v4`)
- `kot3_dark_mode` boolean localStorage key; replaced with `kot3_active_theme` (8 themes)

### Fixed
- Gemini API-key leak risk removed
- Settings.py Django version comment updated to `Django 5.2 LTS`
- `kot3chat/constants.js` HMR sentinel `const` → `let` to avoid TypeError
- `audioUtils.js` `startCallingSounds()` now idempotent; ramp-down timer cancellation
