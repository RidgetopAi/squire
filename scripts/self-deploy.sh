#!/usr/bin/env bash
# self-deploy.sh - Blue-green self-deployment for Squire
#
# Usage: bash /opt/squire/scripts/self-deploy.sh [--skip-web] [--dry-run] [--allow-large-diff]
#
# Called by Squire's agent after making changes in /opt/squire-staging.
#
# Workflow:
#   1. Acquire deploy lock (prevent concurrent deploys)
#   2. Stale-staging drift check (abort if staging carries unrelated drift)
#   3. Build TypeScript in staging
#   4. Smoke test staging API on temp port
#   5. Backup current production dist
#   6. Sync staging → production
#   7. Schedule independent restart + verify + auto-rollback
#
# The restart runs in a separate systemd unit (survives Squire's death).
# If production doesn't come back healthy, it auto-rolls back.
#
# Env vars:
#   MAX_DRIFT_FILES  (default 20) — drift-check threshold for source files
#                                   differing between staging and production.

set -euo pipefail

STAGING="/opt/squire-staging"
PRODUCTION="/opt/squire"
BACKUP="/opt/squire-backup"
TEST_PORT=3099
HEALTH_TIMEOUT=30
PROD_PORT=3001
DEPLOY_LOG="/var/log/squire-deploy.log"
LOCK_FILE="/tmp/squire-deploy.lock"

SKIP_WEB=false
DRY_RUN=false
ALLOW_LARGE_DIFF=false

for arg in "$@"; do
  case $arg in
    --skip-web) SKIP_WEB=true ;;
    --dry-run) DRY_RUN=true ;;
    --allow-large-diff) ALLOW_LARGE_DIFF=true ;;
  esac
done

log() { echo "[deploy] $(date '+%H:%M:%S') $1"; }
die() { log "ERROR: $1"; exit 1; }

# Detect the owner of production to use for backup normalization
PROD_OWNER=$(stat -c '%U' "$PRODUCTION" 2>/dev/null || echo "ridgetop")
PROD_GROUP=$(stat -c '%G' "$PRODUCTION" 2>/dev/null || echo "ridgetop")

# normalize_ownership - Recursively chown a directory to the production owner.
# This ensures backups created by root can be cleaned up in subsequent deploys.
normalize_ownership() {
  local target="$1"
  if [ ! -e "$target" ]; then
    return 0
  fi
  # Only attempt chown if running as root or with sudo
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    chown -R "$PROD_OWNER:$PROD_GROUP" "$target" 2>/dev/null || true
  elif sudo -n chown -R "$PROD_OWNER:$PROD_GROUP" "$target" 2>/dev/null; then
    : # success via sudo
  else
    log "  WARN: Could not normalize ownership of $target (non-root, no passwordless sudo for chown)"
  fi
}

# safe_backup_cleanup - Remove backup contents, handling mixed ownership gracefully.
# The backup may contain root-owned files from previous deploys.
safe_backup_cleanup() {
  local target="$1"
  if [ ! -d "$target" ]; then
    return 0
  fi

  # Check if there's anything to clean
  if [ -z "$(ls -A "$target" 2>/dev/null)" ]; then
    return 0
  fi

  # First, try to normalize ownership so regular rm works
  normalize_ownership "$target"

  # Now try to remove contents
  if find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null; then
    return 0
  fi

  # If that failed, try with sudo rm
  if sudo -n find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null; then
    log "  Cleaned backup via sudo (mixed ownership detected)"
    return 0
  fi

  # Last resort: use systemd-run to clean as root (we have sudo access to systemd-run)
  log "  Using systemd-run to clean backup (mixed ownership, limited sudo)"
  local cleanup_unit="squire-backup-cleanup-$$"
  if sudo -n /usr/bin/systemd-run --unit="$cleanup_unit" --wait \
      bash -c "find '$target' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +" 2>/dev/null; then
    # Reset any failed state
    sudo -n /usr/bin/systemctl reset-failed "$cleanup_unit.service" 2>/dev/null || true
    return 0
  fi

  die "Cannot clean backup directory $target - all cleanup methods failed"
}

SYSTEMD_RUN=(systemd-run)
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  if sudo -n /usr/bin/systemd-run --version >/dev/null 2>&1; then
    SYSTEMD_RUN=(sudo -n /usr/bin/systemd-run)
  else
    die "systemd-run requires root or passwordless sudo for the restart handoff"
  fi
