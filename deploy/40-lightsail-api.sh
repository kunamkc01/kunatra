#!/usr/bin/env bash
# Phase 4 — deploy the pushed image to the container service with production
# secrets and DATABASE_URL → RDS. Generates AUTH_SECRET / FIELD_ENCRYPTION_KEY
# on first run. Idempotent (re-deploys). Public HTTPS endpoint on the API.
source "$(dirname "$0")/lib.sh"

[[ -z "${IMAGE_REF:-}" ]] && { echo "IMAGE_REF empty — run ./30-api-image.sh first." >&2; exit 1; }
[[ -z "${DB_HOST:-}"   ]] && { echo "DB_HOST empty — run ./10-rds.sh first." >&2; exit 1; }

# Real secrets (replace the dev defaults) — generated once, saved to config.env.
[[ -z "${AUTH_SECRET:-}" ]] && { AUTH_SECRET=$(openssl rand -hex 32); save_cfg AUTH_SECRET "$AUTH_SECRET"; }
[[ -z "${FIELD_ENCRYPTION_KEY:-}" ]] && { FIELD_ENCRYPTION_KEY=$(openssl rand -hex 32); save_cfg FIELD_ENCRYPTION_KEY "$FIELD_ENCRYPTION_KEY"; }

# RDS PostgreSQL 16 forces SSL; no-verify uses TLS without CA validation.
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME}?sslmode=no-verify"

TMP=$(mktemp -d)
cat > "$TMP/containers.json" <<JSON
{
  "api": {
    "image": "${IMAGE_REF}",
    "ports": { "4100": "HTTP" },
    "environment": {
      "PORT": "4100",
      "DATABASE_URL": "${DB_URL}",
      "AUTH_SECRET": "${AUTH_SECRET}",
      "FIELD_ENCRYPTION_KEY": "${FIELD_ENCRYPTION_KEY}",
      "CORS_ORIGIN": "*",
      "APP_URL": "${APP_URL:-}",
      "SES_FROM": "${SES_FROM:-no-reply@kunatra.com}",
      "NOTIFY_REGION": "${AWS_REGION}",
      "NOTIFY_ACCESS_KEY_ID": "${NOTIFY_ACCESS_KEY_ID:-}",
      "NOTIFY_SECRET_ACCESS_KEY": "${NOTIFY_SECRET_ACCESS_KEY:-}",
      "ADMIN_EMAILS": "${ADMIN_EMAILS:-}"
    }
  }
}
JSON
cat > "$TMP/endpoint.json" <<JSON
{
  "containerName": "api",
  "containerPort": 4100,
  "healthCheck": { "path": "/health", "successCodes": "200-499", "intervalSeconds": 10, "timeoutSeconds": 5, "healthyThreshold": 2, "unhealthyThreshold": 2 }
}
JSON

log "Creating deployment"
awsq lightsail create-container-service-deployment --service-name "$LS_SERVICE" \
  --containers "file://$TMP/containers.json" --public-endpoint "file://$TMP/endpoint.json" >/dev/null

log "Waiting for the deployment to go live (a few minutes)…"
until [[ "$(awsq lightsail get-container-services --service-name "$LS_SERVICE" --query 'containerServices[0].state' --output text)" == "RUNNING" ]]; do
  sleep 15; printf '.'
done
echo " running"

API_URL=$(awsq lightsail get-container-services --service-name "$LS_SERVICE" --query 'containerServices[0].url' --output text)
save_cfg API_URL "$API_URL"
rm -rf "$TMP"

log "API live at $API_URL"
echo "Health check:"; curl -fsS "${API_URL}health" && echo || echo "  (health not 200 yet — may still be warming up)"
echo "Next: ./50-web-s3.sh"
