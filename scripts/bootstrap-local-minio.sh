#!/usr/bin/env bash
# Bootstrap the local MinIO container (from docker-compose.yml).
# Creates the `media` bucket using the dev root creds — idempotent, safe to re-run.
#
# Run once after `docker compose up -d minio`:
#   scripts/bootstrap-local-minio.sh
set -euo pipefail

ROOT_USER="${MINIO_ROOT_USER:-minio_dev}"
ROOT_PASS="${MINIO_ROOT_PASSWORD:-minio_dev_password}"
BUCKET="${S3_BUCKET:-media}"

# Wait for MinIO to be healthy (compose healthcheck runs on 30s interval; we poll faster).
echo "[bootstrap] waiting for MinIO on 127.0.0.1:9000..."
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
    echo "[bootstrap] MinIO ready"
    break
  fi
  sleep 1
done

echo "[bootstrap] creating bucket: $BUCKET (ignore if exists)"
docker run --rm --network host \
  -e MC_HOST_local="http://${ROOT_USER}:${ROOT_PASS}@127.0.0.1:9000" \
  minio/mc mb --ignore-existing "local/$BUCKET"

echo "[bootstrap] done. Add to your .env:"
cat << EOF
S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=$BUCKET
S3_REGION=us-east-1
S3_ACCESS_KEY=$ROOT_USER
S3_SECRET_KEY=$ROOT_PASS
S3_FORCE_PATH_STYLE=true
MEDIA_PUBLIC_URL_BASE=http://localhost:3000/media
EOF
