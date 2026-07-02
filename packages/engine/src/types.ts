// Core domain types for the exposure / net-worth engine.
// All monetary values are in rupees (number).

export type AssetClass =
  | 'real_estate'
  | 'mutual_fund'
  | 'sip'
  | 'equity'
  | 'epf'
  | 'ppf'
  | 'nps'
  | 'fd'
  | 'rd'
  | 'bonds'
  | 'cash'
  | 'gold'
  | 'insurance'
  | 'other';

export interface Asset {
  id: string;
  name: string;
  assetClass: AssetClass;
  /** Current value in rupees (the latest valuation). */
  value: number;
  /** Convertible to cash within ~a week without material loss. */
  liquid: boolean;
  /** Total amount invested to date, in rupees. Drives unrealized gain. Optional. */
  costBasis?: number;
  /** Recurring monthly contribution (SIP/RD/PPF/EPF/NPS…), in rupees. Optional. */
  monthlyContribution?: number;
  /** Dated cash flows for return maths. amount>0 = invested, amount<0 = withdrawn (rupees). */
  contributions?: { amount: number; on: string }[];
  /** Monthly rent this asset brings in (let property), in rupees. Drives DSCR. Optional. */
  monthlyRent?: number;
}

export interface Loan {
  id: string;
  name: string;
  /** Principal outstanding, in rupees. */
  outstanding: number;
  /** Monthly EMI, in rupees. */
  emiMonthly: number;
  /** Annual interest rate, percent. */
  ratePct?: number;
  /** Id of the asset this loan is secured against (drives LTV). */
  securedAgainstAssetId?: string;
}

export interface Income {
  /** Monthly take-home pay, in rupees. */
  monthlyTakeHome: number;
}

export interface Expenses {
  /** Monthly essential spending excluding EMIs, in rupees. */
  monthlyEssential: number;
}

export interface Position {
  assets: Asset[];
  loans: Loan[];
  income?: Income;
  expenses?: Expenses;
}

export type Severity = 'good' | 'watch' | 'warning';

/** A descriptive signal about the user's own position. Never advice. */
export interface Signal {
  key: string;
  label: string;
  value: number;
  display: string;
  severity: Severity;
  /** Plain-language statement of fact about the user's situation. */
  message: string;
}

export interface NetWorth {
  grossAssets: number;
  totalDebt: number;
  netWorth: number;
  liquidAssets: number;
  illiquidAssets: number;
  allocation: { assetClass: AssetClass; value: number; pct: number }[];
}

export interface Exposure {
  realEstateValue: number;
  realEstateDebt: number;
  /** Loan-to-value on real estate, percent. Null if no real estate. */
  realEstateLTV: number | null;
  /** Total debt as a percent of gross assets. */
  debtToAssets: number;
  /** Total EMI as a percent of monthly take-home. Null if income unknown. */
  emiToIncome: number | null;
  /** Total monthly rent from let properties, in rupees. */
  monthlyRent: number;
  /** Debt-service coverage: monthly rent ÷ total EMI. Null if no EMI. */
  dscr: number | null;
  /** Months of EMIs + essential spend covered by liquid assets. Null if outflow unknown. */
  runwayMonths: number | null;
  /** The single largest asset as a percent of gross assets. */
  topConcentration: { name: string; pct: number } | null;
}

/** Appreciation & recurring-investing picture, derived from cost basis and contributions. */
export interface Investments {
  /** Sum of cost basis across assets that have one recorded, in rupees. */
  invested: number;
  /** Current value of those same assets, in rupees. */
  currentValue: number;
  /** currentValue − invested (unrealized), in rupees. */
  unrealizedGain: number;
  /** Gain as a percent of invested. Null if nothing invested. */
  gainPct: number | null;
  /** Total recurring monthly contribution across assets, in rupees. */
  monthlyContribution: number;
  /** How many assets have a recurring contribution. */
  contributingCount: number;
  /** Annualized money-weighted return (XIRR) across dated contributions, percent. Null if not computable. */
  xirrPct: number | null;
}

/** Monthly income, split so earned pay stays distinct from what assets throw off. */
export interface IncomeBreakdown {
  /** Earned income — salary / take-home, in rupees. */
  earned: number;
  /** Income from assets — rent from let property (and similar), in rupees. */
  fromAssets: number;
  /** earned + fromAssets, in rupees. */
  total: number;
}

export interface Assessment {
  netWorth: NetWorth;
  exposure: Exposure;
  investments: Investments;
  income: IncomeBreakdown;
  signals: Signal[];
}
