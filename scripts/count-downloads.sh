#!/bin/bash
# ── Download Counter ──────────────────────────────────────────────────────────
#
# Tallies how many times each file under /downloads has been downloaded, by
# reading Caddy's dedicated downloads-access.log (JSON lines, one per
# request). Not shown anywhere in the public UI — this is a manual,
# on-demand lookup for curiosity, not an analytics dashboard.
#
# Usage (on the VPS):
#   docker exec caddy cat /var/log/caddy/downloads-access.log* | \
#     bash scripts/count-downloads.sh
# or, if run directly from the VPS host (where the Docker volume mounts to a
# real path — check `docker volume inspect autoflow_caddy_logs`):
#   bash scripts/count-downloads.sh /var/lib/docker/volumes/autoflow_caddy_logs/_data/downloads-access.log
#
# Counts only successful (2xx) GET requests, and only requests for an actual
# file (ignores directory listing / trailing-slash requests). Caddy's
# roll_keep setting (see Caddyfile) rotates old logs — this only reflects
# what's still in the currently-kept files, not all-time totals since launch.
#
# Requires: jq (apt-get install -y jq, if not already present)

set -euo pipefail

if ! command -v jq &>/dev/null; then
    echo "ERROR: jq is required but not installed. Run: sudo apt-get install -y jq" >&2
    exit 1
fi

# Read from a file argument if given, otherwise from stdin.
if [ "${1:-}" != "" ]; then
    INPUT="$1"
else
    INPUT="/dev/stdin"
fi

# Every line in this log file is already scoped to the /files/* handle
# block (it has its own dedicated `log` directive in the Caddyfile) — no
# need to filter by logger name, just by method/status/path.
echo "── Download counts (successful GET requests) ──"
jq -r '
  select(.request.method == "GET")
  | select(.status >= 200 and .status < 300)
  | .request.uri
' "$INPUT" 2>/dev/null \
  | sed -E 's#^/files/##' \
  | grep -v '/$' \
  | grep -v '^$' \
  | sort \
  | uniq -c \
  | sort -rn
