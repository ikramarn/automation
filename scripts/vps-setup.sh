#!/bin/bash
# ── VPS Initial Setup Script ──────────────────────────────────────────────────
#
# Run once on a fresh Hostinger KVM 2 Ubuntu 22.04 VPS.
# Usage: bash vps-setup.sh
#
# What this does:
#   1. Updates system packages
#   2. Installs Docker + Docker Compose plugin
#   3. Installs Caddy (reverse proxy + auto SSL)
#   4. Creates app directory structure
#   5. Sets up firewall (UFW)
#   6. Adds Jenkins SSH deploy user

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AutoFlow AI — VPS Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. System update ──────────────────────────────────────────────────────────
echo "[1/6] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw

# ── 2. Docker ─────────────────────────────────────────────────────────────────
echo "[2/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Add current user to docker group
usermod -aG docker "$USER" || true

# ── 3. Caddy ──────────────────────────────────────────────────────────────────
echo "[3/6] Installing Caddy..."
if ! command -v caddy &>/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
fi

# ── 4. App directory structure ────────────────────────────────────────────────
echo "[4/6] Creating app directory..."
mkdir -p /opt/autoflow
mkdir -p /opt/autoflow/logs
chown -R "$USER:$USER" /opt/autoflow

# ── 5. Firewall ───────────────────────────────────────────────────────────────
echo "[5/6] Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh        # port 22
ufw allow http       # port 80  (Caddy — redirects to HTTPS)
ufw allow https      # port 443 (Caddy — main entry point)
# Tailscale interface — allow all traffic from Tailscale network
ufw allow in on tailscale0
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
echo "  3. Set DOMAIN env var and start Caddy"
echo "  4. Run: cd /opt/autoflow && docker compose up -d"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
