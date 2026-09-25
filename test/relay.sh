#!/bin/sh
# Boots the relay image locally (loopback origin, like a stranger's deploy minus
# TLS) and runs test/relay-check.mjs inside it.  Usage: test/relay.sh [image]
set -eu
img="${1:-orca-relay-rw:local}"
name="orca-relay-check-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1' EXIT
cd "$(dirname "$0")"
docker run -d --name "$name" -e PUBLIC_ORIGIN=http://127.0.0.1:8080 -e ORCA_PASSWORD=pw-check "$img" >/dev/null
for i in $(seq 1 30); do docker exec "$name" wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 && break; sleep 1; done
docker exec "$name" mkdir -p /app/dev/scripts
docker cp smoke-relay.mjs "$name":/app/dev/scripts/smoke-relay.mjs
docker cp relay-check.mjs "$name":/app/relay-check.mjs
docker exec "$name" node /app/relay-check.mjs http://127.0.0.1:8080 pw-check || { docker logs "$name" 2>&1 | tail -30; exit 1; }
