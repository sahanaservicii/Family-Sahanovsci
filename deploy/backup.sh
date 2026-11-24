#!/usr/bin/env bash
set -euo pipefail
# Backup family portal data (users, site data, photos).
# Usage: ./backup.sh [/path/to/backup-dir]

SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-/var/backups/family-portal}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/family-portal-$TS"
USERS_FILE="${FAMILY_USERS_FILE:-/etc/family-portal/users.json}"

mkdir -p "$DEST"
cp -a "$SITE_DIR/assets/site-data.json" "$DEST/" 2>/dev/null || true
cp -a "$SITE_DIR/assets/data.js" "$DEST/" 2>/dev/null || true
cp -a "$SITE_DIR/assets/photos" "$DEST/photos" 2>/dev/null || true
[ -f "$USERS_FILE" ] && cp -a "$USERS_FILE" "$DEST/users.json"
# Do not copy initial plain passwords file by default.

tar -C "$OUT_DIR" -czf "$DEST.tar.gz" "$(basename "$DEST")"
rm -rf "$DEST"
echo "$DEST.tar.gz"
