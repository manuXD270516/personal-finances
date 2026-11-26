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
    expect(h.counterpartyInCategory('cp', 'cat').map((v) => v.toFixed(0))).toEqual(['20', '30']);
  });

  it('[TC-FORECAST-ANOMALY-028] [TC-FORECAST-ANOMALY-029] el índice por par cuenta solo los gastos cuya categoría principal es esa', () => {
    const multi = new ExpenseHistoryIndex([
      {
        transactionId: 'm1',
        date: '2026-10-01',
        counterpartyId: 'cp',
        portions: [
          { categoryId: 'cat-a', value: dec('30') },
          { categoryId: 'cat-b', value: dec('70') },
        ],
        total: dec('100'),
      },
      expense('m2', '2026-10-02', '10', 'cp'),
      {
        transactionId: 'm3',
        date: '2026-10-03',
        counterpartyId: 'cp',
        portions: [{ categoryId: null, value: dec('500') }],
        total: dec('500'),
      },
    ]);
    const h = multi.historyFor('2026-11-12');
    expect(h.counterpartyInCategory('cp', 'cat-b').map((v) => v.toFixed(0))).toEqual(['100']);
    expect(h.counterpartyInCategory('cp', 'cat-a')).toEqual([]);
    expect(h.counterpartyInCategory('cp', 'cat').map((v) => v.toFixed(0))).toEqual(['10']);
    // La historia de la contraparte en todas sus categorías sí cuenta los tres (define si es nueva).
    expect(h.counterparty('cp')).toHaveLength(3);
    expect(h.counterpartyInCategory('otra', 'cat-b')).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-006] una contraparte o categoría desconocida no tiene historia', () => {
    const h = index.historyFor('2026-11-12');
    expect(h.counterparty('otra')).toEqual([]);
    expect(h.category('otra')).toEqual([]);
  });
});
