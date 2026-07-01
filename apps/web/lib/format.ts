/** Format a rupee amount in Indian lakh/crore convention. Mirrors @atlas/engine formatINR. */
export function inr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Full rupee figure with grouping, no lakh/crore abbreviation (for inputs/detail). */
export function inrExact(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const CLASS_LABELS: Record<string, string> = {
  real_estate: "Real estate",
  mutual_fund: "Mutual fund",
  sip: "SIP",
  equity: "Equity",
  epf: "EPF",
  ppf: "PPF",
  cash: "Cash & savings",
  gold: "Gold",
  insurance: "Insurance",
  other: "Other",
};

export function assetClassLabel(c: string): string {
  return CLASS_LABELS[c] ?? c;
}

/** Map engine severity -> the prototype's card class (g/w/b). */
export function sevClass(sev: string): "g" | "w" | "b" {
  return sev === "good" ? "g" : sev === "watch" ? "w" : "b";
}
