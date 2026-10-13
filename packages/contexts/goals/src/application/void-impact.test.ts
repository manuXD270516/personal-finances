import { describe, expect, it } from 'vitest';
import { BANK, EDITOR, SAVINGS, WS, GoalsWorld, codeOf } from './testing/goals-world.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });

/** "Fondo de emergencia" con 1000.00 BOB aportados a "Ahorro BOB" (transferencia del 2026-10-01) y 400.00 retirados. */
async function aporteConRetiro() {
  const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
  w.setBalance(BANK, '8000.00');
  const fund = await w.emergencyFund();
  const aporte = await w.contribute(fund.id, '1000.00', { businessDate: '2026-10-01' });
  await w.movements.withdraw({
    workspaceId: WS,
    userId: EDITOR,
    goalId: fund.id,
    fund: 'REAL',
    accountId: SAVINGS,
    amount: bob('400.00'),
    mode: { type: 'TRANSFER', toAccountId: BANK },
  });
  return { w, fund, aporte, txId: aporte.transactionId as string };
}

describe('Anular un aporte con un retiro posterior (fix-phase-4-gaps, D222)', () => {
  it('[TC-GOALS-SAVINGS-051] el impacto avisa −400.00 BOB, la anulación no se rechaza y la meta informa el faltante', async () => {
    const { w, fund, aporte, txId } = await aporteConRetiro();
    const before = await w.queries.get(WS, fund.id);
    expect(before.progress.total).toEqual(bob('600.00'));
    expect(before.negativeFunds).toEqual([]);

    const impact = await w.queries.previewVoidImpact(WS, txId);
    expect(impact.goals).toEqual([
      {
        goalId: fund.id,
        goalName: 'Fondo de emergencia',
        accountId: SAVINGS,
        accountName: 'Ahorro BOB',
        fund: 'REAL',
        currency: 'BOB',
        currentFunds: bob('600.00'),
        fundsAfterVoid: bob('-400.00'),
        negative: true,
      },
    ]);

    w.voidTransaction(txId);
    await w.reactions.onTransactionChange(w.voidedEvent(txId));
    await w.reactions.onTransactionChange(w.voidedEvent(txId));

    const movements = w.movementsOf(fund.id).map((m) => `${m.kind}:${m.amount.toFixed()}`);
    expect(movements).toEqual(['CONTRIBUTION:1000.00', 'WITHDRAWAL:-400.00', 'REVERSAL:-1000.00']);
    expect(w.movementsOf(fund.id)[2]?.reversesId).toBe(aporte.id);
    const after = await w.queries.get(WS, fund.id);
    expect(after.progress.total).toEqual(bob('-400.00'));
    expect(after.negativeFunds).toEqual([{ accountId: SAVINGS, amount: bob('-400.00') }]);
    expect((await w.queries.list(WS)).data[0]?.negativeFunds).toEqual(after.negativeFunds);
  });

  it('[TC-GOALS-SAVINGS-052] la vista previa no modifica nada, es vacía sin movimientos de meta y es 404 sin la transacción', async () => {
    const { w, fund, txId } = await aporteConRetiro();
    const movements = w.movementStore.length;
    const version = w.versionOf(fund.id);
    await w.queries.previewVoidImpact(WS, txId);
    expect(w.movementStore).toHaveLength(movements);
    expect(w.versionOf(fund.id)).toBe(version);

    const income = w.seedIncome({ account: BANK, amount: '10.00' });
    expect(await w.queries.previewVoidImpact(WS, income)).toEqual({ transactionId: income, goals: [] });
    expect(await codeOf(() => w.queries.previewVoidImpact(WS, '0190a000-0000-7000-8000-00000000dead'))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-GOALS-SAVINGS-051] una transacción ya anulada no tiene impacto pendiente y regularizar quita el faltante', async () => {
    const { w, fund, txId } = await aporteConRetiro();
    w.voidTransaction(txId);
    await w.reactions.onTransactionChange(w.voidedEvent(txId));
    expect((await w.queries.previewVoidImpact(WS, txId)).goals).toEqual([]);
    // El usuario regulariza aportando 400.00 BOB: los fondos vuelven a cero y el faltante desaparece.
    await w.contribute(fund.id, '400.00');
    expect((await w.queries.get(WS, fund.id)).negativeFunds).toEqual([]);
  });
});
