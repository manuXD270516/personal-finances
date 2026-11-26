import { describe, expect, it } from 'vitest';
import {
  BacktestSpendingAnomalies,
  buildBacktestReport,
  formatBacktestReport,
  type AnomalyLabel,
  type BacktestFlag,
} from './backtest-spending-anomalies.js';
import { buildAnomalyWorld, line, restaurantHistory } from './testing/anomaly-in-memory.js';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);
const flag = (transactionId: string): BacktestFlag => ({ transactionId, reasons: ['CATEGORY_OUTLIER'] });

describe('buildBacktestReport', () => {
  // 140 marcados: 100 con etiqueta OUTLIER o NEW_COUNTERPARTY_FRAUD, 10 con otra y 30 sin etiqueta; 125 esperados.
  const positives = [...ids('o', 70), ...ids('f', 30)];
  const others = ids('d', 10);
  const unlabeled = ids('u', 30);
  const labels: AnomalyLabel[] = [
    ...ids('o', 70).map((transactionId) => ({ transactionId, kind: 'OUTLIER' })),
    ...ids('f', 30).map((transactionId) => ({ transactionId, kind: 'NEW_COUNTERPARTY_FRAUD' })),
    ...ids('missed', 25).map((transactionId) => ({ transactionId, kind: 'OUTLIER' })),
    ...others.map((transactionId) => ({ transactionId, kind: 'DUPLICATE_CHARGE' })),
  ];
  const flags = [...positives, ...others, ...unlabeled].map(flag);

  it('[TC-FORECAST-ANOMALY-025] la precisión es 0.7692 (100 de 130) y el recall 0.8000 (100 de 125): la fila pasa', () => {
    const report = buildBacktestReport({ evaluated: 90_000, flags, labels });
    expect(report).toMatchObject({
      flagged: 140,
      truePositives: 100,
      otherLabelFlagged: 10,
      unlabeledFlagged: 30,
      expected: 125,
      precision: '0.7692',
      recall: '0.8000',
      passes: true,
    });
    expect(report.flaggedByLabel).toMatchObject({
      OUTLIER: 70,
      NEW_COUNTERPARTY_FRAUD: 30,
      DUPLICATE_CHARGE: 10,
      NONE: 30,
    });
    expect(report.flaggedByCriterion).toEqual({ CATEGORY_OUTLIER: 140 });
  });

  it('[TC-FORECAST-ANOMALY-025] la fila falla con precisión menor que 0.60 o recall menor que 0.70', () => {
    const noisy = buildBacktestReport({
      evaluated: 1,
      flags: [...flags, ...ids('x', 100).map(flag)],
      labels,
    });
    expect(noisy.precision).toBe('0.4348');
    expect(noisy.passes).toBe(false);
    const quiet = buildBacktestReport({ evaluated: 1, flags: positives.slice(0, 80).map(flag), labels });
    expect(quiet.recall).toBe('0.6400');
    expect(quiet.passes).toBe(false);
  });

  it('[TC-FORECAST-ANOMALY-025] sin marcados ni etiquetas no hay precisión ni recall y la fila falla', () => {
    const report = buildBacktestReport({ evaluated: 0, flags: [], labels: [] });
    expect(report).toMatchObject({ precision: null, recall: null, passes: false });
  });

  it('[TC-FORECAST-ANOMALY-025] el informe no contiene montos ni descripciones', () => {
    const text = formatBacktestReport(buildBacktestReport({ evaluated: 90_000, flags, labels }));
    expect(text).toContain('precision\t0.7692');
    expect(text).toContain('recall\t0.8000');
    expect(text).toContain('result\tPASS');
    expect(text).not.toMatch(/\d+\.\d{2}\s*(BOB|USD)/);
  });
});

describe('BacktestSpendingAnomalies', () => {
  it('[TC-FORECAST-ANOMALY-025] recorre toda la historia en orden, sin persistir, y marca solo los atípicos inyectados', async () => {
    const w = buildAnomalyWorld();
    w.lines.push(...restaurantHistory());
    // Un gasto atípico dentro de la historia (con sus 365 días anteriores) y otro reciente.
    w.lines.push(line({ id: 'old-big', date: '2026-10-05', amount: '400.00' }));
    w.lines.push(line({ id: 'recent-big', date: '2026-11-12', amount: '304.00' }));
    w.lines.push(line({ id: 'normal', date: '2026-11-11', amount: '85.00' }));
    const backtest = new BacktestSpendingAnomalies(w.deps);
    const report = await backtest.report('w1', [
      { transactionId: 'old-big', kind: 'OUTLIER' },
      { transactionId: 'recent-big', kind: 'OUTLIER' },
    ]);
    expect(report).toMatchObject({
      truePositives: 2,
      expected: 2,
      unlabeledFlagged: 0,
      precision: '1.0000',
      recall: '1.0000',
    });
    // No persiste: ningún gasto atípico, evaluación ni aviso.
    expect(w.anomalies.rows.size).toBe(0);
    expect(w.scans.rows.size).toBe(0);
    expect(w.facts).toHaveLength(0);
  });
});
