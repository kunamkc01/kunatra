# Kunatra — AWS deployment

Static Next.js web on **S3 + CloudFront**, the Express API on a **Lightsail
Container Service**, data in **RDS Postgres** (free-tier). One CloudFront domain
fronts both, path-routed so the browser only ever talks to one origin — no CORS.

```
Browser ─► CloudFront ─┬─ default ─► S3 (static web, `next build` with STATIC_EXPORT=1)
   (TLS, CDN)          └─ /api/*  ─► Lightsail Container Service (Express)
                                          └─► RDS Postgres (db.t4g.micro, free-tier)
```

Everything runs against the **`kunatra` AWS CLI profile** only — your default
account is never touched.

## Prerequisites (one-time, on your machine)

- AWS CLI v2 with the `kunatra` profile configured (done).
- `psql` — `brew install libpq && brew link --force libpq`
- Docker (for building the API image).
- Lightsail container plugin — `brew install aws/tap/lightsailctl` (or see AWS docs).

## Setup

```bash
cd deploy
cp config.env.example config.env      # then edit if you want non-default names
```

## Phases (run in order, from deploy/)

| # | Script | What it creates | Cost |
|---|--------|-----------------|------|
| 1 | `./10-rds.sh` | Lightsail↔VPC peering, security group, RDS Postgres | free-tier 12 mo, then ~$13/mo |
| 2 | `./20-migrate.sh` | Applies the 15 SQL migrations to RDS | — |
| 3 | `./30-api-image.sh` | Builds `atlas-api` for linux/amd64, pushes to Lightsail | — |
| 4 | `./40-lightsail-api.sh` | Container service + deployment (real AUTH_SECRET etc.) | ~$7/mo (nano) |
| 5 | `./50-web-s3.sh` | S3 bucket, static export build, sync | pennies |
| 6 | `./60-cloudfront.sh` | Distribution: S3 default + `/api/*` → Lightsail, TLS | pennies |

Each script is idempotent and records what it made back into `config.env`
(endpoints, generated secrets). **≈ $7–8/month during the RDS free-tier year**,
≈ $20/month after.

## Notes

- **Secrets**: `AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` are generated (not the dev
  defaults) in phase 4 and saved to `config.env` (gitignored).
- **Web ↔ API**: the web build uses `NEXT_PUBLIC_API_BASE=""`, so the browser
  calls `/api/...` on the CloudFront domain, which routes to Lightsail. Same
  origin ⇒ no CORS.
- **Custom domain** (optional): add an ACM cert in us-east-1 + a CNAME, then
  attach it to the CloudFront distribution. Until then you get a
  `*.cloudfront.net` URL.
- **Teardown**: `99-teardown.sh` (added last) deletes everything in reverse.
