# Atlas

**Your money, honestly.** One place to see everything you own, what you owe against it, and whether you're overextending yourself.

A mirror, not an advisor. Atlas *describes* your financial position — net worth, leverage, runway, concentration — and never tells you what to buy, sell or borrow. That distinction is the product's spine, and it's what keeps it clear of regulated investment advice.

> Working repo. See `docs/product-concept.md` for the full concept and the three-tier strategy.

## Who it's for
Two personas, one engine:
- **Salaried professional** — one financed home, a SIP, EPF/PPF, some savings. Wants to know: *am I okay?* (Lead persona for the MVP.)
- **Small portfolio investor** — several funds and a property or two. Wants to know: *where do I actually stand?*

## Repo layout
```
packages/engine/   The net-worth & overextension engine — pure, tested, framework-free
apps/api/          Node + Express + PostgreSQL over the engine
apps/web/          Frontend (to build) + apps/web/prototype/wedge.html (the visual spec)
docs/              Concept, architecture, data model, exposure metrics, regulatory notes
```

## Quickstart
Requires **Node 22+** (uses native TypeScript execution; no build step to run the engine/API).
With nvm: `nvm use` (an `.nvmrc` pins 22). Install workspaces once from the repo root: `npm install`.

```bash
# 1) See the engine work — prints net worth + the mirror for the sample persona
npm run demo

# 2) Run the engine tests
npm test

# 3) Build the engine once so the API and web app can import @atlas/engine
npm run build -w @atlas/engine
```

### Run the full app (mirror + manual entry)
```bash
# a) Postgres — create the DB and load the schema
createdb kunatra
psql kunatra < apps/api/db/schema.sql

# b) API — copy the env and point DATABASE_URL at your DB
cd apps/api && cp .env.example .env   # defaults: PORT=4100, db 'kunatra'
npm run dev -w @atlas/api             # -> Kunatra API on :4100
# optional: seed a demo household from the salaried sample
#   node --env-file=.env --experimental-strip-types src/seed.ts

# c) Web — the Next.js frontend (in another terminal)
npm run dev -w @atlas/web             # -> http://localhost:3000
```

Open http://localhost:3000, set up a household, add assets/loans, and see where you stand.

> Note: the API defaults to **port 4100** (4000 was occupied on the dev machine).
> `apps/web/.env.local` sets `NEXT_PUBLIC_API_BASE`; the API's `CORS_ORIGIN` must match the web origin.

### Just the visual spec
```bash
open apps/web/prototype/wedge.html   # the static prototype the web app is built to match
```

## What's here vs what's next
**Here:** the engine (the hard, durable part — net worth, LTV, EMI strain, runway, concentration, DSCR, with descriptive signals), the data model + schema, a full API (households, assets with real-estate profile, and loans — CRUD over the engine), and the **Next.js web app** at `apps/web` (the mirror + fast manual entry, built to the wedge prototype).

**Next:** see `ROADMAP.md` — validate with real users, then Account Aggregator integration and multi-tenant hardening.

## A note on the maths
The engine is unit-tested and the sample-persona numbers are verified. Thresholds in `signals.ts` are starting points — tune them with real users.

*Illustrative figures throughout. Not financial advice.*
