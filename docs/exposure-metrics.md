# Exposure metrics

The definitions the engine computes (`packages/engine/src/exposure.ts`) and the bands the signals use (`signals.ts`). All thresholds are starting points to tune with real users.

## Net worth
- **Gross assets** = Σ current asset values.
- **Total debt** = Σ loan outstanding.
- **Net worth** = gross assets − total debt.
- **Liquid assets** = Σ value of assets flagged `liquid` (reachable within ~a week without material loss).

## Exposure
| Metric | Definition | good | watch | warning |
|---|---|---|---|---|
| Real-estate LTV | real-estate debt ÷ real-estate value | < 60% | 60–80% | > 80% |
| EMI vs income | total EMI ÷ monthly take-home | < 30% | 30–40% | > 40% |
| Emergency runway | liquid assets ÷ (EMI + essential spend) | > 6 mo | 3–6 mo | < 3 mo |
| Largest asset | biggest single asset ÷ gross assets | < 40% | 40–60% | > 60% |
| Debt vs assets | total debt ÷ gross assets | < 40% | 40–60% | > 60% |

## DSCR (for let property — portfolio persona)
Coverage = net operating income ÷ EMI. Below 1.0× means the rent does not cover the loan (negative carry). Used where a property is rented; not surfaced for an owner-occupied home.

## The rule the signals obey
Every signal is a **statement of fact** about the user's own position — *"You've borrowed 68% of your property's value."* It never says what to do. That distinction is enforced by a test and is what keeps Tier 1 clear of investment-adviser regulation.