fi

# --- Step 0a: Git pre-flight ---
# The auto-commit block runs under systemd-run as root, which triggers git's
# "dubious ownership" safety check and makes `git status` print to stderr and
# return empty stdout. If we don't catch that here, the deploy proceeds and
# silently skips committing live changes — which is exactly how two days of
# uncommitted tool-call fixes lived in /opt/squire on 2026-04-16 → 2026-04-18.
#
# Fail fast: probe the repo the same way the systemd-run block will.
log "[0/5] Git pre-flight..."
GIT_PROBE_OUT=$(cd "$PRODUCTION" && git status --porcelain 2>&1) || true
if echo "$GIT_PROBE_OUT" | grep -q "dubious ownership"; then
  die "git refuses to read $PRODUCTION (dubious ownership). Fix: git config --global --add safe.directory $PRODUCTION && git config --global --add safe.directory $STAGING"
fi
if ! (cd "$PRODUCTION" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  die "$PRODUCTION is not a git working tree — auto-commit cannot run"
fi
log "✓ Git pre-flight passed"

# --- Step 0: Deploy lock ---
# Prevent concurrent deploys. Lock auto-expires after 5 minutes (stale protection).
if [ -f "$LOCK_FILE" ]; then
  lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE") ))
  if [ "$lock_age" -lt 300 ]; then
    log "Deploy already in progress (lock age: ${lock_age}s). Skipping."
    log "If stuck, remove: rm $LOCK_FILE"
    exit 0
  else
    log "Stale lock detected (${lock_age}s old). Removing."
    rm -f "$LOCK_FILE"
  fi
fi

# Check if a deploy-restart unit is already running
if systemctl is-active squire-deploy-restart.service >/dev/null 2>&1; then
  log "Deploy restart already in progress (squire-deploy-restart.service active). Skipping."
  exit 0
fi

# Acquire lock
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# Verify staging exists
[ -d "$STAGING" ] || die "Staging not found. Run: sudo bash /opt/squire/scripts/setup-staging.sh"
[ -f "$STAGING/package.json" ] || die "Staging doesn't look like a Squire project"
[ -d "$STAGING/node_modules" ] || die "Staging missing node_modules. Run: cd $STAGING && npm install"

log "=== Squire Self-Deploy ==="

# --- Pre-flight: stale-staging drift check ---
# Catches the failure mode from Lesson 009: if staging carries drift
# unrelated to the current task, this deploy would auto-commit it along
# with the intended change. Aborts unless --allow-large-diff is passed
# or MAX_DRIFT_FILES is raised.
log "[0/5] Drift check (staging vs production)..."
DRIFT_FILES=0
DRIFT_SAMPLE_FILE=$(mktemp)
trap 'rm -f "$LOCK_FILE" "$DRIFT_SAMPLE_FILE"' EXIT

# Compare tracked source paths: src/, schema/, web/src/
for path in src schema web/src; do
  if [ -d "$STAGING/$path" ] && [ -d "$PRODUCTION/$path" ]; then
    n=$(diff -rq "$STAGING/$path" "$PRODUCTION/$path" 2>/dev/null | tee -a "$DRIFT_SAMPLE_FILE" | wc -l || true)
    DRIFT_FILES=$((DRIFT_FILES + n))
  fi
done

MAX_DRIFT_FILES="${MAX_DRIFT_FILES:-20}"

if [ "$DRIFT_FILES" -gt "$MAX_DRIFT_FILES" ] && [ "$ALLOW_LARGE_DIFF" != "true" ]; then
  log "✗ Drift check FAILED: $DRIFT_FILES files differ (threshold: $MAX_DRIFT_FILES)"
  log ""
  log "  Sample of drifted files (first 15):"
  head -15 "$DRIFT_SAMPLE_FILE" | sed 's/^/    /' | while IFS= read -r line; do log "$line"; done
  log ""
  log "  This usually means staging was not refreshed before edits started."
  log "  To recover:"
  log "    1. Save in-flight edits from $STAGING to /tmp/squire-edits/ (or elsewhere safe)"
  log "    2. sudo bash $PRODUCTION/scripts/setup-staging.sh"
  log "    3. Reapply your saved edits to $STAGING"
  log "    4. Re-run this deploy"
  log ""
  log "  Bypass (verified large refactor):"
  log "    sudo bash $PRODUCTION/scripts/self-deploy.sh --allow-large-diff"
  log ""
  log "  Or raise threshold for one run:"
  log "    sudo MAX_DRIFT_FILES=100 bash $PRODUCTION/scripts/self-deploy.sh"
  die "aborting deploy due to suspicious staging drift"
fi
log "✓ Drift check passed ($DRIFT_FILES files differ from production)"

# --- Step 1: Build ---
log "[1/5] Building TypeScript in staging..."
cd "$STAGING"
npx tsc || die "TypeScript build failed"
log "✓ Build successful"

# --- Step 2: Smoke test ---
log "[2/5] Smoke test on port $TEST_PORT..."

# Ensure .env is available for smoke test (use production .env)
cp "$PRODUCTION/.env" "$STAGING/.env" 2>/dev/null || true

# Kill any leftover test server
fuser -k "$TEST_PORT/tcp" 2>/dev/null || true
sleep 1

# Start staging API on test port
PORT=$TEST_PORT node dist/api/server.js &
SMOKE_PID=$!

# Wait for healthy response
HEALTHY=false
for i in $(seq 1 $HEALTH_TIMEOUT); do
  if curl -sf "http://localhost:$TEST_PORT/api/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

# Kill smoke test server
kill $SMOKE_PID 2>/dev/null || true
wait $SMOKE_PID 2>/dev/null || true

[ "$HEALTHY" = "true" ] || die "Smoke test failed - API didn't respond healthy within ${HEALTH_TIMEOUT}s"
log "✓ Smoke test passed"

# --- Dry run exit ---
if [ "$DRY_RUN" = "true" ]; then
  log "DRY RUN complete - would sync and restart. Exiting."
  exit 0
fi

# --- Step 3: Backup production ---
log "[3/5] Backing up current production..."
mkdir -p "$BACKUP"
safe_backup_cleanup "$BACKUP"
cp -a "$PRODUCTION/dist" "$BACKUP/dist"
cp "$PRODUCTION/package.json" "$BACKUP/package.json"
cp "$PRODUCTION/tsconfig.json" "$BACKUP/tsconfig.json"
[ -d "$PRODUCTION/src" ] && cp -a "$PRODUCTION/src" "$BACKUP/src"
[ -d "$PRODUCTION/schema" ] && cp -a "$PRODUCTION/schema" "$BACKUP/schema"
[ -d "$PRODUCTION/scripts" ] && mkdir -p "$BACKUP/scripts" && cp "$PRODUCTION/scripts/self-deploy.sh" "$BACKUP/scripts/self-deploy.sh" 2>/dev/null || true
[ -d "$PRODUCTION/scripts" ] && cp "$PRODUCTION/scripts/setup-staging.sh" "$BACKUP/scripts/setup-staging.sh" 2>/dev/null || true
[ -d "$PRODUCTION/scripts" ] && cp "$PRODUCTION/scripts/self-rollback.sh" "$BACKUP/scripts/self-rollback.sh" 2>/dev/null || true
normalize_ownership "$BACKUP"
log "✓ Backup saved to $BACKUP"

# --- Step 4: Sync to production ---
log "[4/5] Syncing staging → production..."

# Sync compiled output
rsync -a --no-owner --no-group --delete "$STAGING/dist/" "$PRODUCTION/dist/"

# Sync source (for future builds from production)
rsync -a --no-owner --no-group --delete "$STAGING/src/" "$PRODUCTION/src/"

# Sync database schema migrations. Migrations are code: deploy must copy
# and apply them before the restarted app serves schema-dependent queries.
rsync -a --no-owner --no-group --delete "$STAGING/schema/" "$PRODUCTION/schema/"

# Sync managed deploy scripts without deleting unrelated operational helpers.
for managed_script in self-deploy.sh setup-staging.sh self-rollback.sh; do
  if [ -f "$STAGING/scripts/$managed_script" ]; then
    cp "$STAGING/scripts/$managed_script" "$PRODUCTION/scripts/$managed_script"
    chmod +x "$PRODUCTION/scripts/$managed_script" 2>/dev/null || true
  fi
done

# Sync project config
cp "$STAGING/package.json" "$PRODUCTION/package.json"
if [ -f "$STAGING/package-lock.json" ]; then
  cp "$STAGING/package-lock.json" "$PRODUCTION/package-lock.json"
fi
cp "$STAGING/tsconfig.json" "$PRODUCTION/tsconfig.json"

# If package.json dependencies changed, install
if ! diff -q "$BACKUP/package.json" "$PRODUCTION/package.json" > /dev/null 2>&1; then
  log "  package.json changed - running npm install..."
  cd "$PRODUCTION" && npm install --omit=dev
fi

# Sync web if applicable
if [ "$SKIP_WEB" = "false" ] && [ -d "$STAGING/web/src" ]; then
  STAGING_WEB_HASH=$(find "$STAGING/web/src" -type f -exec md5sum {} + 2>/dev/null | sort | md5sum | cut -d' ' -f1)
  PROD_WEB_BUILD_HASH=""
  [ -f "$PRODUCTION/web/.next/squire-source-hash" ] && PROD_WEB_BUILD_HASH=$(cat "$PRODUCTION/web/.next/squire-source-hash")

  if [ "$STAGING_WEB_HASH" != "$PROD_WEB_BUILD_HASH" ]; then
    log "  Web build stale or changed - syncing and rebuilding..."
    rsync -a --no-owner --no-group --delete \
      --exclude='node_modules' \
      --exclude='.next' \
      "$STAGING/web/" "$PRODUCTION/web/"
    cd "$PRODUCTION/web"
    if [ -f "pnpm-lock.yaml" ]; then
      pnpm install && pnpm build
    else
      npm install && npm run build
    fi
    echo "$STAGING_WEB_HASH" > "$PRODUCTION/web/.next/squire-source-hash"
  fi
fi

log "✓ Synced to production"

# Normalize production ownership to prevent permission issues on subsequent deploys
log "  Normalizing production file ownership..."
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  chown -R "$PROD_OWNER:$PROD_GROUP" "$PRODUCTION/dist" "$PRODUCTION/src" "$PRODUCTION/schema" "$PRODUCTION/scripts" 2>/dev/null || true
elif sudo -n /usr/bin/systemd-run --unit="squire-normalize-prod-$$" --wait \
    bash -c "chown -R '$PROD_OWNER:$PROD_GROUP' '$PRODUCTION/dist' '$PRODUCTION/src' '$PRODUCTION/schema' '$PRODUCTION/scripts'" 2>/dev/null; then
  sudo -n /usr/bin/systemctl reset-failed "squire-normalize-prod-$$.service" 2>/dev/null || true
else
  log "  WARN: Could not normalize production ownership (non-critical)"
fi

log "  Running production database migrations..."
cd "$PRODUCTION"
node dist/db/migrate.js || die "Production database migrations failed"
log "  ✓ Production migrations applied"

# --- Step 5: Schedule restart (independent of Squire's cgroup) ---
log "[5/5] Scheduling restart with health verification..."

# Stop any leftover deploy-restart unit from a previous failed deploy
systemctl stop squire-deploy-restart.service 2>/dev/null || true
systemctl reset-failed squire-deploy-restart.service 2>/dev/null || true

# The restart + verify + rollback all happen in a separate systemd transient unit.
# This survives Squire's own process being killed during restart.
# Uses --on-active=1 to start after 1 second delay.
if ! "${SYSTEMD_RUN[@]}" --unit=squire-deploy-restart --no-block \
  bash -c "
    sleep 2
    echo \"\$(date '+%Y-%m-%d %H:%M:%S') Starting restart...\" >> $DEPLOY_LOG

    # Graceful stop — SIGTERM lets in-flight DB writes finish (shutdown drains pool)
    systemctl kill -s SIGTERM squire
    sleep 15
    # If still alive after 15s, force kill
    if systemctl is-active squire.service >/dev/null 2>&1; then
      echo \"\$(date '+%Y-%m-%d %H:%M:%S') WARN: squire still alive after 15s, sending SIGKILL\" >> $DEPLOY_LOG
      systemctl kill -s SIGKILL squire
      sleep 1
    fi
    systemctl start squire
    systemctl restart squire-web

    # Wait for production to come back healthy
    HEALTHY=false
    for i in \$(seq 1 $HEALTH_TIMEOUT); do
      if curl -sf http://localhost:$PROD_PORT/api/health > /dev/null 2>&1; then
        HEALTHY=true
        break
      fi
      sleep 1
    done

    if [ \"\$HEALTHY\" = \"true\" ]; then
      echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✓ Deploy verified healthy\" >> $DEPLOY_LOG

      # Auto-commit and push changes to git.
      # Must work under systemd-run's environment — git's 'dubious ownership'
      # check used to silently return empty here, which caused two days of
      # fixes to go unversioned (2026-04-16 → 2026-04-18). Now we:
      #   (a) surface any git error to the deploy log rather than swallowing
      #       it via \$(...)
      #   (b) use 'git status --porcelain -- <managed paths>' so new source
      #       files are included without sweeping up env backups/secrets
      #   (c) if git can't read the repo at all, log a loud WARN
      cd $PRODUCTION
      GIT_PROBE=\$(git status --porcelain 2>&1)
      GIT_RC=\$?
      if [ \$GIT_RC -ne 0 ] || echo \"\$GIT_PROBE\" | grep -q 'dubious ownership'; then
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✗ WARN Git unreadable from deploy unit: \$GIT_PROBE\" >> $DEPLOY_LOG
        echo \"\$(date '+%Y-%m-%d %H:%M:%S')   Fix: git config --global --add safe.directory $PRODUCTION\" >> $DEPLOY_LOG
      else
        DEPLOY_CHANGES=\$(git status --porcelain -- src schema scripts/self-deploy.sh scripts/setup-staging.sh scripts/self-rollback.sh package.json package-lock.json tsconfig.json web .env.example 2>>$DEPLOY_LOG)
      fi

      if [ \$GIT_RC -ne 0 ] || echo \"\$GIT_PROBE\" | grep -q 'dubious ownership'; then
        :
      elif [ -n \"\$DEPLOY_CHANGES\" ]; then
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') Git: committing deploy changes...\" >> $DEPLOY_LOG
        git add -A -- src schema scripts/self-deploy.sh scripts/setup-staging.sh scripts/self-rollback.sh package.json package-lock.json tsconfig.json web .env.example 2>>$DEPLOY_LOG
        SUMMARY=\$(git diff --cached --stat | tail -1)
        if git commit -m \"auto-deploy: \$(date '+%Y-%m-%d %H:%M:%S')

\$SUMMARY

Deployed by Squire self-deploy pipeline.\" >>$DEPLOY_LOG 2>&1; then
          git push origin main >>$DEPLOY_LOG 2>&1 && \
            echo \"\$(date '+%Y-%m-%d %H:%M:%S') Git: pushed to origin\" >> $DEPLOY_LOG || \
            echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✗ WARN Git push failed (commit landed locally)\" >> $DEPLOY_LOG
        else
          echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✗ WARN Git commit failed\" >> $DEPLOY_LOG
        fi
      else
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') Git: working tree matches HEAD — nothing to commit\" >> $DEPLOY_LOG
      fi
    else
      echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✗ UNHEALTHY - rolling back\" >> $DEPLOY_LOG
      cp -a $BACKUP/dist/ $PRODUCTION/dist/
      cp $BACKUP/package.json $PRODUCTION/package.json
      [ -d $BACKUP/src ] && cp -a $BACKUP/src/ $PRODUCTION/src/
      [ -d $BACKUP/schema ] && cp -a $BACKUP/schema/ $PRODUCTION/schema/
      [ -f $BACKUP/scripts/self-deploy.sh ] && cp $BACKUP/scripts/self-deploy.sh $PRODUCTION/scripts/self-deploy.sh
      [ -f $BACKUP/scripts/setup-staging.sh ] && cp $BACKUP/scripts/setup-staging.sh $PRODUCTION/scripts/setup-staging.sh
      [ -f $BACKUP/scripts/self-rollback.sh ] && cp $BACKUP/scripts/self-rollback.sh $PRODUCTION/scripts/self-rollback.sh
      systemctl restart squire
      sleep 10
      if curl -sf http://localhost:$PROD_PORT/api/health > /dev/null 2>&1; then
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✓ Rollback successful\" >> $DEPLOY_LOG
      else
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') ✗ Rollback FAILED - manual intervention needed\" >> $DEPLOY_LOG
      fi
    fi

    # Clean up deploy lock
    rm -f $LOCK_FILE
  "; then
  log "ERROR: Failed to schedule restart unit"
  die "systemd-run failed - check: systemctl status squire-deploy-restart"
fi

log "✓ Restart scheduled (fires in 2 seconds)"
log ""
log "=== Deploy initiated ==="
log "  Monitor: tail -f $DEPLOY_LOG"
log "  Status:  systemctl status squire"
log "  Backup:  $BACKUP (auto-rollback on failure)"
