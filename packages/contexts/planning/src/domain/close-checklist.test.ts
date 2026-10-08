import { describe, expect, it } from 'vitest';
import { CloseChecklistEvaluator, type ChecklistInput, type Finding } from './close-checklist.js';
import { ClosingPolicy, DEFAULT_SEVERITIES } from './closing-policy.js';

const none: Finding = { count: 0, amounts: [], details: [], truncated: false };
const base = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({
  severities: DEFAULT_SEVERITIES,
  pending: none,
  duplicates: none,
  uncategorized: none,
  unreconciled: [],
  withoutStatement: [],
  ...over,
});
const bob = (amount: string) => ({ amount, currency: 'BOB' });

describe('CloseChecklistEvaluator', () => {
  it('[TC-PLANNING-CHECKLIST-001] informa pendientes, cuentas sin conciliar, duplicados y sin categoría; recurrentes no disponibles', () => {
    const c = CloseChecklistEvaluator.evaluate(
      base({
        pending: { count: 2, amounts: [bob('165.00')], details: [], truncated: false },
        duplicates: { count: 1, amounts: [], details: [], truncated: false },
        uncategorized: { count: 3, amounts: [bob('210.00')], details: [], truncated: false },
        unreconciled: [
          { accountId: 'a1', name: 'USD Savings', balance: { amount: '1500.00', currency: 'USD' } },
        ],
      }),
    );
    const by = Object.fromEntries(c.items.map((i) => [i.kind, i]));
    expect(by['PENDING_TRANSACTIONS']).toMatchObject({
      count: 2,
      amounts: [bob('165.00')],
      severity: 'BLOCKING',
    });
    expect(by['UNRECONCILED_ACCOUNTS']).toMatchObject({ count: 1, severity: 'BLOCKING' });
    expect(by['UNRESOLVED_DUPLICATES']).toMatchObject({ count: 1, severity: 'WARNING' });
    expect(by['UNCATEGORIZED']).toMatchObject({ count: 3, amounts: [bob('210.00')] });
    expect(by['UNRESOLVED_RECURRING']).toMatchObject({ availability: 'NOT_AVAILABLE', count: 0 });
    expect(c.canClose).toBe(false);
    expect(c.blockingItems.map((i) => i.kind)).toEqual(['PENDING_TRANSACTIONS', 'UNRECONCILED_ACCOUNTS']);
  });

  it('[TC-PLANNING-CHECKLIST-001] sin observaciones se puede cerrar sin advertencias', () => {
    const c = CloseChecklistEvaluator.evaluate(base());
    expect(c.items.every((i) => i.count === 0)).toBe(true);
    expect(c).toMatchObject({ canClose: true, requiresAcknowledgement: false });
  });

  it('[TC-PLANNING-CLOSE-003] solo advertencias ⇒ exige reconocimiento', () => {
    const c = CloseChecklistEvaluator.evaluate(
      base({ uncategorized: { count: 3, amounts: [bob('210.00')], details: [], truncated: false } }),
    );
    expect(c).toMatchObject({ canClose: true, requiresAcknowledgement: true });
    expect(c.warningItems.map((i) => i.kind)).toEqual(['UNCATEGORIZED']);
  });

  it('[TC-PLANNING-CHECKLIST-002] la política cambia las severidades; las cinco claves son obligatorias', () => {
    const policy = ClosingPolicy.defaults('w');
    const changes = policy.update(
      { ...DEFAULT_SEVERITIES, UNCATEGORIZED: 'BLOCKING' },
      'u1',
      '2026-10-05T00:00:00Z',
    );
    expect(changes).toEqual([{ kind: 'UNCATEGORIZED', before: 'WARNING', after: 'BLOCKING' }]);
    const c = CloseChecklistEvaluator.evaluate(
      base({
        severities: policy.severities,
        uncategorized: { count: 3, amounts: [], details: [], truncated: false },
      }),
    );
    expect(c.canClose).toBe(false);
    expect(() => policy.update({ PENDING_TRANSACTIONS: 'WARNING' }, 'u1', 'x')).toThrow();
  });

  it('[TC-PLANNING-CHECKLIST-005] cuentas sin conciliar como advertencia no bloquean pero exigen reconocimiento', () => {
    const c = CloseChecklistEvaluator.evaluate(
      base({
        severities: { ...DEFAULT_SEVERITIES, UNRECONCILED_ACCOUNTS: 'WARNING' },
        unreconciled: [
          { accountId: 'a1', name: 'USD Savings', balance: { amount: '1.00', currency: 'USD' } },
        ],
      }),
    );
    expect(c).toMatchObject({ canClose: true, requiresAcknowledgement: true });
  });

  it('[TC-PLANNING-CHECKLIST-004] la conciliada sin extracto es INFO: ni bloquea ni exige reconocimiento', () => {
    const c = CloseChecklistEvaluator.evaluate(
      base({
        withoutStatement: [
          {
            accountId: 'caja',
            name: 'Caja BOB',
            transactions: [{ transactionId: 'c1', businessDate: '2026-10-12', amount: bob('80.00') }],
          },
        ],
      }),
    );
    const item = c.items.find((i) => i.kind === 'RECONCILED_WITHOUT_STATEMENT');
    expect(item).toMatchObject({ severity: 'INFO', count: 1, amounts: [bob('80.00')] });
    expect(item?.details.map((d) => d.refId)).toEqual(['caja', 'c1']);
    expect(c.items.find((i) => i.kind === 'UNRECONCILED_ACCOUNTS')?.count).toBe(0);
    expect(c).toMatchObject({ canClose: true, requiresAcknowledgement: false });
  });

  it('reconciliación no disponible con severidad bloqueante bloquea (P-A9)', () => {
    const c = CloseChecklistEvaluator.evaluate(base({ unreconciled: null }));
    expect(c.canClose).toBe(false);
  });
});
