import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { currency, Money, Rate, type Currency } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  displayOrientation,
  Transaction,
  type ConversionData,
  type CurrencyKindLike,
} from '../../src/domain/index.js';
import { PgTransactionRepository } from '../../src/infrastructure/pg-transactions.js';

// Conversiones en PostgreSQL real (add-manual-conversions tarea 4.3): legs multimoneda (SOURCE/TARGET/FEE), splits de
// fees en su moneda, ConversionDetail inmutable por revisión (WS-RO) y constraint trigger diferido
// `txn.assert_conversion_consistency()` (legs ↔ detalle, INV-010).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const C: Record<string, [Currency, CurrencyKindLike]> = {
  BOB: [currency('BOB', 2), 'FIAT'],
  USDT: [currency('USDT', 6), 'CRYPTO'],
  BTC: [currency('BTC', 8), 'CRYPTO'],
  TRX: [currency('TRX', 6), 'CRYPTO'],
};
const cur = (code: string) => (C[code] as [Currency, CurrencyKindLike])[0];
const info = (code: string) => ({ currency: cur(code), kind: (C[code] as [Currency, CurrencyKindLike])[1] });
const m = (amount: string, code: string) => Money.parse(amount, cur(code));
let app: Pool;
let migrator: Pool;
let uow: PgUnitOfWork;
let u1: string;
const ws = randomUUID();
const walletUsdt = randomUUID();
const bankBob = randomUUID();
const walletBtc = randomUUID();
const walletTrx = randomUUID();
const R2 = randomUUID();
const repo = new PgTransactionRepository();
const inWs = <T>(fn: () => Promise<T>) => uow.run({ userId: u1, workspaceId: ws }, fn);

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function data(over: Partial<ConversionData> = {}): ConversionData {
  const src = over.sourceAmount?.currency.code ?? 'USDT';
  const tgt = over.targetAmount?.currency.code ?? 'BOB';
  return {
    businessDate: '2026-09-30',
    sourceAccount: { accountId: walletUsdt, nature: 'ASSET', currency: 'USDT' },
    targetAccount: { accountId: bankBob, nature: 'ASSET', currency: 'BOB' },
    sourceAmount: m('100.000000', 'USDT'),
    targetAmount: m('685.00', 'BOB'),
    fees: [
      {
        type: 'PROVIDER',
        amount: m('5.00', 'BOB'),
        paidFrom: null,
        categoryId: randomUUID(),
        splitId: randomUUID(),
      },
    ],
    quotedRate: Rate.of(cur('USDT'), cur('BOB'), '6.90'),
    referenceRate: {
      fxRateId: R2,
      rate: Rate.of(cur('USDT'), cur('BOB'), '6.95'),
      rateType: 'P2P',
      source: 'MANUAL',
      asOf: '2026-09-29T19:00:00.000Z',
    },
    display: displayOrientation(info(src), info(tgt)),
    provider: { counterpartyId: null, name: 'Binance P2P' },
    executedAt: '2026-09-30T18:42:00Z',
    externalRef: 'P2P-ORDER-1',
    ...over,
  };
}

const conversion = (over: Partial<ConversionData> = {}) => {
  const tx = Transaction.recordConversion({ id: randomUUID(), workspaceId: ws, ...data(over) });
  tx.attachEntry(randomUUID());
  return tx;
};

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  uow = new PgUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/txn', $1, $2, 'U1') AS id`,
    [`sub-conv-${randomUUID()}`, `conv-${randomUUID()}@demo.pfos.test`],
  );
  u1 = rows[0]!.id;
  await inWs(async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Conv', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, u1],
    );
  });
});

afterAll(async () => {
  await app?.end();
  await migrator?.end();
});

