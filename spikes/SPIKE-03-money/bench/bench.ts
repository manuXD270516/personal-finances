/* eslint-disable */
// SPIKE-03 micro-benchmark: 100k additions and 100k allocations [50,30,20].
// Inputs are pre-parsed for every library; only the operation is timed.
import Big from 'big.js';
import { add as dAdd, allocate as dAllocate, dinero, toDecimal as dToDecimal } from 'dinero.js';
import {
  add as dbAdd,
  allocate as dbAllocate,
  dinero as dineroBig,
  toDecimal as dbToDecimal,
} from 'dinero.js/bigint';
import { CURRENCIES, Money, MoneyDecimal } from '../src/index.js';

const N = 100_000;
const RUNS = 7;
const { BOB } = CURRENCIES;

// deterministic LCG -> minor units in [0, 10^9)
let seed = 12345;
const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
const units = Array.from({ length: N }, () => next() % 1_000_000_000);
const strings = units.map((u) => `${Math.floor(u / 100)}.${String(u % 100).padStart(2, '0')}`);

const BOB_NUM = { code: 'BOB', base: 10, exponent: 2 } as const;
const BOB_BIG = { code: 'BOB', base: 10n, exponent: 2n } as const;

const money = strings.map((s) => Money.of(s, BOB));
const decs = strings.map((s) => new MoneyDecimal(s));
const bigs = strings.map((s) => new Big(s));
const dins = units.map((u) => dinero({ amount: u, currency: BOB_NUM }));
const dinsBig = units.map((u) => dineroBig({ amount: BigInt(u), currency: BOB_BIG }));
const bigints = units.map((u) => BigInt(u));

function bigJsAllocate(total: Big, weights: number[]): Big[] {
  // largest remainder at scale 2 (big.js has no allocate)
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => total.times(w).div(sum));
  const floors = raw.map((r) => r.round(2, Big.roundDown));
  let residue = total.minus(floors.reduce((a, b) => a.plus(b), new Big(0))).times(100).toNumber();
  const order = raw.map((r, i) => [r.minus(floors[i]!), i] as const).sort((a, b) => b[0].cmp(a[0]) || a[1] - b[1]);
  for (const [, i] of order) {
    if (residue-- <= 0) break;
    floors[i] = floors[i]!.plus('0.01');
  }
  return floors;
}

const W = [50, 30, 20];
const cases: Record<string, { add: () => unknown; allocate: () => unknown }> = {
  'Money (decimal.js clone)': {
    add: () => money.reduce((a, m) => a.add(m), Money.zero(BOB)),
    allocate: () => money.map((m) => m.allocate(W)),
  },
  'decimal.js raw': {
    add: () => decs.reduce((a, d) => a.plus(d), new MoneyDecimal(0)),
    allocate: () => null,
  },
  'big.js 7': {
    add: () => bigs.reduce((a, b) => a.plus(b), new Big(0)),
    allocate: () => bigs.map((b) => bigJsAllocate(b, W)),
  },
  'dinero.js 2 (number)': {
    add: () => dins.reduce((a, d) => dAdd(a, d), dinero({ amount: 0, currency: BOB_NUM })),
    allocate: () => dins.map((d) => dAllocate(d, W)),
  },
  'dinero.js 2 (bigint)': {
    add: () => dinsBig.reduce((a, d) => dbAdd(a, d), dineroBig({ amount: 0n, currency: BOB_BIG })),
    allocate: () => dinsBig.map((d) => dbAllocate(d, [50n, 30n, 20n])),
  },
  'bigint minor units (baseline)': {
    add: () => bigints.reduce((a, b) => a + b, 0n),
    allocate: () =>
      bigints.map((u) => {
        const f = [(u * 50n) / 100n, (u * 30n) / 100n, (u * 20n) / 100n];
        return f;
      }),
  },
};

function time(fn: () => unknown): number {
  const samples: number[] = [];
  fn(); // warm-up
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(RUNS / 2)]!;
}

console.log(`node ${process.version} — N=${N}, median of ${RUNS} runs (ms)`);
console.log('| Librería | 100k sumas (ms) | 100k allocate [50,30,20] (ms) |');
console.log('|---|---:|---:|');
for (const [name, c] of Object.entries(cases)) {
  const a = time(c.add);
  const al = name === 'decimal.js raw' ? 'n/a' : time(c.allocate).toFixed(1);
  console.log(`| ${name} | ${a.toFixed(1)} | ${al} |`);
}

// sanity: all libraries agree on the sum
const sums = [
  (cases['Money (decimal.js clone)']!.add() as Money).toString(),
  (cases['big.js 7']!.add() as Big).toFixed(2),
  dToDecimal(cases['dinero.js 2 (number)']!.add() as any),
  dbToDecimal(cases['dinero.js 2 (bigint)']!.add() as any),
];
console.log('\nsumas idénticas:', new Set(sums).size === 1, sums[0]);

// allocation semantics on docs/09 examples
const show = (xs: any[], f: (x: any) => string) => xs.map(f).join(' / ');
console.log('\n99.99 BOB en [50,30,20]:');
console.log('  Money   ', show(Money.of('99.99', BOB).allocate(W), String));
console.log('  big.js  ', show(bigJsAllocate(new Big('99.99'), W), (b) => b.toFixed(2)));
console.log('  dinero  ', show(dAllocate(dinero({ amount: 9999, currency: BOB_NUM }), W), (d) => dToDecimal(d)));
console.log('100.00 BOB en [1,1,1]:');
console.log('  Money   ', show(Money.of('100.00', BOB).allocate(3), String));
console.log('  dinero  ', show(dAllocate(dinero({ amount: 10000, currency: BOB_NUM }), [1, 1, 1]), (d) => dToDecimal(d)));
console.log('-100.00 BOB en [1,1,1]:');
console.log('  Money   ', show(Money.of('-100.00', BOB).allocate(3), String));
console.log('  dinero  ', show(dAllocate(dinero({ amount: -10000, currency: BOB_NUM }), [1, 1, 1]), (d) => dToDecimal(d)));

// ETH 18 decimals with dinero number calculator: precision loss
const ETH_NUM = { code: 'ETH', base: 10, exponent: 18 } as const;
const wei = 12345678901234567890123456789012345678;
console.log('\nETH 12345678901234567890.123456789012345678:');
console.log('  dinero number :', dToDecimal(dinero({ amount: wei, currency: ETH_NUM })));
console.log(
  '  dinero bigint :',
  dbToDecimal(dineroBig({ amount: 12345678901234567890123456789012345678n, currency: { code: 'ETH', base: 10n, exponent: 18n } })),
);
console.log('  Money         :', Money.of('12345678901234567890.123456789012345678', CURRENCIES.ETH).toString());
