import { assess, salariedSample, formatINR } from './index.ts';

const a = assess(salariedSample);

console.log('\n=== Net worth ===');
console.log('Net worth   ', formatINR(a.netWorth.netWorth));
console.log('Gross assets', formatINR(a.netWorth.grossAssets));
console.log('Total debt  ', formatINR(a.netWorth.totalDebt));
console.log('Liquid      ', formatINR(a.netWorth.liquidAssets));

console.log('\n=== The mirror ===');
for (const s of a.signals) {
  const tag = s.severity.toUpperCase().padEnd(7);
  console.log(`[${tag}] ${s.label.padEnd(18)} ${s.display.padStart(7)}  ${s.message}`);
}
console.log('');
