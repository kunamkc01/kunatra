# Roadmap

Three tiers (from `docs/product-concept.md`), delivered in dependency order. Tier 1 is the public product; Tiers 2 and 3 are narrower and later.

## Tier 1 — Clarity (public)
**Phase 0 — Prove the mirror.** *(this repo is the start of it)*
- [x] Engine: net worth, exposure, descriptive signals (tested)
- [x] Data model + Postgres schema
- [x] API scaffold over the engine
- [x] Wedge screen prototype (salaried persona)
- [x] API write path: households, assets (+ real-estate profile), loans CRUD over the engine
- [x] Frontend build (Next.js) to the prototype spec — the mirror at `apps/web`
- [x] Fast manual entry for assets, loans, property profile, cash flow
- [ ] Validate with a handful of real users: does the overextension picture land?

**Phase 1 — Account Aggregator.**
- [ ] FIU onboarding (via AA/TSP or direct — decide first; see regulatory notes)
- [ ] Consent flow + pull bank / MF / insurance / NPS data
- [ ] Real estate stays manual (the differentiator)

**Phase 2 — Public-ready.**
- [ ] Onboarding, trust, accuracy, "why is my number X"
- [ ] Multi-tenant hardening, accounts, billing
- [ ] Portfolio-investor front door (XIRR, allocation, multi-property exposure)

## Tier 2 — Management (limited audience)
- [ ] Asset operations for managed assets (the family-office capability, narrowed)
- [ ] Invite-only

## Tier 3 — Guidance (personal first)
- [ ] Risk framing on a contemplated purchase (the leverage/affordability models)
- [ ] Stays personal/internal until the regulatory path + market research are clear

## Decisions still open
- Lead persona's headline: net worth (affirm) vs strain (warn). Both on screen; one leads.
- AA path: existing provider vs direct FIU.
- The one "wedge demo" screen that makes someone realise they're exposed.
- Business vs peers — Tier 1 public implies a company.
