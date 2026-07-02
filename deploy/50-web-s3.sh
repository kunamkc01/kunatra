#!/usr/bin/env bash
# Phase 5 — build the static web (same-origin: NEXT_PUBLIC_API_BASE="") and sync
# to a PRIVATE S3 bucket. CloudFront reads it via OAC in phase 6. Idempotent.
source "$(dirname "$0")/lib.sh"
REPO="$HERE/.."
: "${WEB_BUCKET:?set WEB_BUCKET in config.env}"

log "S3 bucket $WEB_BUCKET (private)"
if awsq s3api head-bucket --bucket "$WEB_BUCKET" 2>/dev/null; then
  echo "  · already exists"
else
  # us-east-1 needs no LocationConstraint
  awsq s3api create-bucket --bucket "$WEB_BUCKET" >/dev/null
  awsq s3api put-public-access-block --bucket "$WEB_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
  echo "  · created + public access blocked"
fi

log "Building the static export (same-origin API → /api on the CloudFront domain)"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1 || true
( cd "$REPO" && npm run build -w @atlas/engine >/dev/null )
( cd "$REPO" && STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE="" npm run build -w @atlas/web )
[[ -d "$REPO/apps/web/out" ]] || { echo "build produced no out/ — aborting" >&2; exit 1; }

log "Syncing to S3 (immutable hashed assets cached hard, HTML revalidated)"
awsq s3 sync "$REPO/apps/web/out/" "s3://$WEB_BUCKET/" --delete \
  --exclude "_next/static/*" --cache-control "public,max-age=0,must-revalidate"
awsq s3 sync "$REPO/apps/web/out/_next/static/" "s3://$WEB_BUCKET/_next/static/" \
  --cache-control "public,max-age=31536000,immutable"

log "Web uploaded to s3://$WEB_BUCKET"
echo "Next: ./60-cloudfront.sh"
