#!/bin/sh
# Contract: every pin in this repo is on one Orca release. Dockerfile ARG, the
# relay's upstream commit (must be that release tag's commit), and the default
# image tag in every config master/script.  Usage: test/versions.sh [version]
# Default version: upstream's latest stable release (needs gh).
set -eu
cd "$(dirname "$0")/.."
want="${1:-$(gh release view -R stablyai/orca --json tagName --jq .tagName | sed 's/^v//')}"
sha="$(gh api "repos/stablyai/orca/commits/v$want" --jq .sha)"
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1 = $2"; else echo "FAIL $1 = $2 (want $3)"; fails=1; fi; }
check Dockerfile "$(sed -n 's/^ARG ORCA_VERSION=//p' Dockerfile)" "$want"
check relay/Dockerfile "$(sed -n 's/^ARG ORCA_COMMIT=//p' relay/Dockerfile)" "$sha"
for f in repair.py relay_template.py upgrade_in_place.py build_source.py build_relay_source.py; do
  check "$f" "$(grep -oE "[\"':]1\.4\.[0-9]+(-r[0-9]+)?[\"']" "$f" | tr -d "\"':" | sort -u | tr '\n' ' ' | sed 's/ $//')" "$want"
done
check template.json "$(grep -oE 'orca-railway(-relay)?:1\.4\.[0-9]+|"v1\.4\.[0-9]+"' template.json relay-template.json | sed 's/.*://; s/"v//; s/"//' | sort -u | tr '\n' ' ' | sed 's/ $//')" "$want"
[ "$fails" = 0 ] && echo PASS || { echo FAIL; exit 1; }
