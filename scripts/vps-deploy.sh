#!/bin/bash
# ── VPS Deploy Script ─────────────────────────────────────────────────────────
#
# Pulls the latest images and recreates the api and nextjs containers in-place.
# All other containers (caddy, redis, n8n) are left untouched.
#
# Required env vars (set by Jenkins):
#   IMAGE_TAG    — Git SHA short (e.g. a1b2c3d4) or 'latest'
#   REGISTRY     — Docker Hub registry (e.g. ikcloudky6/automation)
#
# Required files (copied by Jenkins before this script runs):
#   /tmp/api.env     — all env vars for the api container
#   /tmp/nextjs.env  — all env vars for the nextjs container
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGISTRY="${REGISTRY:-ikcloudky6/automation}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

API_IMAGE="${REGISTRY}:api-${IMAGE_TAG}"
DASHBOARD_IMAGE="${REGISTRY}:dashboard-${IMAGE_TAG}"

# ── Validate env files ────────────────────────────────────────────────────────
if [ ! -s /tmp/api.env ]; then
    echo "ERROR: /tmp/api.env is missing or empty — aborting deploy"
    exit 1
fi

if [ ! -s /tmp/nextjs.env ]; then
    echo "ERROR: /tmp/nextjs.env is missing or empty — aborting deploy"
    exit 1
fi

# ── Pull images ───────────────────────────────────────────────────────────────
echo "==> Pulling images: ${API_IMAGE} and ${DASHBOARD_IMAGE}"
docker pull "${API_IMAGE}"
docker pull "${DASHBOARD_IMAGE}"

# ── Recreate API container ────────────────────────────────────────────────────
echo "==> Recreating api container..."

docker stop api 2>/dev/null || true
docker rm   api 2>/dev/null || true

docker run -d \
    --name api \
    --network autoflow_internal \
    --network autoflow_public \
    --restart always \
    --env-file /tmp/api.env \
    --health-cmd "wget -q --spider http://127.0.0.1:3001/health || exit 1" \
    --health-interval=30s \
    --health-timeout=5s \
    --health-retries=3 \
    --health-start-period=20s \
    "${API_IMAGE}"

echo "==> api container started"

# ── Recreate nextjs (dashboard) container ────────────────────────────────────
echo "==> Recreating nextjs container..."

docker stop nextjs 2>/dev/null || true
docker rm   nextjs 2>/dev/null || true

docker run -d \
    --name nextjs \
    --network autoflow_internal \
    --network autoflow_public \
    --restart always \
    --env-file /tmp/nextjs.env \
    --health-cmd "wget -q --spider http://127.0.0.1:3000 || exit 1" \
    --health-interval=30s \
    --health-timeout=5s \
    --health-retries=3 \
    --health-start-period=25s \
    "${DASHBOARD_IMAGE}"

echo "==> nextjs container started"

# ── Cleanup ───────────────────────────────────────────────────────────────────
docker image prune -f
rm -f /tmp/api.env /tmp/nextjs.env

echo "==> Deploy complete: ${IMAGE_TAG}"
