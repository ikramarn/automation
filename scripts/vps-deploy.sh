#!/bin/bash
# ── VPS Deploy Script ─────────────────────────────────────────────────────────
#
# Pulls the latest images and recreates the api and nextjs containers in-place.
# All other containers (caddy, redis, n8n) are left untouched.
#
# Required env vars (set by Jenkins):
#   IMAGE_TAG  — Git SHA short (e.g. a1b2c3d4) or 'latest'
#   REGISTRY   — Docker Hub registry (e.g. ikcloudky6/automation)
#
# Usage:
#   IMAGE_TAG=a1b2c3d4 REGISTRY=ikcloudky6/automation bash vps-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REGISTRY="${REGISTRY:-ikcloudky6/automation}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

API_IMAGE="${REGISTRY}:api-${IMAGE_TAG}"
DASHBOARD_IMAGE="${REGISTRY}:dashboard-${IMAGE_TAG}"

echo "==> Pulling images: ${API_IMAGE} and ${DASHBOARD_IMAGE}"
docker pull "${API_IMAGE}"
docker pull "${DASHBOARD_IMAGE}"

# ── Recreate API container ────────────────────────────────────────────────────
echo "==> Recreating api container..."

# Snapshot env vars from the currently running container so nothing is lost
if docker inspect api &>/dev/null; then
    docker inspect api --format='{{range .Config.Env}}-e "{{.}}" {{end}}' > /tmp/api-env.txt
    docker stop api
    docker rm api
else
    echo "WARNING: No running api container found — skipping env snapshot"
    touch /tmp/api-env.txt
fi

eval docker run -d \
    --name api \
    --network autoflow_internal \
    --network autoflow_public \
    --restart always \
    $(cat /tmp/api-env.txt) \
    --health-cmd "wget -qO- http://127.0.0.1:3001/health" \
    --health-interval=30s \
    --health-timeout=5s \
    --health-retries=3 \
    --health-start-period=20s \
    "${API_IMAGE}"

echo "==> api container started"

# ── Recreate nextjs (dashboard) container ────────────────────────────────────
echo "==> Recreating nextjs container..."

if docker inspect nextjs &>/dev/null; then
    docker inspect nextjs --format='{{range .Config.Env}}-e "{{.}}" {{end}}' > /tmp/nextjs-env.txt
    docker stop nextjs
    docker rm nextjs
else
    echo "WARNING: No running nextjs container found — skipping env snapshot"
    touch /tmp/nextjs-env.txt
fi

eval docker run -d \
    --name nextjs \
    --network autoflow_internal \
    --network autoflow_public \
    --restart always \
    $(cat /tmp/nextjs-env.txt) \
    --health-cmd "wget -qO- http://127.0.0.1:3000/api/health" \
    --health-interval=30s \
    --health-timeout=5s \
    --health-retries=3 \
    --health-start-period=25s \
    "${DASHBOARD_IMAGE}"

echo "==> nextjs container started"

# ── Cleanup ───────────────────────────────────────────────────────────────────
docker image prune -f
rm -f /tmp/api-env.txt /tmp/nextjs-env.txt

echo "==> Deploy complete: ${IMAGE_TAG}"
