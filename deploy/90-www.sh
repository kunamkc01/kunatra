#!/usr/bin/env bash
# Phase 9 — the public marketing site at kunatra.com + www.kunatra.com.
# Its own private S3 bucket + CloudFront (reusing the OAC), a 2-name ACM cert,
# and Route 53 apex + www aliases. Separate from the app (app.kunatra.com).
# Idempotent via WWW_DIST_ID.
source "$(dirname "$0")/lib.sh"
: "${HOSTED_ZONE_ID:?}"
ACCOUNT=$(awsq sts get-caller-identity --query Account --output text)
WWW_BUCKET="${WWW_BUCKET:-kunatra-www-${ACCOUNT}}"
CACHE_OPTIMIZED=658327ea-f89d-4fab-a63d-7e88639e58f6
TMP=$(mktemp -d)

log "ACM cert for kunatra.com + www.kunatra.com"
if [[ -z "${WWW_CERT_ARN:-}" ]]; then
  WWW_CERT_ARN=$(awsq acm request-certificate --domain-name kunatra.com \
    --subject-alternative-names www.kunatra.com --validation-method DNS \
    --tags Key=project,Value=kunatra --query CertificateArn --output text)
  save_cfg WWW_CERT_ARN "$WWW_CERT_ARN"
  sleep 6
fi
# Add every validation CNAME to Route 53 (dedup).
awsq acm describe-certificate --certificate-arn "$WWW_CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord.[Name,Value]' --output text | sort -u > "$TMP/vr.txt"
{
  echo '{ "Comment": "ACM www validation", "Changes": ['
  first=1
  while read -r name value; do
    [[ -z "$name" ]] && continue
    [[ $first -eq 0 ]] && echo ','; first=0
    printf '{ "Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"%s"}]}}' "$name" "$value"
  done < "$TMP/vr.txt"
  echo '] }'
} > "$TMP/vr.json"
awsq route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "file://$TMP/vr.json" >/dev/null
log "Waiting for the cert to validate…"
awsq acm wait certificate-validated --certificate-arn "$WWW_CERT_ARN"
echo "  · ISSUED"

log "S3 bucket $WWW_BUCKET (private) + upload"
if ! awsq s3api head-bucket --bucket "$WWW_BUCKET" 2>/dev/null; then
  awsq s3api create-bucket --bucket "$WWW_BUCKET" >/dev/null
  awsq s3api put-public-access-block --bucket "$WWW_BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
fi
save_cfg WWW_BUCKET "$WWW_BUCKET"
awsq s3 sync "$HERE/www/" "s3://$WWW_BUCKET/" --delete --cache-control "public,max-age=300,must-revalidate"

log "Reusing the OAC"
OAC_ID=$(awsq cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='kunatra-oac'].Id | [0]" --output text)

if [[ -n "${WWW_DIST_ID:-}" ]]; then
  log "Distribution already recorded ($WWW_DIST_ID) — skipping create"
else
  log "Creating the distribution (aliases: kunatra.com, www.kunatra.com)"
  cat > "$TMP/dist.json" <<JSON
{
  "CallerReference": "kunatra-www-$(date +%s)",
  "Aliases": { "Quantity": 2, "Items": ["kunatra.com", "www.kunatra.com"] },
  "Comment": "Kunatra marketing", "Enabled": true, "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 1, "Items": [
    { "Id": "s3-www", "DomainName": "${WWW_BUCKET}.s3.us-east-1.amazonaws.com",
      "OriginAccessControlId": "${OAC_ID}", "S3OriginConfig": { "OriginAccessIdentity": "" } } ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-www", "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "${CACHE_OPTIMIZED}", "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } } },
  "PriceClass": "PriceClass_100",
  "ViewerCertificate": { "ACMCertificateArn": "${WWW_CERT_ARN}", "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021" }
}
JSON
  OUT=$(awsq cloudfront create-distribution --distribution-config "file://$TMP/dist.json")
  WWW_DIST_ID=$(echo "$OUT" | sed -nE 's/.*"Id": "(E[A-Z0-9]+)".*/\1/p' | head -1)
  save_cfg WWW_DIST_ID "$WWW_DIST_ID"
fi
WWW_CF_DOMAIN=$(awsq cloudfront get-distribution --id "$WWW_DIST_ID" --query 'Distribution.DomainName' --output text)

log "Bucket policy for the marketing distribution"
cat > "$TMP/bp.json" <<JSON
{ "Version":"2012-10-17","Statement":[{ "Sid":"AllowCloudFrontOAC","Effect":"Allow",
  "Principal":{"Service":"cloudfront.amazonaws.com"},"Action":"s3:GetObject",
  "Resource":"arn:aws:s3:::${WWW_BUCKET}/*",
  "Condition":{"StringEquals":{"AWS:SourceArn":"arn:aws:cloudfront::${ACCOUNT}:distribution/${WWW_DIST_ID}"}} }] }
JSON
awsq s3api put-bucket-policy --bucket "$WWW_BUCKET" --policy "file://$TMP/bp.json"

log "Route 53 aliases: kunatra.com + www.kunatra.com → CloudFront"
cat > "$TMP/r53.json" <<JSON
{ "Comment": "marketing site", "Changes": [
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"kunatra.com","Type":"A","AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${WWW_CF_DOMAIN}","EvaluateTargetHealth":false}}},
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"kunatra.com","Type":"AAAA","AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${WWW_CF_DOMAIN}","EvaluateTargetHealth":false}}},
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.kunatra.com","Type":"A","AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${WWW_CF_DOMAIN}","EvaluateTargetHealth":false}}},
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.kunatra.com","Type":"AAAA","AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${WWW_CF_DOMAIN}","EvaluateTargetHealth":false}}}
] }
JSON
awsq route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "file://$TMP/r53.json" --query 'ChangeInfo.Status' --output text

log "Waiting for the distribution to deploy (10–15 min)…"
awsq cloudfront wait distribution-deployed --id "$WWW_DIST_ID"
rm -rf "$TMP"
log "LIVE → https://kunatra.com  and  https://www.kunatra.com"
