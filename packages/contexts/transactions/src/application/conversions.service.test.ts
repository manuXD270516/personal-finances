import fc from 'fast-check';
import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ConversionsService, type RecordConversionCommand } from './conversions.service.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const WALLET_USDT = 'wallet-usdt';
const BANK_BOB = 'bank-bob';
const CASH_BOB = 'cash-bob';
const WALLET_BTC = 'wallet-btc';
const WALLET_TRX = 'wallet-trx';
const ARCHIVED = 'archived-bob';
const EXECUTED = '2026-09-30T18:42:00Z'; // 2026-09-30T14:42:00-04:00

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: WALLET_USDT, currency: 'USDT', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: BANK_BOB, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: CASH_BOB, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: WALLET_BTC, currency: 'BTC', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: WALLET_TRX, currency: 'TRX', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: ARCHIVED, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' },
    ],
  });
  // R2 = USDT/BOB 6.95 P2P vigente desde 2026-09-29T15:00:00-04:00.
  mem.addRate({
    id: 'R2',
    base: 'USDT',
    quote: 'BOB',
    value: '6.95',
    rateType: 'P2P',
    asOf: '2026-09-29T19:00:00Z',
  });
  return {
    ...mem,
    conversions: new ConversionsService(mem.deps),
    transactions: new TransactionsService(mem.deps),
  };
}

