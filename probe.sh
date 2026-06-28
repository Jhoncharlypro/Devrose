set +e
echo '=== port listeners ==='
ss -ltn 2>/dev/null | grep -E ':(3000|8000) ' || echo '(neither port listening)'
echo
echo '=== daphne healthz ==='
curl -sS -o /dev/null -w 'healthz: %{http_code}\n' --max-time 6 http://127.0.0.1:8000/api/healthz/
echo
echo '=== daphne log (last 30) ==='
tail -30 /tmp/devrose-daphne.log 2>/dev/null
echo
echo '=== vite log (last 15) ==='
tail -15 /tmp/devrose-vite.log 2>/dev/null
echo
echo '=== signup a fresh user to get a valid access token ==='
BASE=http://127.0.0.1:8000
TS=$(date +%s)
EMAIL="pd_${TS}@devrose.local"
USER="pd_${TS}"
PW="devrose2026"
printf '%s' "{\"email\":\"${EMAIL}\",\"password\":\"${PW}\",\"username\":\"${USER}\"}" > /tmp/s.json
curl -sS -o /tmp/s.out -w '  signup: %{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary @/tmp/s.json --max-time 15 ${BASE}/api/signup/
# Use cat /tmp/s.out to extract access token manually since json parsing might fail if not properly formed
ACCESS=$(python3 -c 'import json; d=json.load(open("/tmp/s.out")); print(d.get("access",""))' 2>/dev/null) || ACCESS=""
echo "  access (first 40): ${ACCESS:0:40}..."
echo
echo '=== hit the exact failing endpoint: /api/profile/me/ (direct on :8000) ==='
curl -sS -o /tmp/pm.out -w '  direct /api/profile/me/ via :8000: %{http_code}\n' --max-time 12 -H "Authorization: Bearer ${ACCESS}" ${BASE}/api/profile/me/
cat /tmp/pm.out; echo
echo
echo '=== hit it through the vite proxy (port 3000 -> :8000) ==='
curl -sS -o /tmp/pm2.out -w '  proxied /api/profile/me/ via :3000: %{http_code}\n' --max-time 12 -H "Authorization: Bearer ${ACCESS}" http://127.0.0.1:3000/api/profile/me/
cat /tmp/pm2.out; echo
echo
echo '=== profileService.getMe() hits /api/profile/me/ too — let us check both responses for differences ==='
echo '--- direct :8000 ---'
wc -c /tmp/pm.out
echo '--- proxied :3000 ---'
wc -c /tmp/pm2.out
echo
echo '=== also probe other /api/ endpoints the app uses to confirm if it is profile-specific ==='
echo '--- /api/me/ ---'
curl -sS -o /dev/null -w '  /api/me/ direct: %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" ${BASE}/api/me/
curl -sS -o /dev/null -w '  /api/me/ proxy:  %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" http://127.0.0.1:3000/api/me/
echo '--- /api/courses/ ---'
curl -sS -o /dev/null -w '  /api/courses/ direct: %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" ${BASE}/api/courses/
curl -sS -o /dev/null -w '  /api/courses/ proxy:  %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" http://127.0.0.1:3000/api/courses/
echo '--- /api/profile/countries/ ---'
curl -sS -o /dev/null -w '  /api/profile/countries/ direct: %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" ${BASE}/api/profile/countries/
curl -sS -o /dev/null -w '  /api/profile/countries/ proxy:  %{http_code}\n' --max-time 6 -H "Authorization: Bearer ${ACCESS}" http://127.0.0.1:3000/api/profile/countries/
