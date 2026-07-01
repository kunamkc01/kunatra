# Product Concept — v0.1

*Working title: ATLAS (consumer). A fresh start: this supersedes the family-office spec set, which remains a reference for what carries over.*

---

## The idea in one line

**A mirror, not an advisor.** One place to see everything you own, what you owe against it, and whether you're overextending yourself.

## Who it's for — two personas, one engine

Two kinds of small investor, who need different *front doors* but the same engine underneath. Build one product with a persona-aware first screen, not two products.

**The salaried professional — "Am I okay?"**
One flat (home or first investment) with a large loan, a SIP or two, EPF/PPF, maybe insurance, cash in a couple of banks. Most of their net worth is illiquid equity in one property, and a big slice of income goes to EMI — often house-poor without realising it. Not optimising; anxious. First screen leads with **true net worth (and how much is locked in the flat), EMI-vs-income strain, emergency runway, single-asset concentration.** Job: reassurance or warning.

**The small portfolio investor — "Where do I stand?"**
Several funds, maybe direct equity, one to three properties (some let), more literate and engaged. Pain is fragmentation, not anxiety. First screen leads with **everything in one place, real blended returns (XIRR), allocation across classes, exposure across multiple properties.** Job: consolidation and an honest performance/risk picture.

**Shared engine:** net worth, LTV, DSCR, concentration, liquidity — same maths, different emphasis. **Lead the MVP with the salaried professional** (larger and more underserved market, more acute pain, simpler data to onboard, and the exact overextension framing this product is built on); the portfolio investor is the natural expansion, not a separate build.

Neither is well served today: wealth apps push what to buy and skew mass-affluent; bank apps show one institution; nobody cleanly nets real-world assets against the loans secured on them.

## The strategy — three tiers

| Tier | What | Audience | Regulatory weight |
|---|---|---|---|
| **1 — Clarity** | See and value all assets; net worth; risk and overextension. Data from Account Aggregator + manually-entered real assets. | **Public** | Light — it describes the user's own position |
| **2 — Management** | Assist in managing assets; over time, a management platform for other asset types. | **Limited** | Low–moderate |
| **3 — Guidance** | Safe, risk-framed input on the risk in a purchase. | **Personal first**, scaling after market research | Highest — approaches regulated advice |

Tier 1 is the wedge and the public product. Tiers 2 and 3 are deliberately later and narrower; Tier 3 stays personal until research and the regulatory path are clear.

---

## Tier 1 — the public MVP (the focus)

### Core value
Connect once, enter your property, and see: **what am I worth, and am I in too deep?** Everything else is in service of those two questions.

### The screens that matter
- **Net worth** — gross assets − total debt, one number, with the breakdown by asset class.
- **Exposure / overextension** — the honest part nobody shows them: real-estate LTV (on current value), rent-vs-EMI coverage (DSCR), debt as a share of assets, concentration, and liquidity (how much could you actually reach in a hurry).
- **Asset list** — everything in one place, financial and physical, each with its value and any loan against it.
- **An overextension signal** — described, never prescribed: *"68% of your property value is borrowed; your rent covers 0.7× of the EMIs."* A fact about their situation, not advice.

### Data in — the make-or-break
Every consolidated-net-worth app dies on data entry. This is the single most important decision, not a detail.

1. **Account Aggregator (the unlock).** The RBI AA framework lets a user consent to share bank, mutual-fund, insurance, NPS and deposit data through a regulated, read-only pipe. This is the difference between "another tracker nobody updates" and "connect once, see everything." Architect Tier 1 around it from day one.
2. **Manual entry for real assets — made genuinely fast.** Property, gold, unlisted holdings. This is also the *differentiator*: real estate and the loan against it is exactly what AA-fed apps can't show, and where overextension hides.
3. **Statement / PDF import and SMS parsing** as gap-fillers.

### Manual real-estate entry — the field model
Your field list, mapped to where each piece lives (owner identity separated from property facts, so a person's IDs are stored once):

| Your fields | Lives on | Note |
|---|---|---|
| Primary / secondary owner, their Aadhaar, PAN | **Owner** | Identity belongs to the person; stored once, reused across their properties |
| Address, Sqft, Undivided Share, PTIN, Car Park, Car Park Size | **Property** | Physical/legal facts; undivided share = the unit's share of land |
| Electricity Meter Number, Unique Service Number, Water Status | **Utility connection** | Each connection on the property |
| Approx Value | **Valuation** | Drives net worth, LTV and exposure |
| Tax, "2025 June Tax" | **Tax record** | Dated payments by period, each with its receipt |
| (loan against the property) | **Loan** | Secured on the asset → equity and LTV |

**Aadhaar / PAN are stored masked** — full value encrypted at rest, displayed as last-four only, access restricted. For a consumer product holding many strangers' IDs this is non-negotiable, and worth confirming with counsel before launch.

---

## The regulatory line (the discipline that keeps Tier 1 shippable)

- **Describe, don't prescribe.** Tier 1 states facts about the user's own position. It does not recommend buying, selling or borrowing. This is the line that keeps it clear of SEBI's investment-adviser regime.
- **Account Aggregator** participation (as a Financial Information User) has its own onboarding and obligations — a real workstream, not a library import.
- **Data protection (DPDP Act).** You become a fiduciary for other people's financial and identity data: consent, encryption, minimisation, and the Aadhaar/PAN handling above.
- **The line you don't cross yet:** the moment the product tells *other people* what to do with money for a fee, it's a different, regulated business. That's Tier 3, and it needs counsel before it's public.

*I'm not a lawyer — the AA/FIU path and the advice line both warrant an hour with someone who knows RBI and SEBI. Cheap insurance.*

---

## What carries over vs what's new

**Carries over (the hard part, already done):**
- The exposure engine — LTV on market value, DSCR, leverage maths — is the overextension feature, pointed at the user's own position.
- The data model — owner / asset / loan / valuation / components — and the field mapping above.
- The portfolio-scoped, owner-isolated permission thinking — i.e. multi-tenancy in all but name.

**New for this product:**
- Account Aggregator integration (the centrepiece).
- A consumer-grade, low-friction onboarding and entry experience.
- Multi-tenant hardening, support, billing, retention — the unglamorous product layer a personal tool never needed.

**Dropped from Tier 1:** the operations platform (work orders, vendors, inspections) — that's Tier 2, for a narrower audience.

---

## A lean path

- **Phase 0 — Prove the mirror.** Manual entry for everything + the net-worth and exposure views. No AA yet. Goal: does the overextension picture feel valuable to a handful of real users?
- **Phase 1 — AA integration.** Connect financial accounts; manual stays for real assets. This is the moment it stops being a chore.
- **Phase 2 — Polish for the public.** Onboarding, trust, accuracy, the things strangers need.
- **Phase 3 — Tier 2 (management), invite-only.**
- **Later — Tier 3 (guidance), personal first.**

---

## Open questions

1. **Persona — decided.** Two personas (salaried professional, small portfolio investor) sharing one engine; MVP leads with the salaried professional. Open sub-question: how much of the portfolio-investor front door to expose at launch vs hold for the expansion.
2. **AA path** — integrate via an existing AA/TSP, or pursue FIU status directly? Changes timeline materially.
3. **What's the wedge demo** — the one screen that makes someone go "oh, I had no idea I was that exposed"? That screen sells the product.
4. **Business or peers?** A few peers using it is a weekend of multi-tenant hardening; a public product is a company. Tier 1 public implies the latter.
