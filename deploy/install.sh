#!/usr/bin/env bash
set -euo pipefail
# Install family portal on a Linux LAN device (Debian/Ubuntu-like).
# Run as root. Review before use.

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="/opt/family-site"
CFG_DIR="/etc/family-portal"
DATA_BACKUP="/var/backups/family-portal"
USER_NAME="familyportal"

echo "[1/6] Create user"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home "$DEST" --shell /usr/sbin/nologin "$USER_NAME"
fi

echo "[2/6] Copy files"
mkdir -p "$DEST" "$CFG_DIR" "$DATA_BACKUP"
rsync -a --delete --exclude '.git' --exclude '__pycache__' --exclude '*.pyc' "$SRC_DIR/" "$DEST/"
chown -R "$USER_NAME:$USER_NAME" "$DEST"

echo "[3/6] Init users file if missing"
if [ ! -f "$CFG_DIR/users.json" ]; then
  echo "Create users.json manually:"
  echo "  python3 $DEST/portal_server.py init-users --users-file $CFG_DIR/users.json"
  echo "  python3 $DEST/portal_server.py set-password --users-file $CFG_DIR/users.json --user admin --password-stdin"
fi

echo "[4/6] Install systemd service"
cp "$DEST/deploy/family-portal.service" /etc/systemd/system/family-portal.service
systemctl daemon-reload
systemctl enable --now family-portal.service

echo "[5/6] Status"
systemctl --no-pager --full status family-portal.service | sed -n '1,25p'

echo "[6/6] Done"
echo "Open: http://<LAN-IP>:8787/"
echo "For HTTPS, put nginx/caddy in front and set FAMILY_SECURE_COOKIE=1."
