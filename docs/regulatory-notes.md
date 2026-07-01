# Regulatory notes

*Not legal advice. These are the lines to design around and the questions to take to counsel who know RBI/SEBI and the DPDP Act — early, not late. An hour with a specialist is cheap insurance.*

## The core discipline: describe, don't prescribe
Tier 1 shows users facts about their *own* position. It does not recommend buying, selling or borrowing, and it does not give personalised investment advice for a fee. Holding that line is what keeps the product clear of SEBI's Investment Adviser regime. The engine enforces it: signal copy is tested to never instruct.

## Account Aggregator (the data-in unlock)
The RBI Account Aggregator framework lets a user consent to share financial data (banks, mutual funds, insurance, NPS, deposits) through a regulated, read-only pipe. To consume it the product acts as a **Financial Information User (FIU)**, typically via an existing AA / technology service provider. This is an onboarding workstream with its own obligations — plan for it, don't assume it's a drop-in.

**Open question:** integrate via an existing AA/TSP, or pursue direct FIU status? It materially changes timeline and cost.

## Data protection (DPDP Act)
Holding other people's financial and identity data makes you a data fiduciary: consent, purpose limitation, minimisation, security, and breach obligations.
- **Aadhaar / PAN:** stored encrypted at rest, displayed masked (last four), access role-restricted, never logged or in URLs. Prefer collecting only what's needed.
- Aadhaar specifically carries additional handling rules — confirm with counsel.

## The line you don't cross yet
**Tier 3 (guidance on the risk in a purchase)** approaches regulated advice the moment it's offered to other people for a fee. Keep it personal/internal until the regulatory path and market research are clear. Tiers 1 and 2 do not require crossing it.
