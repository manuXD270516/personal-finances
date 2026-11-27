import { dec } from '@pf/shared-kernel';
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
const flagWith = (transactionId: string, ...reasons: BacktestFlag['reasons'][number][]): BacktestFlag => ({
  transactionId,
  reasons,
});

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

  it('[TC-FORECAST-ANOMALY-025] la precisión es 0.8519 (115 de 135) y el recall 0.9200 (115 de 125): la fila pasa con 0.80 y 0.85', () => {
    const pos = [...ids('o', 85), ...ids('f', 30)];
    const lab: AnomalyLabel[] = [
      ...ids('o', 85).map((transactionId) => ({ transactionId, kind: 'OUTLIER' })),
      ...ids('f', 30).map((transactionId) => ({ transactionId, kind: 'NEW_COUNTERPARTY_FRAUD' })),
      ...ids('missed', 10).map((transactionId) => ({ transactionId, kind: 'OUTLIER' })),
      ...ids('d', 5).map((transactionId) => ({ transactionId, kind: 'DUPLICATE_CHARGE' })),
    ];
    const report = buildBacktestReport({
      evaluated: 90_000,
      flags: [...pos, ...ids('d', 5), ...ids('u', 20)].map(flag),
      labels: lab,
    });
    expect(report).toMatchObject({
      flagged: 140,
      truePositives: 115,
      otherLabelFlagged: 5,
      unlabeledFlagged: 20,
      expected: 125,
      precision: '0.8519',
      recall: '0.9200',
      passes: true,
    });
  });

  it('[TC-FORECAST-ANOMALY-031] la precisión 0.7692 (100 de 130) y el recall 0.8000 (100 de 125) fallan con 0.80 y 0.85', () => {
    const report = buildBacktestReport({ evaluated: 90_000, flags, labels });
    expect(report).toMatchObject({
      flagged: 140,
      truePositives: 100,
      otherLabelFlagged: 10,
      unlabeledFlagged: 30,
      expected: 125,
      precision: '0.7692',
      recall: '0.8000',
      passes: false,
    });
    expect(report.flaggedByLabel).toMatchObject({
      OUTLIER: 70,
      NEW_COUNTERPARTY_FRAUD: 30,
      DUPLICATE_CHARGE: 10,
      NONE: 30,
    });
    expect(report.flaggedByCriterion).toEqual({ CATEGORY_OUTLIER: 140 });
    expect(report.unlabeledByCriterion).toEqual({ CATEGORY_OUTLIER: 30 });
    expect(report.thresholds).toBeNull();
  });

  it('[TC-FORECAST-ANOMALY-031] los marcados sin etiqueta se reparten por criterio y un gasto con dos motivos cuenta en los dos', () => {
    const report = buildBacktestReport({
      evaluated: 10,
      flags: [
        flagWith('u1', 'CATEGORY_OUTLIER'),
        flagWith('u2', 'COUNTERPARTY_OUTLIER', 'CATEGORY_OUTLIER'),
        flagWith('u3', 'NEW_COUNTERPARTY_HIGH_AMOUNT'),
        flagWith('o-1', 'COUNTERPARTY_OUTLIER'),
      ],
      labels: [{ transactionId: 'o-1', kind: 'OUTLIER' }],
      thresholds: {
        robustZ: dec('15'),
        minRatio: dec('3'),
        minSample: 8,
        newCounterpartyPercentile: 99.5,
      },
    });
    expect(report.unlabeledByCriterion).toEqual({
      CATEGORY_OUTLIER: 2,
      COUNTERPARTY_OUTLIER: 1,
      NEW_COUNTERPARTY_HIGH_AMOUNT: 1,
    });
    expect(report.thresholds).toEqual({
      robustZ: '15',
      minRatio: '3',
      minSample: 8,
      newCounterpartyPercentile: 99.5,
      minPrecision: '0.80',
      minRecall: '0.85',
    });
    const text = formatBacktestReport(report);
    expect(text).toContain('threshold\trobust_z\t15');
    expect(text).toContain('unlabeled_by_criterion\tCATEGORY_OUTLIER\t2');
  });

  it('[TC-FORECAST-ANOMALY-025] la fila falla con precisión menor que 0.80 o recall menor que 0.85, y acepta otros umbrales', () => {
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
    // Con los umbrales de D483 (0.60 y 0.70) el escenario de 0.7692 y 0.8000 pasaría.
    expect(
      buildBacktestReport({ evaluated: 1, flags, labels, minPrecision: '0.60', minRecall: '0.70' }).passes,
    ).toBe(true);
  });

  it('[TC-FORECAST-ANOMALY-025] sin marcados ni etiquetas no hay precisión ni recall y la fila falla', () => {
    const report = buildBacktestReport({ evaluated: 0, flags: [], labels: [] });
    expect(report).toMatchObject({ precision: null, recall: null, passes: false });
  });

  it('[TC-FORECAST-ANOMALY-025] el informe no contiene montos ni descripciones', () => {
    const text = formatBacktestReport(buildBacktestReport({ evaluated: 90_000, flags, labels }));
    expect(text).toContain('precision\t0.7692');
    expect(text).toContain('recall\t0.8000');
    expect(text).toContain('result\tFAIL');
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

  it('[TC-FORECAST-ANOMALY-032] los umbrales por argumento reemplazan a los configurados solo en esa corrida y no persisten nada', async () => {
    const w = buildAnomalyWorld();
    w.lines.push(...restaurantHistory());
    // 150.00 BOB: 1.9 veces la mediana, no pasa con la razón por omisión (3) pero sí con razón 1.5 y puntaje 5.
    w.lines.push(line({ id: 'mid', date: '2026-11-12', amount: '150.00' }));
    const backtest = new BacktestSpendingAnomalies(w.deps);
    const configured = { ...w.deps.settings.thresholds };
    const defaults = await backtest.report('w1', [{ transactionId: 'mid', kind: 'OUTLIER' }]);
    expect(defaults).toMatchObject({ flagged: 0, truePositives: 0, recall: '0.0000' });
    expect(defaults.thresholds).toMatchObject({ robustZ: '15', newCounterpartyPercentile: 99.5 });
    const grid = await backtest.report('w1', [{ transactionId: 'mid', kind: 'OUTLIER' }], {
      robustZ: dec('5'),
      minRatio: dec('1.5'),
    });
    expect(grid).toMatchObject({ flagged: 1, truePositives: 1, recall: '1.0000' });
    expect(grid.thresholds).toMatchObject({ robustZ: '5', minRatio: '1.5', minSample: 8 });
    // La configuración no cambia y no se persiste nada.
    expect(w.deps.settings.thresholds).toEqual(configured);
    expect(w.anomalies.rows.size).toBe(0);
    expect(w.scans.rows.size).toBe(0);
  });
});
