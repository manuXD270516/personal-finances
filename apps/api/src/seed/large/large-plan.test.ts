import { describe, expect, it } from 'vitest';
import golden from './golden-summary.json' with { type: 'json' };
import {
  anomaliesJsonl,
  buildLargePlan,
  LARGE_MAIN_WORKSPACE_ID,
  LARGE_MANIFEST,
  largeSatelliteId,
  summarizeLargeWorkspace,
} from './large-plan.js';

// docs/29 §2.3 — Large Dataset Seed v1: determinismo, volumen y datos ficticios (el plan completo se arma en < 1 s).
const plan = buildLargePlan();
const main = plan.workspaces[0]!;
const ops = (ws: (typeof plan.workspaces)[number]) => ws.months.flatMap((m) => m.ops);

describe('Large Dataset Seed v1 (docs/29 §2.3)', () => {
  it('es determinista y coincide con su golden summary (saldos del principal y volumen por workspace)', () => {
    expect(buildLargePlan()).toEqual(plan);
    const summary = summarizeLargeWorkspace(main);
    expect({
      datasetVersion: plan.datasetVersion,
      main: summary,
      satellites: plan.workspaces.slice(1).map((w) => summarizeLargeWorkspace(w).counts.transactions),
    }).toEqual(golden);
  });

  it('volumen: 5 años, ≥ 50 000 transacciones en el principal (precondición de NFR-PERF-*), 25 cuentas y 20 satélites de 1 000–5 000', () => {
    const summary = summarizeLargeWorkspace(main);
    expect(main.workspaceId).toBe(LARGE_MAIN_WORKSPACE_ID);
    expect(main.months).toHaveLength(LARGE_MANIFEST.windowMonths);
    expect(main.months[0]?.month).toBe('2021-10');
    expect(main.months.at(-1)?.month).toBe('2026-09');
    expect(summary.counts.transactions).toBeGreaterThanOrEqual(90_000);
    expect(summary.counts.accounts).toBe(25);
    expect(main.counterparties).toHaveLength(600);
    expect(new Set(main.counterparties.map((c) => c.name)).size).toBe(600);
    expect(plan.workspaces).toHaveLength(21);
    expect(plan.workspaces.at(-1)?.workspaceId).toBe(largeSatelliteId(20));
    for (const ws of plan.workspaces.slice(1)) {
      const n = summarizeLargeWorkspace(ws).counts.transactions;
      expect(n).toBeGreaterThanOrEqual(1_000);
      expect(n).toBeLessThanOrEqual(5_200);
    }
  });

  it('montos como enteros positivos de unidades mínimas; splits que suman el total; fechas dentro de la ventana y ordenadas', () => {
    for (const ws of plan.workspaces) {
      for (const month of ws.months) {
        const dates = month.ops.map((o) => o.date);
        expect([...dates].sort()).toEqual(dates);
        expect(dates.every((d) => d.startsWith(month.month))).toBe(true);
      }
      for (const op of ops(ws)) {
        if (op.op === 'income' || op.op === 'expense') {
          expect(op.amount.minor > 0n).toBe(true);
          expect(op.splits.reduce((s, x) => s + x.amount.minor, 0n)).toBe(op.amount.minor);
        }
        if (op.op === 'transfer' || op.op === 'refund') expect(op.amount.minor > 0n).toBe(true);
        if (op.op === 'conversion') expect(op.source.minor > 0n && op.target.minor > 0n).toBe(true);
      }
    }
  });

  it('datos 100 % ficticios: instituciones y contrapartes "Demo", referencias DEMO-', () => {
    for (const ws of plan.workspaces) {
      expect(ws.institutions.every((i) => i.name.includes('Demo'))).toBe(true);
      expect(ws.counterparties.every((c) => /Demo/.test(c.name))).toBe(true);
      expect(ws.accounts.every((a) => a.reference.startsWith('DEMO-'))).toBe(true);
    }
  });

  it('anomalías etiquetadas fuera de la BD (JSONL) por tipo y estacionalidad de diciembre', () => {
    const kinds = new Set(main.anomalies.map((a) => a.kind));
    for (const kind of [
      'OUTLIER',
      'DUPLICATE_CHARGE',
      'NEW_COUNTERPARTY_FRAUD',
      'SUBSCRIPTION_PRICE_HIKE',
    ] as const)
      expect(kinds.has(kind)).toBe(true);
    const keys = new Set(ops(main).flatMap((o) => ('key' in o ? [o.key] : [])));
    for (const a of main.anomalies) if (a.key) expect(keys.has(a.key)).toBe(true);
    const lines = anomaliesJsonl(plan).split('\n');
    expect(lines).toHaveLength(main.anomalies.length);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      workspaceId: LARGE_MAIN_WORKSPACE_ID,
      transactionId: null,
    });
    const perMonth = (mm: string) =>
      main.months.filter((m) => m.month.endsWith(mm)).reduce((n, m) => n + m.ops.length, 0);
    expect(perMonth('-12')).toBeGreaterThan(perMonth('-11'));
  });

  it('escala reducida, meses y satélites acotados para corridas rápidas; escala fuera de rango rechazada', () => {
    const small = buildLargePlan({ scale: 0.05, months: 3, satellites: 2 });
    expect(small.workspaces).toHaveLength(3);
    expect(small.workspaces[0]!.months).toHaveLength(3);
    expect(summarizeLargeWorkspace(small.workspaces[0]!).counts.transactions).toBeLessThan(1_000);
    expect(() => buildLargePlan({ scale: 0 })).toThrow(RangeError);
    expect(() => buildLargePlan({ scale: 1.5 })).toThrow(RangeError);
  });
});
