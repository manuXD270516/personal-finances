import { describe, expect, it } from 'vitest';
import { evaluateReportsReadModelAlert, REPORTS_READ_MODEL_ALERT } from './reports-read-model-alert.js';

const days = (
  n: number,
  p95Seconds: number,
  report: 'EXPENSES_BY_CATEGORY' | 'INCOME_EXPENSES' = 'EXPENSES_BY_CATEGORY',
) => Array.from({ length: n }, () => ({ report, p95Seconds }));

describe('ReportsReadModelRecommended (add-financial-reports)', () => {
  it('[TC-REPORTING-REPORTS-032] p95 de 0.64 s durante 7 días dispara la alerta para el reporte de gastos por categoría', () => {
    const state = evaluateReportsReadModelAlert([...days(7, 0.64), ...days(7, 0.2, 'INCOME_EXPENSES')]);
    expect(state.firing).toBe(true);
    expect(state.reports).toEqual(['EXPENSES_BY_CATEGORY']);
    expect(state.runbook).toContain('add-financial-reports');
  });

  it('[TC-REPORTING-REPORTS-032] 6 días lentos no bastan, un día bueno rompe la ventana y el umbral es exclusivo', () => {
    expect(evaluateReportsReadModelAlert(days(6, 0.64)).firing).toBe(false);
    expect(evaluateReportsReadModelAlert([...days(3, 0.64), ...days(1, 0.1), ...days(3, 0.64)]).firing).toBe(
      false,
    );
    expect(evaluateReportsReadModelAlert(days(7, REPORTS_READ_MODEL_ALERT.p95ThresholdSeconds)).firing).toBe(
      false,
    );
  });
});
