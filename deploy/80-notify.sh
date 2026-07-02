#!/usr/bin/env bash
# Phase 8 — notifications infra: verify kunatra.com for SES (DKIM → Route 53),
# a send-only IAM user (SES + SNS publish) with access keys, and SNS set to
# transactional SMS. Idempotent. Saves creds to config.env.
source "$(dirname "$0")/lib.sh"
: "${HOSTED_ZONE_ID:?}"
TMP=$(mktemp -d)

log "SES: email identity for kunatra.com (DKIM)"
TOKENS=$(awsq sesv2 get-email-identity --email-identity kunatra.com --query 'DkimAttributes.Tokens' --output text 2>/dev/null || true)
if [[ -z "$TOKENS" || "$TOKENS" == "None" ]]; then
  awsq sesv2 create-email-identity --email-identity kunatra.com >/dev/null
  TOKENS=$(awsq sesv2 get-email-identity --email-identity kunatra.com --query 'DkimAttributes.Tokens' --output text)
fi
echo "  · DKIM tokens: $TOKENS"

log "Route 53: DKIM CNAME records"
{
  echo '{ "Comment": "SES DKIM", "Changes": ['
  first=1
  for t in $TOKENS; do
    [[ $first -eq 0 ]] && echo ','
    first=0
    printf '{ "Action": "UPSERT", "ResourceRecordSet": { "Name": "%s._domainkey.kunatra.com", "Type": "CNAME", "TTL": 300, "ResourceRecords": [ { "Value": "%s.dkim.amazonses.com" } ] } }' "$t" "$t"
  done
  echo '] }'
} > "$TMP/dkim.json"
awsq route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "file://$TMP/dkim.json" --query 'ChangeInfo.Status' --output text

log "SNS: default to transactional SMS"
awsq sns set-sms-attributes --attributes DefaultSMSType=Transactional >/dev/null && echo "  · set"

log "IAM: send-only user kunatra-notify"
if ! awsq iam get-user --user-name kunatra-notify >/dev/null 2>&1; then
  awsq iam create-user --user-name kunatra-notify >/dev/null && echo "  · created"
fi
cat > "$TMP/policy.json" <<'JSON'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["ses:SendEmail","ses:SendRawEmail"], "Resource": "*" },
  { "Effect": "Allow", "Action": ["sns:Publish","sns:SetSMSAttributes"], "Resource": "*" }
] }
JSON
awsq iam put-user-policy --user-name kunatra-notify --policy-name notify-send --policy-document "file://$TMP/policy.json"
echo "  · policy attached"

if [[ -z "${NOTIFY_ACCESS_KEY_ID:-}" ]]; then
  log "IAM: access key for kunatra-notify"
  KEY=$(awsq iam create-access-key --user-name kunatra-notify --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  AKID=$(echo "$KEY" | awk '{print $1}'); SAK=$(echo "$KEY" | awk '{print $2}')
  save_cfg NOTIFY_ACCESS_KEY_ID "$AKID"
  save_cfg NOTIFY_SECRET_ACCESS_KEY "$SAK"
else
  echo "  · access key already in config.env — skipping"
fi
rm -rf "$TMP"

log "Done. DKIM verifies once DNS propagates (a few min):"
echo "  aws --profile $AWS_PROFILE sesv2 get-email-identity --email-identity kunatra.com --query VerifiedForSendingStatus"
echo "SES is in SANDBOX until you request production access. To test now, verify your"
echo "own address:  aws --profile $AWS_PROFILE sesv2 create-email-identity --email-identity you@example.com"
