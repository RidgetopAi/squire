#!/usr/bin/env bash
# self-rollback.sh - Manual rollback to last backup
#
# Usage: sudo bash /opt/squire/scripts/self-rollback.sh
#
# Restores /opt/squire from /opt/squire-backup (created by self-deploy.sh)

set -euo pipefail

PRODUCTION="/opt/squire"
BACKUP="/opt/squire-backup"
DEPLOY_LOG="/var/log/squire-deploy.log"

log() { echo "[rollback] $(date '+%H:%M:%S') $1"; }

APP_USER=$(stat -c '%U' "$PRODUCTION")
APP_GROUP=$(stat -c '%G' "$PRODUCTION")

[ -d "$BACKUP/dist" ] || { log "ERROR: No backup found at $BACKUP"; exit 1; }

log "Rolling back to backup..."

cp -a "$BACKUP/dist/" "$PRODUCTION/dist/"
cp "$BACKUP/package.json" "$PRODUCTION/package.json"
cp "$BACKUP/tsconfig.json" "$PRODUCTION/tsconfig.json"
[ -d "$BACKUP/src" ] && cp -a "$BACKUP/src/" "$PRODUCTION/src/"
[ -d "$BACKUP/schema" ] && cp -a "$BACKUP/schema/" "$PRODUCTION/schema/"
[ -f "$BACKUP/scripts/self-deploy.sh" ] && cp "$BACKUP/scripts/self-deploy.sh" "$PRODUCTION/scripts/self-deploy.sh"
[ -f "$BACKUP/scripts/setup-staging.sh" ] && cp "$BACKUP/scripts/setup-staging.sh" "$PRODUCTION/scripts/setup-staging.sh"
[ -f "$BACKUP/scripts/self-rollback.sh" ] && cp "$BACKUP/scripts/self-rollback.sh" "$PRODUCTION/scripts/self-rollback.sh"

# Normalize ownership
chown -R "$APP_USER:$APP_GROUP" "$PRODUCTION/dist"
chown "$APP_USER:$APP_GROUP" "$PRODUCTION/package.json"
chown "$APP_USER:$APP_GROUP" "$PRODUCTION/tsconfig.json"
[ -d "$PRODUCTION/src" ] && chown -R "$APP_USER:$APP_GROUP" "$PRODUCTION/src"
[ -d "$PRODUCTION/schema" ] && chown -R "$APP_USER:$APP_GROUP" "$PRODUCTION/schema"
[ -d "$PRODUCTION/scripts" ] && chown -R "$APP_USER:$APP_GROUP" "$PRODUCTION/scripts"

log "Restarting Squire..."
systemctl restart squire

sleep 5

if curl -sf "http://localhost:3001/api/health" > /dev/null 2>&1; then
  log "✓ Rollback successful - Squire is healthy"
  echo "$(date '+%Y-%m-%d %H:%M:%S') Manual rollback successful" >> "$DEPLOY_LOG"
else
  log "✗ Squire still unhealthy after rollback"
  log "  Check: journalctl -u squire -n 50"
  echo "$(date '+%Y-%m-%d %H:%M:%S') Manual rollback - health check failed" >> "$DEPLOY_LOG"
  exit 1
fi
