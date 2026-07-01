// Core domain types for the exposure / net-worth engine.
// All monetary values are in rupees (number).

export type AssetClass =
  | 'real_estate'
  | 'mutual_fund'
  | 'sip'
  | 'equity'
  | 'epf'
  | 'ppf'
  | 'cash'
  | 'gold'
  | 'insurance'
  | 'other';

export interface Asset {
  id: string;
  name: string;
  assetClass: AssetClass;
  /** Current value in rupees. */
  value: number;
  /** Convertible to cash within ~a week without material loss. */
  liquid: boolean;
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
  /** Months of EMIs + essential spend covered by liquid assets. Null if outflow unknown. */
  runwayMonths: number | null;
  /** The single largest asset as a percent of gross assets. */
  topConcentration: { name: string; pct: number } | null;
}

export interface Assessment {
  netWorth: NetWorth;
  exposure: Exposure;
  signals: Signal[];
}