describe('PgTransactionRepository — conversiones', () => {
  it('[TC-TRANSACTIONS-CONVERSION-008] round-trip del detalle canónico completo; UPDATE/DELETE del detalle se rechazan', async () => {
    const tx = conversion();
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!.snapshot;
    expect(loaded.kind).toBe('CONVERSION');
    expect(loaded.legs.map((l) => [l.role, l.amount.toString()])).toEqual([
      ['SOURCE', '-100.000000 USDT'],
      ['TARGET', '685.00 BOB'],
    ]);
    expect(loaded.splits.map((s) => s.amount.toString())).toEqual(['5.00 BOB']);
    const d = loaded.conversion!;
    expect([
      d.revision,
      d.sourceAmount.toString(),
      d.convertedSourceAmount.toString(),
      d.grossTargetAmount.toString(),
      d.targetAmount.toString(),
      d.quotedRate?.value.toFixed(),
      d.effectiveRate.toPersisted(),
      d.referenceRate?.fxRateId,
      d.referenceRate?.rate.value.toFixed(),
      d.referenceRate?.rateType,
      d.spread?.percentage,
      d.spread?.amount.toString(),
      d.provider.name,
      d.executedAt,
      d.externalRef,
    ]).toEqual([
      1,
      '100.000000 USDT',
      '100.000000 USDT',
      '690.00 BOB',
      '685.00 BOB',
      '6.9',
      '6.850000000000000000',
      R2,
      '6.95',
      'P2P',
      '0.719424460431654676',
      '5.00 BOB',
      'Binance P2P',
      '2026-09-30T18:42:00.000Z',
      'P2P-ORDER-1',
    ]);
    expect(d.fees.map((f) => [f.feeNo, f.type, f.amount.toString(), f.splitId])).toEqual([
      [1, 'PROVIDER', '5.00 BOB', loaded.splits[0]?.id],
    ]);
    for (const sql of [
      `UPDATE txn.conversion_detail SET target_amount = 1 WHERE transaction_id = $1`,
      `DELETE FROM txn.conversion_detail WHERE transaction_id = $1`,
      `DELETE FROM txn.conversion_fee WHERE transaction_id = $1`,
    ]) {
      expect(await pgError(inWs(() => requireSqlExecutor().query(sql, [tx.id]))), sql).toBe('42501');
    }
  });

  it('[TC-TRANSACTIONS-CONVERSION-005] legs en tres monedas (FEE desde Wallet TRX) y splits en la moneda de cada fee', async () => {
    const tx = conversion({
      targetAccount: { accountId: walletBtc, nature: 'ASSET', currency: 'BTC' },
      sourceAmount: m('1000.000000', 'USDT'),
      targetAmount: m('0.01600000', 'BTC'),
      quotedRate: Rate.of(cur('BTC'), cur('USDT'), '62375'),
      referenceRate: null,
      fees: [
        {
          type: 'PROVIDER',
          amount: m('2.000000', 'USDT'),
          paidFrom: null,
          categoryId: randomUUID(),
          splitId: randomUUID(),
        },
        {
          type: 'NETWORK',
          amount: m('15.000000', 'TRX'),
          paidFrom: { accountId: walletTrx, nature: 'ASSET', currency: 'TRX' },
          categoryId: randomUUID(),
          splitId: randomUUID(),
        },
      ],
    });
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id)))!.snapshot;
    expect(loaded.legs.map((l) => [l.role, l.accountId, l.amount.toString()])).toEqual([
      ['SOURCE', walletUsdt, '-1000.000000 USDT'],
      ['TARGET', walletBtc, '0.01600000 BTC'],
      ['FEE', walletTrx, '-15.000000 TRX'],
    ]);
    expect(loaded.splits.map((s) => s.amount.toString())).toEqual(['2.000000 USDT', '15.000000 TRX']);
    expect(loaded.conversion?.fees.map((f) => f.paidFromAccountId)).toEqual([null, walletTrx]);
    expect(loaded.conversion?.effectiveRate.toPersisted()).toBe('62500.000000000000000000');
    const btc = await inWs(() =>
      repo.list(
        ws,
        { kinds: ['CONVERSION'], targetCurrency: 'BTC', sort: '-transactionDate' },
        { offset: 0, limit: 10 },
      ),
    );
    expect(btc.map((t) => t.id)).toEqual([tx.id]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-010] la revisión 2 inserta un detalle nuevo y conserva la revisión 1 intacta', async () => {
    const tx = conversion();
    await inWs(() => repo.insert(tx));
    const loaded = (await inWs(() => repo.findById(ws, tx.id, { forUpdate: true })))!;
    loaded.amendConversion(
      data({
        targetAmount: m('686.00', 'BOB'),
        fees: [
          {
            type: 'PROVIDER',
            amount: m('4.00', 'BOB'),
            paidFrom: null,
            categoryId: randomUUID(),
            splitId: randomUUID(),
          },
        ],
      }),
    );
    loaded.attachEntry(randomUUID());
    expect(await inWs(() => repo.update(loaded))).toBe(true);
    const revisions = await inWs(() => repo.conversionRevisions(ws, tx.id));
    expect(
      revisions.map((r) => [
        r.detail.revision,
        r.detail.targetAmount.toFixed(),
        r.detail.fees[0]?.amount.toFixed(),
      ]),
    ).toEqual([
      [1, '685.00', '5.00'],
      [2, '686.00', '4.00'],
    ]);
    const current = (await inWs(() => repo.findById(ws, tx.id)))!.snapshot;
    expect([
      current.revision,
      current.conversion?.revision,
      current.conversion?.effectiveRate.toPersisted(),
    ]).toEqual([2, 2, '6.860000000000000000']);
    expect(current.legs.map((l) => l.amount.toString())).toEqual(['-100.000000 USDT', '686.00 BOB']);
    expect(current.splits.map((s) => s.amount.toString())).toEqual(['4.00 BOB']);
  });

  it('el trigger diferido rechaza al COMMIT legs que no cuadran con el detalle o fees que violan INV-010', async () => {
    const tampered = conversion();
    expect(
      await pgError(
        inWs(async () => {
          await repo.insert(tampered);
          await requireSqlExecutor().query(
            `UPDATE txn.transaction_leg SET amount = 700 WHERE transaction_id = $1 AND role = 'TARGET'`,
            [tampered.id],
          );
        }),
      ),
    ).toBe('23514');
    const sameCurrency = conversion();
    expect(
      await pgError(
        inWs(async () => {
          await repo.insert(sameCurrency);
          await requireSqlExecutor().query(
            `UPDATE txn.transaction_leg SET currency = 'USDT' WHERE transaction_id = $1 AND role = 'TARGET'`,
            [sameCurrency.id],
          );
        }),
      ),
    ).toBe('23514');
    // Un fee descontado del destino que no reconcilia bruto y neto (INV-010).
    const inv010 = conversion();
    expect(
      await pgError(
        inWs(async () => {
          await repo.insert(inv010);
          await requireSqlExecutor().query(
            `INSERT INTO txn.conversion_fee (id, workspace_id, transaction_id, revision, fee_no, fee_type, amount, currency,
                                             paid_from_account_id, split_id)
             SELECT $1, workspace_id, transaction_id, revision, 2, 'OTHER', 1.00, 'BOB', NULL, split_id
               FROM txn.conversion_fee WHERE transaction_id = $2`,
            [randomUUID(), inv010.id],
          );
        }),
      ),
    ).toBe('23514');
    expect(await inWs(() => repo.findById(ws, tampered.id))).toBeNull();
  });
});
