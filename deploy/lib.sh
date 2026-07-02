#!/usr/bin/env bash
# Shared helpers. Every script does:  source "$(dirname "$0")/lib.sh"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$HERE/config.env" ]]; then
  echo "deploy/config.env not found. Copy config.env.example → config.env and edit it." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$HERE/config.env"

# aws wrapper pinned to the kunatra profile + region — never touches your default account.
awsq() { aws --profile "$AWS_PROFILE" --region "$AWS_REGION" "$@"; }

# Persist a KEY=VALUE back into config.env (used to record generated secrets/endpoints).
save_cfg() {
  local key="$1" val="$2" f="$HERE/config.env"
  if grep -qE "^${key}=" "$f"; then
    # macOS/BSD sed
    sed -i '' -E "s|^${key}=.*|${key}=${val}|" "$f"
  else
    printf '%s=%s\n' "$key" "$val" >> "$f"
  fi
  echo "  · saved ${key} to config.env"
}

log() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
