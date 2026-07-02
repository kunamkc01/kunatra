#!/usr/bin/env bash
# Phase 3 — create the Lightsail container service (if absent), build the API
# image for linux/amd64 (Lightsail runs amd64; your Mac is arm64) and push it.
# Creating the service is BILLABLE (~$7/mo for nano). Idempotent.
source "$(dirname "$0")/lib.sh"
REPO="$HERE/.."

log "Container service $LS_SERVICE ($LS_POWER, scale $LS_SCALE)"
if awsq lightsail get-container-services --service-name "$LS_SERVICE" >/dev/null 2>&1; then
  echo "  · already exists"
else
  awsq lightsail create-container-service --service-name "$LS_SERVICE" --power "$LS_POWER" --scale "$LS_SCALE" >/dev/null
  echo "  · created"
fi

log "Waiting for the service to be READY to accept an image push"
until [[ "$(awsq lightsail get-container-services --service-name "$LS_SERVICE" --query 'containerServices[0].state' --output text)" == "READY" ]]; do
  sleep 10; printf '.'
done
echo " ready"

log "Building atlas-api for linux/amd64"
docker buildx build --platform linux/amd64 -f "$REPO/Dockerfile.api" -t kunatra-api:latest --load "$REPO"

log "Pushing to the Lightsail registry"
awsq lightsail push-container-image --service-name "$LS_SERVICE" --label api --image kunatra-api:latest
IMAGE_REF=$(awsq lightsail get-container-images --service-name "$LS_SERVICE" --query 'containerImages[0].image' --output text)
save_cfg IMAGE_REF "$IMAGE_REF"

log "Pushed as $IMAGE_REF"
echo "Next: ./40-lightsail-api.sh"
