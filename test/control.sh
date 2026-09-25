#!/bin/sh
# Contract for control mode (ORCA_PASSWORD set, the w/ Relay template): the
# public port serves the password page and proxies Orca (HTTP + WebSocket),
# pairing links stay out of the logs, rotate replaces the link, first boot
# seeds git identity + a registered Hello-World project.  Usage: test/control.sh [image]
set -eu
img="${1:-orca-rw:local}"
name="orca-control-$$" vol="orca-control-vol-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1; docker volume rm "$vol" >/dev/null 2>&1' EXIT
fail() { echo "FAIL $*"; docker logs "$name" 2>&1 | grep -v dbus | tail -20; exit 1; }
ok() { echo "ok   $*"; }
B=http://127.0.0.1:18080

docker run -d --name "$name" -p 18080:8080 -v "$vol:/data" -e PORT=8080 -e ORCA_PASSWORD=pw-control \
  -e ORCA_PAIRING_ADDRESS=$B -e GIT_USER_NAME="Test User" "$img" >/dev/null
for _ in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' $B/control/health)" = 200 ] && break; sleep 2; done
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/control/health)" = 200 ] || fail "never healthy"; ok "healthy"
[ "$(curl -s -o /dev/null -w '%{redirect_url}' $B/)" = "$B/control" ] || fail "/ does not lead to the control panel"; ok "/ redirects to /control"
curl -s $B/web-index.html | grep -qi "<html" || fail "web client not proxied"; ok "web client proxied"
docker logs "$name" 2>&1 | grep -q "Control panel: $B/control" || fail "control panel URL not in logs"; ok "control panel URL in logs"
docker logs "$name" 2>&1 | grep -q "orca://pair" && fail "pairing credential in logs"; ok "no credential in logs"
curl -s $B/control | grep -q 'type="password"' || fail "control not gated"; ok "control gated"
[ "$(curl -s -o /dev/null -w '%{http_code}' -d password=nope $B/control/login)" = 401 ] || fail "wrong password accepted"
sleep 2.1
C=$(curl -s -D - -o /dev/null -d password=pw-control $B/control/login | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p')
[ -n "$C" ] || fail "no session cookie"; ok "login"
P=$(curl -s -H "Cookie: $C" $B/control)
echo "$P" | grep -q "<svg" || fail "no QR"; echo "$P" | grep -q "web-index.html#pairing=" || fail "no web link"; ok "page shows QR + web link"
old=$(echo "$P" | sed -n 's/.*<pre id="code">\([^<]*\)<.*/\1/p')
node -e 'const w=new WebSocket(process.argv[1]);w.onopen=()=>{console.log("ws-open");process.exit(0)};w.onerror=()=>process.exit(1);setTimeout(()=>process.exit(1),5000)' "ws://127.0.0.1:18080/" >/dev/null || fail "websocket not proxied"; ok "websocket proxied"

u() { docker exec -u orca -e HOME=/data/home "$name" sh -c "$1"; }
[ "$(u 'git config --global user.name')" = "Test User" ] || fail "git identity"; ok "git identity from form"
u 'git config --global user.email' >/dev/null || fail "git email default"; ok "git email default"
for _ in $(seq 1 40); do u 'test -e ~/.orca-seeded' && break; sleep 3; done
u '~/.local/bin/orca repo list' 2>/dev/null | grep -q hello-world || fail "hello-world not registered"; ok "hello-world registered"
u 'for c in claude codex pi gh git node; do command -v $c >/dev/null || exit 1; done' || fail "CLIs"; ok "claude codex pi gh present"
docker exec "$name" test -d /home/user/projects/ || fail "/home/user/projects"; ok "/home/user/projects lands on the volume"
n=$(docker exec -u orca "$name" sh -c 'p=$(pgrep -f "orca-ide.*serve" | head -1); tr "\0" "\n" < /proc/$p/environ | grep -c ORCA_PASSWORD' || true)
[ "$n" = 0 ] || fail "password leaks into Orca's environment ($n)"; ok "password not in Orca's environment"

curl -s -o /dev/null -H "Cookie: $C" -X POST $B/control/rotate
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' $B/control/health)" = 200 ] && break; sleep 2; done
new=$(curl -s -H "Cookie: $C" $B/control | sed -n 's/.*<pre id="code">\([^<]*\)<.*/\1/p')
[ -n "$new" ] && [ "$new" != "$old" ] || fail "rotate did not change the link"; ok "rotate issues a new link"
echo PASS
