#!/usr/bin/env bash
# setup-staging.sh - One-time setup for Squire staging environment
#
# Usage: sudo bash /opt/squire/scripts/setup-staging.sh
#
# Creates /opt/squire-staging as a working copy of the production codebase.
# Claude Code will make changes here, then self-deploy.sh handles the swap.

set -euo pipefail

PRODUCTION="/opt/squire"
STAGING="/opt/squire-staging"

log() { echo "[setup] $1"; }

assert_no_nested_artifacts() {
  local root="$1"
  local label="$2"
  local found=0

  for rel in src/src schema/schema dist/dist; do
    if [ -e "$root/$rel" ]; then
      log "ERROR: Found nested rollback artifact in $label: $root/$rel"
      found=1
    fi
  done

  if [ "$found" -ne 0 ]; then
    exit 1
  fi
}

if [ -d "$STAGING" ] && [ -f "$STAGING/package.json" ]; then
  log "Staging already exists. Refreshing from production..."
else
  log "Creating staging directory..."
  mkdir -p "$STAGING"
fi

# Sync from production (excluding runtime/state files)
log "Syncing from production..."
rsync -a --delete \
  --exclude='.env' \
  --exclude='/storage' \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='web/node_modules' \
  --exclude='web/.next' \
  --exclude='debug-images' \
  --exclude='squire-video' \
  --exclude='claude-desktop-memories' \
  --exclude='*.jsonl' \
  "$PRODUCTION/" "$STAGING/"

assert_no_nested_artifacts "$STAGING" "staging"

# Copy .env for builds (smoke test needs it)
cp "$PRODUCTION/.env" "$STAGING/.env"

# Install dependencies
log "Installing dependencies..."
cd "$STAGING"
npm install

# Install web dependencies if web exists
if [ -d "$STAGING/web" ] && [ -f "$STAGING/web/package.json" ]; then
  log "Installing web dependencies..."
  cd "$STAGING/web"
  if [ -f "pnpm-lock.yaml" ]; then
    pnpm install
  else
    npm install
  fi
fi

# Set ownership
chown -R ridgetop:ridgetop "$STAGING"

log ""
log "=== Staging ready ==="
log "  Path:    $STAGING"
log "  Usage:   Claude Code works here, then runs self-deploy.sh"
log ""
log "  To refresh staging from production:"
log "    sudo bash $PRODUCTION/scripts/setup-staging.sh"
