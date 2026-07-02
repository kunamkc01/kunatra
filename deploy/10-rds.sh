#!/usr/bin/env bash
# Phase 1 — RDS PostgreSQL (free-tier) + Lightsail↔VPC peering + a locked-down
# security group. Idempotent: safe to re-run. Creates a BILLABLE resource
# (free-tier eligible for the first 12 months).
source "$(dirname "$0")/lib.sh"

log "Peering the Lightsail VPC with your default AWS VPC (so the API can reach RDS privately)"
if [[ "$(awsq lightsail is-vpc-peered --query isPeered --output text 2>/dev/null || echo false)" == "True" ]]; then
  echo "  · already peered"
else
  awsq lightsail peer-vpc >/dev/null && echo "  · peering requested"
fi

log "Resolving the default VPC and its subnets"
VPC_ID=$(awsq ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[[ "$VPC_ID" == "None" || -z "$VPC_ID" ]] && { echo "No default VPC in $AWS_REGION." >&2; exit 1; }
SUBNETS=()
while IFS= read -r _s; do [[ -n "$_s" ]] && SUBNETS+=("$_s"); done < <(awsq ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')
echo "  · VPC $VPC_ID with ${#SUBNETS[@]} subnets"

log "Security group $DB_SG_NAME (5432 from your IP + the Lightsail VPC)"
SG_ID=$(awsq ec2 describe-security-groups --filters Name=group-name,Values="$DB_SG_NAME" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)
if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  SG_ID=$(awsq ec2 create-security-group --group-name "$DB_SG_NAME" --description "Kunatra RDS" --vpc-id "$VPC_ID" --query GroupId --output text)
fi
MYIP=$(curl -s https://checkip.amazonaws.com)/32
for CIDR in "$MYIP" "$LIGHTSAIL_CIDR"; do
  awsq ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 5432 --cidr "$CIDR" >/dev/null 2>&1 \
    && echo "  · allowed 5432 from $CIDR" || echo "  · rule for $CIDR already present"
done

log "DB subnet group"
awsq rds create-db-subnet-group --db-subnet-group-name "${PROJECT}-subnets" \
  --db-subnet-group-description "Kunatra" --subnet-ids "${SUBNETS[@]}" >/dev/null 2>&1 \
  && echo "  · created" || echo "  · already exists"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  save_cfg DB_PASSWORD "$DB_PASSWORD"
fi

log "RDS instance $DB_INSTANCE_ID ($DB_INSTANCE_CLASS, ${DB_STORAGE_GB}GB)"
if awsq rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" >/dev/null 2>&1; then
  echo "  · already exists"
else
  awsq rds create-db-instance \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --engine postgres --engine-version "$DB_ENGINE_VERSION" \
    --allocated-storage "$DB_STORAGE_GB" --storage-type gp2 \
    --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" \
    --db-name "$DB_NAME" \
    --db-subnet-group-name "${PROJECT}-subnets" \
    --vpc-security-group-ids "$SG_ID" \
    --publicly-accessible \
    --backup-retention-period 7 --no-multi-az --no-deletion-protection >/dev/null
  echo "  · creating (this takes a few minutes)"
fi

log "Waiting for the instance to become available…"
awsq rds wait db-instance-available --db-instance-identifier "$DB_INSTANCE_ID"
DB_HOST=$(awsq rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" --query 'DBInstances[0].Endpoint.Address' --output text)
save_cfg DB_HOST "$DB_HOST"

log "RDS ready at $DB_HOST"
echo "Next: ./20-migrate.sh  (applies the 15 SQL migrations)"
