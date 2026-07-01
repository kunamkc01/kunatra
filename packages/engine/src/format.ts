/** Format a rupee amount in Indian lakh/crore convention. */
export function formatINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}\u20B9${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}\u20B9${(abs / 1e5).toFixed(2)} L`;
  return `${sign}\u20B9${Math.round(abs).toLocaleString('en-IN')}`;
}
