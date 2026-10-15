import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { epochDay } from './calendar.js';
import {
  buildDemoOracle,
  buildDemoPlan,
  DEMO_MANIFEST,
  money,
  summarizeDemoPlan,
  toDecimal,
  type DemoOp,
} from './demo-plan.js';
import golden from './golden-summary.json' with { type: 'json' };
import { referenceFigures, structuralOf, summarizeModules } from './module-summary.js';
import { SeededRandom } from './prng.js';

const FIXED = '2026-09-30';
const opsOf = (anchor: string): DemoOp[] => buildDemoPlan(anchor).months.flatMap((m) => m.ops);

describe('dataset Demo v2 (docs/29 §2.2, generación determinista)', () => {
  it('[TC-IDENTITY-DEMO-007] dos ejecuciones con la misma ancla producen exactamente los mismos comandos y el resumen de referencia v2', () => {
    const a = buildDemoPlan(FIXED);
    const b = buildDemoPlan(FIXED);
    expect(b).toEqual(a);
    const summary = summarizeDemoPlan(a);
    expect({
      datasetVersion: summary.datasetVersion,
      anchorDate: FIXED,
      balances: summary.balances,
      counts: summary.counts,
      modules: summarizeModules(FIXED),
      reference: referenceFigures(FIXED),
    }).toEqual(golden);
    expect(DEMO_MANIFEST.datasetVersion).toBe('2');
    expect(DEMO_MANIFEST.generatorVersion).toBe('2.0.0');
    expect(DEMO_MANIFEST.modules).toHaveLength(9);
    expect(DEMO_MANIFEST.modules).toEqual(expect.arrayContaining(['commitments', 'debt', 'goals', 'ledger']));
    expect(a.months).toHaveLength(DEMO_MANIFEST.windowMonths);
    expect(a.startDate).toBe('2025-01-01');
    expect(a.months.at(-1)?.month).toBe('2026-09');
  });

  it('[TC-IDENTITY-DEMO-007] con anchor=today las fechas se desplazan y los estados por módulo no cambian', () => {
    const shifted = buildDemoPlan('2026-10-04');
    const dates = shifted.months.flatMap((m) => m.ops.map((o) => o.date));
    expect(dates.every((d) => d <= '2026-10-04')).toBe(true);
    expect(dates.some((d) => d === '2026-10-04')).toBe(true);
    expect(shifted.startDate).toBe('2025-01-05');
    expect(structuralOf(summarizeModules('2026-10-04'))).toEqual(structuralOf(summarizeModules(FIXED)));
    // Los saldos que no dependen de cuántas ocurrencias caen dentro de la ventana se conservan.
    const balances = summarizeDemoPlan(shifted).balances;
    for (const key of ['usdt', 'btc', 'loan_vehicular', 'loan_consumo', 'loan_educativo'] as const) {
      expect(balances[key], key).toBe(golden.balances[key]);
    }
  });

  it('[TC-IDENTITY-DEMO-007] instituciones y contrapartes ficticias e identificadores con prefijo DEMO-', () => {
    const plan = buildDemoPlan();
    expect(plan.institutions.map((i) => i.name)).toContain('Banco Andino Demo');
    expect(plan.institutions.every((i) => i.name.endsWith('Demo'))).toBe(true);
    expect(plan.institutions.map((i) => i.name)).toEqual(
      expect.arrayContaining(['Cooperativa Illimani Demo', 'Billetera Altiplano Demo']),
    );
    // Ninguna contraparte fuera de la lista ficticia: todas terminan en "Demo" salvo la tía, marcada "(ficticia)".
    expect(
      plan.counterparties.every((c) => /Demo( SRL)?$/.test(c.name) || c.name === 'Tía Carmen (ficticia)'),
    ).toBe(true);
    expect(plan.accounts.every((a) => a.reference.startsWith('DEMO-'))).toBe(true);
    const loans = opsOf(FIXED).filter((o) => o.op === 'loan');
    expect(loans).toHaveLength(4);
    expect(loans.every((o) => o.op === 'loan' && o.reference.startsWith('DEMO-LOAN-'))).toBe(true);
  });

  it('[TC-IDENTITY-DEMO-015] las ocho suscripciones: cinco activas, una en trial, una pausada y una cancelada, con costo 412.94 y 4955.25 BOB', () => {
    const modules = summarizeModules(FIXED);
    expect(modules.subscriptions).toMatchObject({
      count: 8,
      active: 5,
      trial: 1,
      paused: 1,
      cancelled: 1,
      monthlyBase: '412.94',
      yearlyBase: '4955.25',
      trialMonthlyBase: '105.00',
    });
    const oracle = buildDemoOracle(FIXED);
    expect(oracle.unresolved).toEqual([
      { definition: 'internet', date: '2026-09-28', amount: money(19_900n, 'BOB') },
    ]);
    // El último cargo de NubeSegura se aprueba con 3.49 USD (propuesta de precio); StreamFlix sube a 11.99 USD.
    const ops = opsOf(FIXED);
    const cloud = ops.filter(
      (o) => o.op === 'occurrence' && o.target.type === 'subscription' && o.target.key === 'cloud',
    );
    expect(cloud.at(-1)).toMatchObject({ amount: money(349n, 'USD'), occurrenceDate: '2026-09-15' });
    expect(ops.find((o) => o.op === 'subscriptionPrice')).toMatchObject({
      effectiveFrom: '2025-10-03',
      price: money(1_199n, 'USD'),
    });
  });

  it('[TC-IDENTITY-DEMO-015] las seis definiciones recurrentes resuelven 6 meses; solo la de internet de A − 2 queda atrasada', () => {
    const ops = opsOf(FIXED);
    expect(ops.filter((o) => o.op === 'recurring').map((o) => (o.op === 'recurring' ? o.key : ''))).toEqual([
      'salary',
      'rent',
      'internet',
      'power',
      'cashWithdrawal',
      'insurance',
    ]);
    const byDefinition = (key: string) =>
      ops.filter((o) => o.op === 'occurrence' && o.target.type === 'definition' && o.target.key === key);
    expect(byDefinition('rent')).toHaveLength(6);
    expect(byDefinition('power').every((o) => o.op === 'occurrence' && o.action === 'link')).toBe(true);
    expect(byDefinition('internet').at(-1)).toMatchObject({ action: 'leave', occurrenceDate: '2026-09-28' });
    expect(byDefinition('insurance').map((o) => o.date)).toEqual(['2026-05-16', '2026-08-16']);
    expect(byDefinition('salary').map((o) => o.date)).toEqual([
      '2026-04-30',
      '2026-05-29',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
  });

  it('[TC-IDENTITY-DEMO-016] "Tarjeta Andina Demo": cierre el 25, vencimiento el 15, pago administrado por el total y 60 % en septiembre de 2025', () => {
    const oracle = buildDemoOracle(FIXED);
    expect(oracle.andina.at(-1)).toMatchObject({ closing: '2026-09-25', due: '2026-10-15', payment: null });
    const september = oracle.andina.find((s) => s.due === '2025-09-15');
    expect(september).toBeDefined();
    expect(september!.payment).toBe((september!.billed * 60n + 50n) / 100n);
    // El 60 % supera el mínimo del 5 % con piso de 50.00 BOB (queda parcialmente pagado).
    expect(september!.payment! >= september!.minimum).toBe(true);
    const paid = oracle.andina.filter((s) => s.payment !== null && s.due !== '2025-09-15');
    expect(paid.every((s) => s.payment === s.billed)).toBe(true);
  });

  it('[TC-IDENTITY-DEMO-017] metas: aportes del fondo de emergencia, reservas del viaje, laptop alcanzada y regalos', () => {
    const modules = summarizeModules(FIXED);
    expect(modules.goals).toEqual({
      emergencyContributions: 12,
      emergencySaved: '18000.00',
      reserved: { travel: '550.00', laptop: '8000.00', gifts: '500.00' },
    });
    const ops = opsOf(FIXED);
    const gifts = ops.filter((o) => o.op === 'expense' && o.key === 'wallet:gifts');
    expect(gifts).toHaveLength(1);
    expect(gifts[0]?.date).toBe('2026-07-20');
    // El episodio de sobre-asignación se evalúa con ticks de metas en la fecha del gasto y en la de la transferencia.
    expect(
      ops
        .filter((o) => o.op === 'tick' && o.runner === 'goals' && !o.late)
        .map((o) => o.date)
        .sort(),
    ).toEqual(['2026-07-20', '2026-08-05']);
  });

  it('[TC-IDENTITY-DEMO-019] cifras de referencia de decisión 8: deuda USD 1207.15 ≈ 8450.05 BOB, interés 2596.98 BOB y 536.67 USD, comprometido 2349.00 BOB', () => {
    const ref = referenceFigures(FIXED);
    expect(ref.debtSummary).toMatchObject({
      totalUsd: '1207.15',
      interestBob: '2596.98',
      interestUsd: '536.67',
      debtFree: '2028-02-01',
    });
    expect(ref.spendable).toEqual({
      committedBob: '2349.00',
      reservedBob: '26500.00',
      reservedUsd: '550.00',
      plannedPendingUsd: '100.00',
    });
  });

  it('[TC-IDENTITY-DEMO-007] tasas de cierre en A − 1: USD/BOB 7.00, USDT/BOB 6.95 y BTC/USD 60000.00 paralelas', () => {
    const closing = opsOf(FIXED).filter((o) => o.op === 'rate' && o.date === '2026-09-29');
    expect(
      closing
        .filter((o) => o.op === 'rate' && o.rateType === 'PARALLEL')
        .map((o) => (o.op === 'rate' ? `${o.base}/${o.quote}=${o.value}` : ''))
        .filter((v) => /=(7\.00|6\.95|60000\.00)$/.test(v))
        .sort(),
    ).toEqual(['BTC/USD=60000.00', 'USD/BOB=7.00', 'USDT/BOB=6.95']);
    // Sin observaciones de proveedores ni tasas bancarias: solo tasas manuales PARALLEL/OFFICIAL.
    const types = new Set(opsOf(FIXED).flatMap((o) => (o.op === 'rate' ? [o.rateType] : [])));
    expect([...types].sort()).toEqual(['OFFICIAL', 'PARALLEL']);
  });

  it('[TC-IDENTITY-DEMO-020] cualquier ancla de 2026-01-01 a 2027-12-31: ninguna operación posterior a la ancla y los mismos estados por módulo', () => {
    const reference = structuralOf(summarizeModules(FIXED));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 729 }), (offset) => {
        const anchor = new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
        const plan = buildDemoPlan(anchor);
        const dates = plan.months.flatMap((m) => m.ops.map((o) => o.date));
        expect(dates.every((d) => d <= anchor)).toBe(true);
        // Orden cronológico global (el reloj simulado nunca retrocede dentro de la carga).
        expect([...dates].sort()).toEqual(dates);
        expect(structuralOf(summarizeModules(anchor))).toEqual(reference);
        // Los asientos de cada operación de módulo se pueden resumir sin error con cualquier ancla.
        expect(() => summarizeDemoPlan(plan)).not.toThrow();
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it('[TC-IDENTITY-DEMO-020] con la ancla 2026-10-05: cierres de Kantuta el 23, cuota 6 del consumo el 2026-09-26 y ocurrencia de internet el 2026-10-03', () => {
    const ops = opsOf('2026-10-05');
    const card = ops.find((o) => o.op === 'card' && o.key === 'kantuta');
    expect(card).toMatchObject({ statementDay: 23, dueDay: 13 });
    expect(buildDemoOracle('2026-10-05').unresolved[0]?.date).toBe('2026-10-03');
    expect(epochDay('2026-10-05') - epochDay('2026-09-26')).toBe(9);
  });

  it('montos como enteros de unidades mínimas → string decimal con la escala de la moneda', () => {
    expect(toDecimal(money(123_456n, 'BOB'))).toBe('1234.56');
    expect(toDecimal(money(5n, 'BTC'))).toBe('0.00000005');
    expect(toDecimal(money(-150_000_000n, 'USDT'))).toBe('-150.000000');
    for (const op of opsOf(FIXED)) {
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
