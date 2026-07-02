#!/usr/bin/env bash
# Phase 7 (run once your kunatra.com delegation is live) — attach app.kunatra.com
# to the CloudFront distribution and point Route 53 at it. Waits on the ACM cert
# being ISSUED (its validation record is already in the zone from earlier).
source "$(dirname "$0")/lib.sh"
: "${DOMAIN:?}"; : "${CF_DIST_ID:?}"; : "${HOSTED_ZONE_ID:?}"; : "${ACM_CERT_ARN:?}"

STATUS=$(awsq acm describe-certificate --region us-east-1 --certificate-arn "$ACM_CERT_ARN" --query 'Certificate.Status' --output text)
if [[ "$STATUS" != "ISSUED" ]]; then
  echo "ACM cert is $STATUS, not ISSUED yet."
  echo "→ Finish delegating kunatra.com to Route 53 (its NS records). The validation"
  echo "  CNAME is already in the zone; the cert validates automatically once DNS resolves."
  exit 1
fi

CF_DOMAIN=$(awsq cloudfront get-distribution --id "$CF_DIST_ID" --query 'Distribution.DomainName' --output text)
TMP=$(mktemp -d)

log "Attaching $DOMAIN + the ACM cert to the distribution"
awsq cloudfront get-distribution-config --id "$CF_DIST_ID" > "$TMP/get.json"
ETAG=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/get.json")
python3 - "$TMP/get.json" "$TMP/cfg.json" "$DOMAIN" "$ACM_CERT_ARN" <<'PY'
import json, sys
src, dst, domain, arn = sys.argv[1:5]
cfg = json.load(open(src))["DistributionConfig"]
cfg["Aliases"] = {"Quantity": 1, "Items": [domain]}
cfg["ViewerCertificate"] = {"ACMCertificateArn": arn, "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021"}
json.dump(cfg, open(dst, "w"))
PY
awsq cloudfront update-distribution --id "$CF_DIST_ID" --distribution-config "file://$TMP/cfg.json" --if-match "$ETAG" >/dev/null
echo "  · updated"

log "Route 53 alias $DOMAIN → CloudFront"
cat > "$TMP/r53.json" <<JSON
{ "Comment": "app → CloudFront", "Changes": [
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "${DOMAIN}", "Type": "A",
    "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "${CF_DOMAIN}", "EvaluateTargetHealth": false } } },
  { "Action": "UPSERT", "ResourceRecordSet": { "Name": "${DOMAIN}", "Type": "AAAA",
    "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "${CF_DOMAIN}", "EvaluateTargetHealth": false } } }
] }
JSON
awsq route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "file://$TMP/r53.json" --query 'ChangeInfo.Status' --output text

log "Waiting for the distribution to redeploy…"
awsq cloudfront wait distribution-deployed --id "$CF_DIST_ID"
rm -rf "$TMP"
log "Done → https://${DOMAIN}"
