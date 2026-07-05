#!/usr/bin/env bash
# Phase 8.5 — document vault storage: a PRIVATE S3 bucket for household documents
# (agreements, maintenance bills, receipts). Downloads stream through the API so
# RBAC stays in charge — the bucket is never public. Idempotent.
source "$(dirname "$0")/lib.sh"
ACCOUNT=$(awsq sts get-caller-identity --query Account --output text)
DOCS_BUCKET="${DOCS_BUCKET:-kunatra-docs-${ACCOUNT}}"
TMP=$(mktemp -d)

log "S3 bucket $DOCS_BUCKET (private, encrypted by default)"
if awsq s3api head-bucket --bucket "$DOCS_BUCKET" 2>/dev/null; then
  echo "  · already exists"
else
  awsq s3api create-bucket --bucket "$DOCS_BUCKET" >/dev/null
  awsq s3api put-public-access-block --bucket "$DOCS_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
  echo "  · created + public access blocked"
fi
save_cfg DOCS_BUCKET "$DOCS_BUCKET"

log "IAM: allow the app user to read/write ONLY this bucket"
cat > "$TMP/policy.json" <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["ses:SendEmail","ses:SendRawEmail"], "Resource": "*" },
  { "Effect": "Allow", "Action": ["sns:Publish","sns:SetSMSAttributes"], "Resource": "*" },
  { "Effect": "Allow", "Action": ["bedrock:InvokeModel"], "Resource": "*" },
  { "Effect": "Allow", "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject"],
    "Resource": "arn:aws:s3:::${DOCS_BUCKET}/*" }
] }
JSON
awsq iam put-user-policy --user-name kunatra-notify --policy-name notify-send --policy-document "file://$TMP/policy.json"
echo "  · policy updated"
rm -rf "$TMP"
log "Done. Redeploy the API (40) so DOCS_BUCKET reaches the container."
