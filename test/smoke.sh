#!/bin/sh
# Contract: the image boots `orca serve` non-root on a root-owned volume,
# serves the web client on $PORT, and prints a pairing offer advertising the
# public https URL as wss://.  Usage: test/smoke.sh [image]
set -eu
img="${1:-orca-rw:local}"
name="orca-smoke-$$"
vol="orca-smoke-vol-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1; docker volume rm "$vol" >/dev/null 2>&1' EXIT

docker run -d --name "$name" -p 16768:6768 -v "$vol:/data" \
  -e RAILWAY_PUBLIC_DOMAIN=orca.example.test "$img" >/dev/null

for i in $(seq 1 90); do
  docker logs "$name" 2>&1 | grep -q "Orca server ready" && break
  sleep 2
done
logs="$(docker logs "$name" 2>&1)"
echo "$logs" | grep -q "Orca server ready" || { echo "$logs"; echo "FAIL: never ready"; exit 1; }
echo "$logs" | grep -q "Advertised endpoint: wss://orca.example.test" || { echo "$logs"; echo "FAIL: advertised endpoint"; exit 1; }
echo "$logs" | grep -q "orca://pair?code=" || { echo "FAIL: no pairing url"; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:16768/)"
[ "$code" = 200 ] || { echo "FAIL: GET / -> $code"; exit 1; }
curl -s http://127.0.0.1:16768/ | grep -qi "<html" || { echo "FAIL: / is not html"; exit 1; }
user="$(docker exec "$name" ps -o user= -C orca-ide | sort -u | tr -d ' \n')"
[ "$user" = orca ] || { echo "FAIL: orca-ide runs as '$user'"; exit 1; }
docker exec "$name" setpriv --reuid=orca --regid=orca --init-groups sh -c 'command -v claude codex git node' >/dev/null \
  || { echo "FAIL: agent CLIs missing"; exit 1; }
echo PASS
