# Architecture

## Shape
A small TypeScript monorepo. The valuable, durable core is the **engine**; everything else is replaceable plumbing around it.

```
atlas/
├── packages/engine/   Pure, storage-agnostic net-worth & overextension engine (tested)
├── apps/api/          Node + Express + PostgreSQL; thin layer over the engine
└── apps/web/          Frontend (to build) + the wedge prototype as the visual spec
```

## Principles
- **The engine is pure and framework-free.** It takes a `Position` (assets, loans, income, expenses) and returns net worth, exposure and descriptive signals. No DB, no HTTP, no UI. This is what gets unit-tested and reused across web, mobile and API.
- **Describe, don't prescribe.** Signals state facts about the user's own position. Nothing in the engine recommends an action — a test enforces that signal copy never says "should/buy/sell". This is the line that keeps the product clear of regulated advice.
- **Storage is an edge concern.** `apps/api/src/db.ts` is the only place that knows SQL; it maps rows to the engine's `Position`. Swap Postgres for anything and the engine is untouched.
- **Money in paise in the DB, rupees in code.** The schema stores `*_paise BIGINT` to avoid float drift; the loader converts to rupees for the engine.

## Stack choices (and why)
- **Engine / API: TypeScript on Node 22+.** Node's native type-stripping runs the `.ts` sources directly for dev/test; `tsc` builds the engine to `dist/` for publishing.
- **DB: PostgreSQL.** Relational fits the owner/asset/loan/valuation model and its constraints.
- **Web: build in Angular** (matches the team's strength) or React, consuming the engine + API. The `apps/web/prototype/wedge.html` is the visual and behavioural spec for the salaried-persona first screen — build to match it.
- **Mobile: later.** The engine is portable; a Kotlin port or a shared API keeps the maths identical.

## The data-in path (the make-or-break)
The product lives or dies on getting data in with low friction. Phased:
1. **Manual entry** for everything (Phase 0) — must be fast.
2. **Account Aggregator** (Phase 1) — consented, read-only bank/MF/insurance/NPS data via the RBI AA framework. This is the unlock. It is a real integration workstream (FIU onboarding), not a library.
3. **Statement / PDF / SMS import** as gap-fillers. Real estate stays manual — and is the differentiator.

See `docs/regulatory-notes.md` before building the AA path.
