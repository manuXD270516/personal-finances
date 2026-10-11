import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { GOAL_MOVEMENT_NAMESPACE } from '../contracts/index.js';
import { GoalTransferAdapter } from './goal-transfer.port.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'banco-bob';
const SAVINGS = 'ahorro-bob';
const USD = 'caja-usd';
const GOAL = '0190a000-0000-7000-8000-00000000a001';
const MOVEMENT = '0190a000-0000-7000-8000-00000000a002';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: SAVINGS, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: USD, currency: 'USD', nature: 'ASSET', status: 'ACTIVE' },
    ],
  });
  const service = new TransactionsService(mem.deps);
  return { ...mem, service, port: new GoalTransferAdapter(service) };
}

const input = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  userId: USER,
  businessDate: '2026-10-15',
  fromAccountId: BANK,
  toAccountId: SAVINGS,
  amount: { amount: '1000.00', currency: 'BOB' },
  description: 'Aporte a Fondo de emergencia',
  goalRef: { goalId: GOAL, movementId: MOVEMENT },
  ...over,
});

describe('GoalTransferPort (openspec add-savings-goals, decisión 3)', () => {
  it('[TC-GOALS-SAVINGS-009] crea una transferencia POSTED con origen GOAL y la referencia al movimiento', async () => {
    const { port, service, balanceOf } = setup();
    await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'INCOME',
      transactionDate: '2026-10-01',
      accountId: BANK,
      amount: { amount: '8000.00', currency: 'BOB' },
    });
    const created = await port.recordTransfer(input());
    expect(created.revision).toBe(1);
    const tx = await service.getTransaction(WS, created.transactionId);
    expect(tx).toMatchObject({
      kind: 'TRANSFER',
      status: 'POSTED',
      source: 'GOAL',
      externalRef: { namespace: GOAL_MOVEMENT_NAMESPACE, id: MOVEMENT },
    });
    expect(balanceOf(BANK)).toBe('7000.00');
    expect(balanceOf(SAVINGS)).toBe('1000.00');
  });

  it('[TC-GOALS-SAVINGS-049] la transferencia de un aporte no cuenta como ingreso ni gasto', async () => {
    const { port, balanceOf } = setup();
    await port.recordTransfer(input());
    expect(balanceOf('INCOME')).toBe('0.00');
    expect(balanceOf('EXPENSE')).toBe('0.00');
  });

  it('[TC-GOALS-SAVINGS-049] se puede anular desde Transactions (no queda administrada)', async () => {
    const { port, service } = setup();
    const created = await port.recordTransfer(input());
    const before = await service.getTransaction(WS, created.transactionId);
    const voided = await service.voidTransaction(
      WS,
      created.transactionId,
      before.version,
      'Anulada desde Transactions',
    );
    expect(voided.status).toBe('VOIDED');
  });

  it('[TC-GOALS-SAVINGS-010] propaga los errores de Transactions sin traducir: monedas distintas y misma cuenta', async () => {
    const { port } = setup();
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        if (err instanceof DomainError) return err.code;
        throw err;
      }
      return undefined;
    };
    expect(
      await code(
        port.recordTransfer(input({ toAccountId: USD, amount: { amount: '10.00', currency: 'BOB' } })),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(await code(port.recordTransfer(input({ toAccountId: BANK })))).toBe('TRANSFER_SAME_ACCOUNT');
  });
});
