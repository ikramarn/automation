#!/bin/bash
# ── VPS Initial Setup Script ──────────────────────────────────────────────────
#
# Run once on a fresh Ubuntu 26.04 VPS (one.com Cloud or similar), as a
# sudo-enabled non-root user (e.g. "administrator").
# Usage: sudo bash vps-setup.sh
#
# What this does:
#   1. Updates system packages
#   2. Installs Docker + Docker Compose plugin
#   3. Installs Caddy (reverse proxy + auto SSL)
#   4. Creates app directory structure
#   5. Sets up firewall (UFW)
#   6. Adds Jenkins SSH deploy user

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run with sudo (sudo bash vps-setup.sh)." >&2
    exit 1
fi

# The invoking non-root user (via sudo) — falls back to "administrator" if run
# as a true root login (e.g. some older VPS images). This user gets added to
# the docker group so you can run docker without sudo after re-login.
INVOKING_USER="${SUDO_USER:-administrator}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AutoFlow AI — VPS Setup"
echo "  Invoking user: ${INVOKING_USER}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System update ──────────────────────────────────────────────────────────
echo "[1/6] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw gnupg

# ── 2. Docker ─────────────────────────────────────────────────────────────────
echo "[2/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Add the invoking user to the docker group (effective after next login)
usermod -aG docker "$INVOKING_USER" || true

# ── 3. Caddy ──────────────────────────────────────────────────────────────────
# NOTE: Caddy runs as a DOCKER CONTAINER (see docker-compose.prod.yml's
# `caddy` service), not as a native systemd package. This is deliberate:
# Caddy must resolve api:3001 / nextjs:3000 as Docker-network service names
# (see ./Caddyfile), which only works from inside the same Docker network —
# a host-level systemd Caddy process cannot reach those names at all.
# This step is a no-op; kept only so firewall/directory setup below still
# runs standalone. Do NOT `apt-get install caddy` on this box.
echo "[3/6] Caddy will run as a Docker container (see docker-compose.prod.yml) — skipping native install."

# ── 4. App directory structure ────────────────────────────────────────────────
echo "[4/6] Creating app directory..."
mkdir -p /opt/autoflow
mkdir -p /opt/autoflow/logs
chown -R "$INVOKING_USER:$INVOKING_USER" /opt/autoflow

# ── 5. Firewall ───────────────────────────────────────────────────────────────
echo "[5/6] Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh        # port 22
ufw allow http       # port 80  (Caddy — redirects to HTTPS)
ufw allow https      # port 443 (Caddy — main entry point)
# Tailscale interface — allow all traffic from Tailscale network (if used)
ufw allow in on tailscale0 2>/dev/null || true
ufw --force enable
echo "Firewall status:"
ufw status

# ── 6. Jenkins deploy user ────────────────────────────────────────────────────
echo "[6/6] Creating jenkins deploy user..."
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
    mkdir -p /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    # Jenkins will add its public key here:
    touch /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown -R deploy:deploy /home/deploy/.ssh
fi

# Give deploy user access to app directory
chown -R deploy:deploy /opt/autoflow

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Add Jenkins SSH public key to /home/deploy/.ssh/authorized_keys"
echo "  2. Copy your .env.prod file to /opt/autoflow/.env.prod"
echo "  3. Copy docker-compose.yml, docker-compose.prod.yml, Caddyfile to /opt/autoflow"
echo "  4. Run: cd /opt/autoflow && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d"
echo "  5. Log out and back in as ${INVOKING_USER} for docker group membership to take effect"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
