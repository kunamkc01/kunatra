# Data model

The conceptual model and how the property field set maps onto it. The SQL is in `apps/api/db/schema.sql`.

## Guiding split: owner identity vs property fact
A person's identity (name, Aadhaar, PAN) belongs to the **Owner** and is stored once, referenced by ownership — not copied onto every property. Physical/legal facts about a flat belong to the **Asset / real-estate profile**.

## Entities
- **Household** — the account a single user manages; also holds monthly take-home and essential spend (for strain & runway).
- **Owner** — a person; name, contact, and sensitive IDs (see below).
- **Asset** — anything owned; class, current value, liquid flag, optional parent (for components).
- **Asset ownership** — Owner × Asset with share % and a managing owner.
- **Real-estate profile** — 1:1 with a property asset.
- **Utility connection** — electricity/water/etc. on a property; one property may have several.
- **Loan** — debt secured against an asset; drives equity and LTV.
- **Valuation** — point-in-time value; the latest drives current value.
- **Tax record** — dated property-tax payments (e.g. "2025 June Tax"), each linkable to a receipt.
- **Document** — typed, versioned file (deed, EC, allotment, OC, tax receipt) attached to an asset.

## The property field list, mapped
| Your field(s) | Entity |
|---|---|
| Primary / secondary owner, Aadhaar, PAN | Owner (via ownership) |
| Address, Sqft, Undivided Share, PTIN, Car Park, Car Park Size | Real-estate profile |
| Electricity Meter Number, Unique Service Number, Water Status | Utility connection |
| Approx Value | Valuation |
| Tax, "2025 June Tax" | Tax record (dated payments) |
| Tax receipts, land/sale deeds | Document |
| Loan against the property | Loan |

## Sensitive identifiers (Aadhaar, PAN)
**Decision:** store the number, but never in clear.
- Encrypted at rest at the application layer (`aadhaar_enc` / `pan_enc` ciphertext columns).
- Only the **last four** digits in clear (`aadhaar_last4`) for display.
- Access role-restricted; never logged or placed in URLs.

This is a DPDP-aligned default for holding many users' identity data. Confirm specifics with counsel before launch — see `docs/regulatory-notes.md`.
