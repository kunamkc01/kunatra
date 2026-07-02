#!/usr/bin/env bash
# Phase 6 — CloudFront in front of everything:
#   default behavior → private S3 (OAC) with a URL-rewrite function for the
#     trailingSlash static export (/manage → /manage/index.html)
#   /api/*          → the Lightsail API (custom origin), no caching, forwards
#     Authorization + query strings (AllViewerExceptHostHeader)
# Starts on the *.cloudfront.net cert; app.kunatra.com is attached later
# (70-domain.sh) once the ACM cert validates. Idempotent via CF_DIST_ID.
source "$(dirname "$0")/lib.sh"
: "${WEB_BUCKET:?}"; : "${API_URL:?run ./40 first}"
API_HOST=$(echo "$API_URL" | sed -E 's#^https?://##; s#/$##')
ACCOUNT=$(awsq sts get-caller-identity --query Account --output text)
TMP=$(mktemp -d)

# Managed policy IDs (global constants).
CACHE_OPTIMIZED=658327ea-f89d-4fab-a63d-7e88639e58f6
CACHE_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad
REQ_ALLVIEWER_NOHOST=b689b0a8-53d0-40ab-baf2-68738e2966ac

log "CloudFront function (URL rewrite for static routes)"
cat > "$TMP/router.js" <<'JS'
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) { req.uri = uri + 'index.html'; }
  else if (!uri.includes('.')) { req.uri = uri + '/index.html'; }
  return req;
}
JS
if awsq cloudfront describe-function --name kunatra-router >/dev/null 2>&1; then
  echo "  · exists"
else
  awsq cloudfront create-function --name kunatra-router \
    --function-config Comment="Kunatra static route rewrite",Runtime=cloudfront-js-2.0 \
    --function-code "fileb://$TMP/router.js" >/dev/null
  ETAG=$(awsq cloudfront describe-function --name kunatra-router --query ETag --output text)
  awsq cloudfront publish-function --name kunatra-router --if-match "$ETAG" >/dev/null
  echo "  · created + published"
fi
FUNC_ARN=$(awsq cloudfront describe-function --name kunatra-router --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)

log "Origin Access Control for the S3 bucket"
OAC_ID=$(awsq cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='kunatra-oac'].Id | [0]" --output text)
if [[ "$OAC_ID" == "None" || -z "$OAC_ID" ]]; then
  OAC_ID=$(awsq cloudfront create-origin-access-control --origin-access-control-config \
    Name=kunatra-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 \
    --query 'OriginAccessControl.Id' --output text)
fi
echo "  · $OAC_ID"

if [[ -n "${CF_DIST_ID:-}" ]]; then
  log "Distribution already recorded ($CF_DIST_ID) — skipping create"
else
  log "Creating the distribution"
  cat > "$TMP/dist.json" <<JSON
{
  "CallerReference": "kunatra-$(date +%s)",
  "Comment": "Kunatra",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 2, "Items": [
    { "Id": "s3-web", "DomainName": "${WEB_BUCKET}.s3.us-east-1.amazonaws.com",
      "OriginAccessControlId": "${OAC_ID}", "S3OriginConfig": { "OriginAccessIdentity": "" } },
    { "Id": "api", "DomainName": "${API_HOST}",
      "CustomOriginConfig": { "HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "https-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }, "OriginReadTimeout": 30, "OriginKeepaliveTimeout": 5 } }
  ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-web", "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "${CACHE_OPTIMIZED}", "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "FunctionAssociations": { "Quantity": 1, "Items": [ { "EventType": "viewer-request", "FunctionARN": "${FUNC_ARN}" } ] }
  },
  "CacheBehaviors": { "Quantity": 1, "Items": [
    { "PathPattern": "/api/*", "TargetOriginId": "api", "ViewerProtocolPolicy": "https-only",
      "CachePolicyId": "${CACHE_DISABLED}", "OriginRequestPolicyId": "${REQ_ALLVIEWER_NOHOST}", "Compress": true,
      "AllowedMethods": { "Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
        "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } } }
  ] },
  "PriceClass": "PriceClass_100",
  "ViewerCertificate": { "CloudFrontDefaultCertificate": true }
}
JSON
  OUT=$(awsq cloudfront create-distribution --distribution-config "file://$TMP/dist.json")
  CF_DIST_ID=$(echo "$OUT" | sed -nE 's/.*"Id": "(E[A-Z0-9]+)".*/\1/p' | head -1)
  save_cfg CF_DIST_ID "$CF_DIST_ID"
fi

DIST_ARN="arn:aws:cloudfront::${ACCOUNT}:distribution/${CF_DIST_ID}"
CF_DOMAIN=$(awsq cloudfront get-distribution --id "$CF_DIST_ID" --query 'Distribution.DomainName' --output text)
save_cfg PUBLIC_URL "https://${CF_DOMAIN}"

log "Bucket policy — let this distribution read the private bucket"
cat > "$TMP/bucket-policy.json" <<JSON
{ "Version": "2012-10-17", "Statement": [ {
  "Sid": "AllowCloudFrontOAC", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject", "Resource": "arn:aws:s3:::${WEB_BUCKET}/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "${DIST_ARN}" } } } ] }
JSON
awsq s3api put-bucket-policy --bucket "$WEB_BUCKET" --policy "file://$TMP/bucket-policy.json"
echo "  · applied"

log "Waiting for the distribution to deploy (10–15 min)…"
awsq cloudfront wait distribution-deployed --id "$CF_DIST_ID"
rm -rf "$TMP"

log "LIVE → https://${CF_DOMAIN}"
echo "app.kunatra.com attaches via ./70-domain.sh once the ACM cert validates."