const canonicalCmd = (over: Partial<RecordConversionCommand> = {}): RecordConversionCommand => ({
  workspaceId: WS,
  userId: USER,
  transactionDate: '2026-09-30',
  sourceAccountId: WALLET_USDT,
  targetAccountId: BANK_BOB,
  sourceAmount: { amount: '100.000000', currency: 'USDT' },
  targetAmount: { amount: '685.00', currency: 'BOB' },
  quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
  fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
  provider: { name: 'Binance P2P' },
  executedAt: EXECUTED,
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

/** Ingreso inicial en una cuenta (para partir de los saldos de los TC). */
async function deposit(t: TransactionsService, accountId: string, amount: string, currency: string) {
  await t.recordTransaction({
    workspaceId: WS,
    userId: USER,
    kind: 'INCOME',
    transactionDate: '2026-09-01',
    accountId,
    amount: { amount, currency },
  });
}

describe('RecordConversion (transactions/conversions)', () => {
  it('[TC-TRANSACTIONS-CONVERSION-001] canónica USDT→BOB: saldos, asiento por moneda, detalle, ConversionRecorded y auditoría', async () => {
    const { conversions, transactions, state, balanceOf } = setup();
    await deposit(transactions, WALLET_USDT, '100.000000', 'USDT');
    const { transaction: s, totalCost } = await conversions.recordConversion(canonicalCmd());
    expect([s.kind, s.status, s.revision]).toEqual(['CONVERSION', 'POSTED', 1]);
    expect(balanceOf(WALLET_USDT, 'USDT')).toBe('0.000000');
    expect(balanceOf(BANK_BOB, 'BOB')).toBe('685.00');
    expect(balanceOf('FX_TRADING', 'USDT')).toBe('100.000000');
    expect(balanceOf('FX_TRADING', 'BOB')).toBe('-690.00');
    expect(balanceOf('EXPENSE', 'BOB')).toBe('5.00');
    const entry = state.entries.at(-1);
    expect(entry?.postings.map((p) => `${p.key} ${p.amount} ${p.currency}`)).toEqual([
      `${WALLET_USDT} -100.000000 USDT`,
      'FX_TRADING 100.000000 USDT',
      'FX_TRADING -690.00 BOB',
      `${BANK_BOB} 685.00 BOB`,
      'EXPENSE 5.00 BOB',
    ]);
    expect(
      entry?.command?.postings.find((p) => p.target.kind === 'SYSTEM' && p.target.systemKind === 'EXPENSE')
        ?.splitId,
    ).toBe(s.splits[0]?.id);
    expect(s.splits.map((x) => x.categoryId)).toEqual(['cat-fees']);
    const d = s.conversion;
    expect([d?.referenceRate?.fxRateId, d?.referenceRate?.rateType, d?.spread?.percentage]).toEqual([
      'R2',
      'P2P',
      '0.719424460431654676',
    ]);
    expect(totalCost).toEqual({
      amount: { amount: '10.00', currency: 'BOB' },
      complete: true,
      missingValuations: [],
    });
    const recorded = state.outbox.filter((e) => e.eventType === 'transactions.ConversionRecorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toMatchObject({
      transactionId: s.id,
      journalEntryId: s.activeEntryId,
      source: { accountId: WALLET_USDT, amount: { amount: '100.000000', currency: 'USDT' } },
      target: { accountId: BANK_BOB, amount: { amount: '685.00', currency: 'BOB' } },
      quotedRate: { base: 'USDT', quote: 'BOB', value: '6.9' },
      effectiveRate: { base: 'USDT', quote: 'BOB', value: '6.850000000000000000' },
      referenceRate: { fxRateId: 'R2', rate: { value: '6.95' }, source: 'MANUAL', rateType: 'P2P' },
      fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' }, paidFromAccountId: null }],
      spread: { percentage: '0.719424460431654676', amount: { amount: '5.00', currency: 'BOB' } },
      provider: { counterpartyId: null, name: 'Binance P2P' },
      revision: 1,
      grossTarget: { amount: '690.00', currency: 'BOB' },
    });
    expect(state.outbox.map((e) => e.eventType).slice(-3)).toEqual([
      'transactions.TransactionCreated',
      'transactions.TransactionPosted',
      'transactions.ConversionRecorded',
    ]);
    expect(state.audit.at(-1)?.action).toBe('transactions.conversion.created');
  });

  it('[TC-TRANSACTIONS-CONVERSION-005] fee de red en TRX desde Wallet TRX: el mismo asiento mueve TRX y lo registra como gasto', async () => {
    const { conversions, transactions, balanceOf } = setup();
    await deposit(transactions, WALLET_USDT, '1000.000000', 'USDT');
    await deposit(transactions, WALLET_TRX, '50.000000', 'TRX');
    const { transaction: s, totalCost } = await conversions.recordConversion(
      canonicalCmd({
        targetAccountId: WALLET_BTC,
        sourceAmount: { amount: '1000.000000', currency: 'USDT' },
        targetAmount: { amount: '0.01600000', currency: 'BTC' },
        quotedRate: { base: 'BTC', quote: 'USDT', value: '62375' },
        fees: [
          { type: 'PROVIDER', amount: { amount: '2.000000', currency: 'USDT' } },
          {
            type: 'NETWORK',
            amount: { amount: '15.000000', currency: 'TRX' },
            paidFromAccountId: WALLET_TRX,
          },
        ],
      }),
    );
    expect(balanceOf(WALLET_TRX, 'TRX')).toBe('35.000000');
    expect(balanceOf(WALLET_BTC, 'BTC')).toBe('0.01600000');
    expect(balanceOf('EXPENSE', 'TRX')).toBe('15.000000');
    expect(balanceOf('EXPENSE', 'USDT')).toBe('2.000000');
    expect(s.conversion?.effectiveRate.toPersisted()).toBe('62500.000000000000000000');
    // [TC-FX-PRICING-004] sin tasa TRX/BOB ni BTC/BOB: el costo queda incompleto e indica lo que falta valorar.
    expect(totalCost?.complete).toBe(false);
    expect(totalCost?.missingValuations).toContainEqual({ amount: '15.000000', currency: 'TRX' });
  });

  it('[TC-TRANSACTIONS-CONVERSION-002] BTC→USDT con fee de red descontado del origen deja BTC Wallet en 0 y USDT Wallet en 700', async () => {
    const { conversions, transactions, balanceOf } = setup();
    await deposit(transactions, WALLET_BTC, '0.01250000', 'BTC');
    await deposit(transactions, WALLET_USDT, '100.000000', 'USDT');
    const { transaction: s } = await conversions.recordConversion(
      canonicalCmd({
        transactionDate: '2026-09-02',
        sourceAccountId: WALLET_BTC,
        targetAccountId: WALLET_USDT,
        sourceAmount: { amount: '0.01250000', currency: 'BTC' },
        targetAmount: { amount: '600.000000', currency: 'USDT' },
        quotedRate: { base: 'BTC', quote: 'USDT', value: '50000' },
        fees: [{ type: 'NETWORK', amount: { amount: '0.00050000', currency: 'BTC' } }],
      }),
    );
    expect(balanceOf(WALLET_BTC, 'BTC')).toBe('0.00000000');
    expect(balanceOf(WALLET_USDT, 'USDT')).toBe('700.000000');
    expect(balanceOf('FX_TRADING', 'BTC')).toBe('0.01200000');
    expect(s.conversion?.effectiveRate.toPersisted()).toBe('48000.000000000000000000');
    expect(s.conversion?.fees.map((f) => `${f.type} ${f.amount.toString()}`)).toEqual([
      'NETWORK 0.00050000 BTC',
    ]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-003] misma moneda y monto en otra moneda se rechazan sin crear transacción ni asiento', async () => {
    const { conversions, state } = setup();
    expect(
      await codeOf(
        conversions.recordConversion(
          canonicalCmd({
            sourceAccountId: BANK_BOB,
            targetAccountId: CASH_BOB,
            sourceAmount: { amount: '100.00', currency: 'BOB' },
            targetAmount: { amount: '100.00', currency: 'BOB' },
            fees: [],
          }),
        ),
      ),
    ).toBe('CONVERSION_SAME_CURRENCY');
    expect(
      await codeOf(
        conversions.recordConversion(canonicalCmd({ sourceAmount: { amount: '100.00', currency: 'USD' } })),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect([state.txs.size, state.entries.length, state.outbox.length]).toEqual([0, 0, 0]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-006] fees inconsistentes se rechazan con CONVERSION_AMOUNTS_INCONSISTENT sin persistir', async () => {
    const { conversions, state } = setup();
    expect(
      await codeOf(
        conversions.recordConversion(
          canonicalCmd({
            sourceAmount: { amount: '1.000000', currency: 'USDT' },
            targetAmount: { amount: '6.85', currency: 'BOB' },
            quotedRate: null,
            fees: [{ type: 'PROVIDER', amount: { amount: '1.500000', currency: 'USDT' } }],
          }),
        ),
      ),
    ).toBe('CONVERSION_AMOUNTS_INCONSISTENT');
    expect(
      await codeOf(
        conversions.recordConversion(
          canonicalCmd({ fees: [{ type: 'NETWORK', amount: { amount: '15.000000', currency: 'TRX' } }] }),
        ),
      ),
    ).toBe('CONVERSION_AMOUNTS_INCONSISTENT');
    expect([state.txs.size, state.entries.length]).toEqual([0, 0]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-007] montos con más decimales que la escala ⇒ AMOUNT_SCALE_EXCEEDED (sin redondeo)', async () => {
    const { conversions, state } = setup();
    expect(
      await codeOf(
        conversions.recordConversion(
          canonicalCmd({ sourceAmount: { amount: '100.0000001', currency: 'USDT' } }),
        ),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(
      await codeOf(
        conversions.recordConversion(
          canonicalCmd({ fees: [{ type: 'PROVIDER', amount: { amount: '5.001', currency: 'BOB' } }] }),
        ),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(state.txs.size).toBe(0);
  });

  it('cuentas archivadas (INV-026) o auditoría fallida: nada se persiste (misma unidad de trabajo)', async () => {
    const { conversions, state, faults } = setup();
    expect(await codeOf(conversions.recordConversion(canonicalCmd({ targetAccountId: ARCHIVED })))).toBe(
      'ACCOUNT_ARCHIVED',
    );
    faults.audit = new Error('audit down');
    await expect(conversions.recordConversion(canonicalCmd())).rejects.toThrow('audit down');
    expect([state.txs.size, state.entries.length, state.outbox.length]).toEqual([0, 0, 0]);
  });
});

describe('Referencia y no-recálculo (fx/conversion-pricing, INV-012)', () => {
  it('[TC-FX-PRICING-006] la referencia se resuelve al executedAt (R2) y no cambia si R2 se reemplaza por R3 = 6.97', async () => {
    const { conversions, addRate } = setup();
    const { transaction: s } = await conversions.recordConversion(canonicalCmd());
    addRate({
      id: 'R3',
      base: 'USDT',
      quote: 'BOB',
      value: '6.97',
      rateType: 'P2P',
      asOf: '2026-09-29T19:00:00Z',
      supersedes: 'R2',
    });
    const again = await conversions.getConversion(WS, s.id);
    const d = again.transaction.conversion;
    expect([
      d?.referenceRate?.fxRateId,
      d?.referenceRate?.rate.value.toFixed(),
      d?.spread?.percentage,
    ]).toEqual(['R2', '6.95', '0.719424460431654676']);
    expect(again.totalCost?.amount).toEqual({ amount: '10.00', currency: 'BOB' });
  });

  it('[TC-FX-PRICING-003] sin tasa dentro de la ventana: referencia y spread vacíos, efectiva 6.85; sin cotizada: referencia sí, spread no', async () => {
    const { conversions } = setup();
    const late = await conversions.recordConversion(canonicalCmd({ executedAt: '2026-10-10T16:00:00Z' }));
    expect([late.transaction.conversion?.referenceRate, late.transaction.conversion?.spread]).toEqual([
      null,
      null,
    ]);
    expect(late.transaction.conversion?.effectiveRate.toPersisted()).toBe('6.850000000000000000');
    const noQuoted = await conversions.recordConversion(canonicalCmd({ quotedRate: null }));
    expect(noQuoted.transaction.conversion?.referenceRate?.fxRateId).toBe('R2');
    expect(noQuoted.transaction.conversion?.spread).toBeNull();
  });

  it('[TC-TRANSACTIONS-CONVERSION-009] ninguna secuencia de tasas nuevas o reemplazos posteriores recalcula la conversión ni su asiento', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            days: fc.integer({ min: 0, max: 30 }),
            cents: fc.integer({ min: 600, max: 800 }),
            supersede: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        async (events) => {
          const { conversions, state, addRate } = setup();
          const { transaction: s } = await conversions.recordConversion(canonicalCmd());
          const before = JSON.stringify(s.conversion);
          const entries = JSON.stringify(state.entries);
          let current = 'R2';
          for (const [i, e] of events.entries()) {
            const value = (e.cents / 100).toFixed(2);
            if (e.supersede) {
              const id = `S${i}`;
              addRate({
                id,
                base: 'USDT',
                quote: 'BOB',
                value,
                rateType: 'P2P',
                asOf: '2026-09-29T19:00:00Z',
                supersedes: current,
              });
              current = id;
            } else {
              const asOf = new Date(Date.parse('2026-10-01T00:00:00Z') + e.days * 86_400_000).toISOString();
              addRate({ id: `N${i}`, base: 'USDT', quote: 'BOB', value, rateType: 'P2P', asOf });
            }
          }
          const after = await conversions.getConversion(WS, s.id);
          expect(JSON.stringify(after.transaction.conversion)).toBe(before);
          expect(JSON.stringify(state.entries)).toBe(entries);
          expect(after.transaction.conversion?.targetAmount.toFixed()).toBe('685.00');
          expect(after.totalCost?.amount.amount).toBe('10.00');
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('AmendConversion y revisiones', () => {
  it('[TC-TRANSACTIONS-CONVERSION-010] corregir a 686.00 BOB (fee 4.00): reversa exacta, asiento nuevo, detalle rev. 2 y rev. 1 consultable', async () => {
    const { conversions, transactions, state, balanceOf } = setup();
    await deposit(transactions, WALLET_USDT, '100.000000', 'USDT');
    const { transaction: original } = await conversions.recordConversion(canonicalCmd());
    const originalEntry = state.entries.at(-1);
    const { transaction: amended } = await conversions.amendConversion({
      ...canonicalCmd({
        targetAmount: { amount: '686.00', currency: 'BOB' },
        fees: [{ type: 'PROVIDER', amount: { amount: '4.00', currency: 'BOB' } }],
      }),
      transactionId: original.id,
      expectedVersion: original.version,
      reason: 'monto real según extracto',
    });
    const [reversal, posted] = state.entries.slice(-2);
    expect(reversal?.reverses).toBe(originalEntry?.id);
    expect(reversal?.postings.map((p) => `${p.key} ${p.amount}`)).toEqual(
      originalEntry?.postings.map(
        (p) => `${p.key} ${p.amount.startsWith('-') ? p.amount.slice(1) : `-${p.amount}`}`,
      ),
    );
    expect(posted?.postings.map((p) => `${p.key} ${p.amount} ${p.currency}`)).toEqual([
      `${WALLET_USDT} -100.000000 USDT`,
      'FX_TRADING 100.000000 USDT',
      'FX_TRADING -690.00 BOB',
      `${BANK_BOB} 686.00 BOB`,
      'EXPENSE 4.00 BOB',
    ]);
    expect(balanceOf(BANK_BOB, 'BOB')).toBe('686.00');
    expect(balanceOf('EXPENSE', 'BOB')).toBe('4.00');
    expect([amended.revision, amended.conversion?.effectiveRate.toPersisted()]).toEqual([
      2,
      '6.860000000000000000',
    ]);
    const revisions = await conversions.listRevisions(WS, original.id);
    expect(
      revisions.map((r) => [r.revision, r.active, r.detail.targetAmount.toFixed(), r.journalEntryId]),
    ).toEqual([
      [1, false, '685.00', originalEntry?.id],
      [2, true, '686.00', posted?.id],
    ]);
    const audit = state.audit.at(-1);
    expect([audit?.action, audit?.reason]).toEqual([
      'transactions.conversion.amended',
      'monto real según extracto',
    ]);
    const recorded = state.outbox.filter((e) => e.eventType === 'transactions.ConversionRecorded');
    expect(recorded.map((e) => e.payload['revision'])).toEqual([1, 2]);
    expect(
      await codeOf(
        conversions.amendConversion({
          ...canonicalCmd(),
          transactionId: original.id,
          expectedVersion: original.version,
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
  });

  it('[TC-TRANSACTIONS-CONVERSION-011] un único ConversionRecorded por revisión posteada; PENDING no publica hasta postearse', async () => {
    const { conversions, transactions, state } = setup();
    const { transaction: pending } = await conversions.recordConversion(canonicalCmd({ status: 'PENDING' }));
    expect(state.outbox.filter((e) => e.eventType === 'transactions.ConversionRecorded')).toHaveLength(0);
    expect(state.entries).toHaveLength(0);
    const posted = await transactions.postTransaction(WS, pending.id, pending.version);
    const recorded = state.outbox.filter((e) => e.eventType === 'transactions.ConversionRecorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload['journalEntryId']).toBe(posted.activeEntryId);
  });

  it('la conversión se anula con reversa y no admite cambios financieros por PATCH /transactions', async () => {
    const { conversions, transactions, balanceOf } = setup();
    const { transaction: s } = await conversions.recordConversion(canonicalCmd());
    expect(
      await codeOf(
        transactions.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: s.id,
          expectedVersion: s.version,
          amount: { amount: '50.000000', currency: 'USDT' },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    await transactions.voidTransaction(WS, s.id, s.version, 'duplicada');
    expect(balanceOf(BANK_BOB, 'BOB')).toBe('0.00');
    expect(balanceOf('FX_TRADING', 'USDT')).toBe('0.000000');
  });
});

describe('PreviewConversion (sin efectos)', () => {
  it('100.000000 USDT + cotizada 6.90 + fee 5.00 BOB ⇒ 685.00 BOB, efectiva 6.85, costo total 10.00 BOB; nada se registra', async () => {
    const { conversions, state } = setup();
    const p = await conversions.previewConversion({
      workspaceId: WS,
      sourceCurrency: 'USDT',
      targetCurrency: 'BOB',
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
      fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
      executedAt: EXECUTED,
    });
    expect([p.targetAmount.toString(), p.effectiveRate.toPersisted(), p.totalCost.amount.amount]).toEqual([
      '685.00 BOB',
      '6.850000000000000000',
      '10.00',
    ]);
    expect(p.referenceRate?.fxRateId).toBe('R2');
    const rate = await conversions.previewConversion({
      workspaceId: WS,
      sourceCurrency: 'USDT',
      targetCurrency: 'BOB',
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: { amount: '690.00', currency: 'BOB' },
      executedAt: EXECUTED,
    });
    expect(rate.quotedRate?.toPersisted()).toBe('6.900000000000000000');
    expect([state.txs.size, state.entries.length, state.outbox.length, state.audit.length]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      await codeOf(
        conversions.previewConversion({ workspaceId: WS, sourceCurrency: 'USDT', targetCurrency: 'USDT' }),
      ),
    ).toBe('CONVERSION_SAME_CURRENCY');
  });
});
