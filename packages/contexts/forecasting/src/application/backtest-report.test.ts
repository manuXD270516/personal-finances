import { describe, expect, it } from 'vitest';
import { BacktestReport } from './backtest-report.js';

const s = (
  scope: 'TOTAL_EXPENSE' | 'TOTAL_INCOME' | 'CATEGORY' | 'CATEGORY_GROUP',
  mase: string | null,
  baselineMase: string | null,
  selectedBy: 'BACKTEST' | 'BASELINE_FALLBACK' | 'SIMPLE' | null = 'BACKTEST',
  coverage80: string | null = '0.8000',
) => ({ scope, status: 'PUBLISHED' as const, selectedBy, mase, baselineMase, coverage80 });

describe('BacktestReport', () => {
  it('[TC-FORECAST-EXPENSE-010] agrega MASE publicado y de la referencia por tipo de serie, sin montos ni nombres', () => {
    const rows = BacktestReport.aggregate([
      s('TOTAL_EXPENSE', '0.7800', '0.9000'),
      s('CATEGORY', '0.8000', '1.0000'),
      s('CATEGORY_GROUP', '0.9000', '0.9000', 'BASELINE_FALLBACK', '0.6000'),
      s('CATEGORY', null, null, 'SIMPLE', null),
    ]);
    expect(rows.find((r) => r.type === 'TOTAL_EXPENSE')).toEqual({
      type: 'TOTAL_EXPENSE',
      seriesCount: 1,
      modelPublished: 1,
      meanMasePublished: '0.7800',
      meanMaseBaseline: '0.9000',
      beatBaseline: 1,
      meanCoverage80: '0.8000',
    });
    expect(rows.find((r) => r.type === 'CATEGORY')).toMatchObject({
      seriesCount: 2,
      modelPublished: 1,
      meanMasePublished: '0.8500',
      meanMaseBaseline: '0.9500',
      beatBaseline: 1,
      meanCoverage80: '0.7000',
    });
    expect(rows.find((r) => r.type === 'TOTAL_INCOME')).toMatchObject({
      seriesCount: 0,
      meanMasePublished: null,
    });
    const text = BacktestReport.format(rows);
    expect(text.split('\n')).toHaveLength(4);
    expect(text).not.toMatch(/[A-Za-z]+ [A-Za-z]+.*BOB/);
  });
});
