import { describe, expect, it } from 'vitest';
import { buildDemoPlan, DEMO_MANIFEST, summarizeDemoPlan, toDecimal, money } from './demo-plan.js';
import golden from './golden-summary.json' with { type: 'json' };
import { SeededRandom } from './prng.js';

describe('dataset Demo v1 (docs/29 §2.2, generación determinista)', () => {
  it('[TC-IDENTITY-DEMO-007] dos ejecuciones con la misma ancla producen exactamente los mismos comandos y el golden summary', () => {
    const a = buildDemoPlan('2026-09-30');
    const b = buildDemoPlan('2026-09-30');
    expect(b).toEqual(a);
    const summary = summarizeDemoPlan(a);
    expect({ ...summary, anchorDate: '2026-09-30' }).toEqual(golden);
    expect(a.months).toHaveLength(DEMO_MANIFEST.windowMonths);
    expect(a.startDate).toBe('2025-01-01');
    expect(a.months.at(-1)?.month).toBe('2026-09');
  });

  it('[TC-IDENTITY-DEMO-007] con anchor=today las fechas se desplazan y los saldos de referencia no cambian', () => {
    const shifted = buildDemoPlan('2026-10-04');
    expect(summarizeDemoPlan(shifted).balances).toEqual(golden.balances);
    const dates = shifted.months.flatMap((m) => m.ops.map((o) => o.date));
    expect(dates.every((d) => d <= '2026-10-04')).toBe(true);
    expect(dates.some((d) => d === '2026-10-04')).toBe(true);
    expect(shifted.startDate).toBe('2025-01-05');
  });

  it('[TC-IDENTITY-DEMO-007] instituciones y contrapartes ficticias ("Demo") e identificadores con prefijo DEMO-', () => {
    const plan = buildDemoPlan();
    expect(plan.institutions.map((i) => i.name)).toContain('Banco Andino Demo');
    expect(plan.institutions.every((i) => i.name.endsWith('Demo'))).toBe(true);
    expect(plan.counterparties.every((c) => c.name.includes('Demo'))).toBe(true);
    expect(plan.accounts.every((a) => a.reference.startsWith('DEMO-'))).toBe(true);
  });

  it('montos como enteros de unidades mínimas → string decimal con la escala de la moneda', () => {
    expect(toDecimal(money(123_456n, 'BOB'))).toBe('1234.56');
    expect(toDecimal(money(5n, 'BTC'))).toBe('0.00000005');
    expect(toDecimal(money(-150_000_000n, 'USDT'))).toBe('-150.000000');
    const plan = buildDemoPlan();
    for (const op of plan.months.flatMap((m) => m.ops)) {
      if (op.op === 'income' || op.op === 'expense') {
        expect(op.amount.minor > 0n).toBe(true);
        expect(op.splits.reduce((s, x) => s + x.amount.minor, 0n)).toBe(op.amount.minor);
      }
    }
  });

  it('el PRNG sembrado es reproducible y los sub-generadores por módulo son independientes', () => {
    const a = SeededRandom.derive(1, 'card');
    const b = SeededRandom.derive(1, 'card');
    const seq = Array.from({ length: 5 }, () => a.int(0, 1000));
    expect(Array.from({ length: 5 }, () => b.int(0, 1000))).toEqual(seq);
    expect(Array.from({ length: 5 }, () => SeededRandom.derive(1, 'fx').int(0, 1000))).not.toEqual(seq);
  });
});
