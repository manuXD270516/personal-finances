import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExpenseHistoryIndex, type ValuedExpense } from './expense-history-index.js';

const expense = (id: string, date: string, value: string, cp: string | null = null): ValuedExpense => ({
  transactionId: id,
  date,
  counterpartyId: cp,
  portions: [{ categoryId: 'cat', value: dec(value) }],
  total: dec(value),
});

describe('ExpenseHistoryIndex', () => {
  const index = new ExpenseHistoryIndex([
    expense('a', '2025-11-11', '10'), // 366 días antes de 2026-11-12: fuera
    expense('b', '2025-11-12', '20', 'cp'), // 365 días antes: dentro
    expense('c', '2026-11-11', '30', 'cp'), // el día anterior: dentro
    expense('d', '2026-11-12', '40', 'cp'), // el mismo día: fuera
    expense('e', '2026-11-13', '50'), // posterior: fuera
  ]);

  it('[TC-FORECAST-ANOMALY-001] la ventana es [fecha − 365, fecha − 1]: sin el mismo día ni los posteriores', () => {
    const h = index.historyFor('2026-11-12');
    expect(h.category('cat').map((v) => v.toFixed(0))).toEqual(['20', '30']);
    expect(h.counterparty('cp').map((v) => v.toFixed(0))).toEqual(['20', '30']);
    expect(h.workspace().map((v) => v.toFixed(0))).toEqual(['20', '30']);
  });

  it('[TC-FORECAST-ANOMALY-006] una contraparte o categoría desconocida no tiene historia', () => {
    const h = index.historyFor('2026-11-12');
    expect(h.counterparty('otra')).toEqual([]);
    expect(h.category('otra')).toEqual([]);
  });
});
