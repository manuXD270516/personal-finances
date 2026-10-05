import { fileURLToPath } from 'node:url';
import { buildEnvelope, EventSchemaRegistry } from '@pf/platform/events';
import { DomainError, MoneyDecimal } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PostingLineDto, PostJournalEntryCommand } from '../contracts/index.js';
import { BalanceCalculator, type LedgerAccount } from '../domain/index.js';
import { LedgerService } from './ledger.service.js';
import { InMemoryLedger } from './testing/in-memory.js';

const W1 = '0190a000-0000-7000-8000-00000000a001';
const BANK_A = '0190a000-0000-7000-8000-0000000acc01';
const BANK_B = '0190a000-0000-7000-8000-0000000acc02';
const BANK_C = '0190a000-0000-7000-8000-0000000acc03';
const CARD_X = '0190a000-0000-7000-8000-0000000acc04';
const BINANCE = '0190a000-0000-7000-8000-0000000acc05';
const T1 = '0190a000-0000-7000-8000-0000000000f1';
const S1 = '0190a000-0000-7000-8000-0000000005a1';

const asset = (accountId: string, amount: string, currency = 'BOB'): PostingLineDto => ({
  target: { kind: 'USER_ACCOUNT', accountId, nature: 'ASSET' },
  amount: { amount, currency },
});
const liability = (accountId: string, amount: string, currency = 'BOB'): PostingLineDto => ({
  target: { kind: 'USER_ACCOUNT', accountId, nature: 'LIABILITY' },
  amount: { amount, currency },
});
const system = (
  systemKind: 'INCOME' | 'EXPENSE' | 'OPENING_BALANCE' | 'FX_TRADING' | 'ADJUSTMENTS',
  amount: string,
  currency = 'BOB',
  splitId: string | null = null,
): PostingLineDto => ({ target: { kind: 'SYSTEM', systemKind }, amount: { amount, currency }, splitId });

let seq = 0;
const cmd = (
  postings: PostingLineDto[],
  over: Partial<PostJournalEntryCommand> = {},
): PostJournalEntryCommand => {
  seq += 1;
  return {
    workspaceId: W1,
    entryDate: '2026-03-10',
    entryType: 'STANDARD',
    sourceRef: {
      type: 'Transaction',
      id: `0190a000-0000-7000-8000-${seq.toString(16).padStart(12, '0')}`,
      revision: 1,
    },
    postings,
    ...over,
  };
};

let mem: InMemoryLedger;
let svc: LedgerService;

const userLedgerAccount = (accountId: string): LedgerAccount =>
  mem.accounts.find((a) => a.sourceAccountId === accountId)!;
const balanceOf = (account: LedgerAccount) =>
  BalanceCalculator.balance(mem.entries, account.id, account.currency).toFixed();

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

beforeEach(() => {
  mem = new InMemoryLedger();
  svc = new LedgerService(mem.deps(), mem.auditPort);
});

describe('LedgerService — PostJournalEntry (aplicación con fakes)', () => {
  it('[TC-LEDGER-METADATA-001] el asiento registra fecha, tipo, origen, actor, correlación, instante y secuencia creciente', async () => {
    const first = await svc.postJournalEntry(
      cmd([system('EXPENSE', '10.00', 'BOB', S1), asset(BANK_A, '-10.00')]),
    );
    const posted = await svc.postJournalEntry(
      cmd([system('EXPENSE', '45.50', 'BOB', S1), asset(BANK_A, '-45.50')], {
        sourceRef: { type: 'Transaction', id: T1, revision: 1 },
      }),
    );
    const e = mem.entries.find((x) => x.id === posted.journalEntryId)!;
    expect([e.entryDate.toString(), e.entryType, e.sourceRef, e.createdBy, e.correlationId]).toEqual([
      '2026-03-10',
      'STANDARD',
      { context: 'TRANSACTIONS', type: 'Transaction', id: T1, revision: 1 },
      mem.actor,
      mem.correlation,
    ]);
    expect(BigInt(posted.sequence) > BigInt(first.sequence)).toBe(true);
    const event = mem.events.at(-1)!;
    expect(event.eventType).toBe('ledger.JournalEntryPosted');
    expect(event.correlationId).toBe(mem.correlation);
    expect(mem.audits.at(-1)).toMatchObject({ action: 'ledger.journal_entry.posted', aggregateId: e.id });
    expect(mem.clock.now().toString()).toBe('2026-03-10T15:00:00.000Z');
  });

  it('[TC-LEDGER-IDEMPOTENCY-001] (aplicación) el mismo origen y revisión devuelve el asiento existente sin duplicar', async () => {
    const c = cmd([system('EXPENSE', '120.00', 'BOB', S1), asset(BANK_A, '-120.00')], {
      sourceRef: { type: 'Transaction', id: T1, revision: 1 },
    });
    const a = await svc.postJournalEntry(c);
    const b = await svc.postJournalEntry(c);
    expect(b).toEqual({ ...a, created: false });
    expect(mem.entries).toHaveLength(1);
    expect(mem.events).toHaveLength(1);
    expect(balanceOf(userLedgerAccount(BANK_A))).toBe('-120.00');
    const rev2 = await svc.postJournalEntry({ ...c, sourceRef: { ...c.sourceRef, revision: 2 } });
    expect(rev2.created).toBe(true);
  });

  it('[TC-LEDGER-OPENING-001] saldos iniciales contra EQUITY:OPENING_BALANCE:BOB sin postings de ingreso; patrimonio 1700.00', async () => {
    await svc.postJournalEntry(
      cmd([asset(BANK_C, '2500.00'), system('OPENING_BALANCE', '-2500.00')], {
        entryType: 'OPENING',
        entryDate: '2026-01-01',
      }),
    );
    await svc.postJournalEntry(
      cmd([liability(CARD_X, '-800.00'), system('OPENING_BALANCE', '800.00')], {
        entryType: 'OPENING',
        entryDate: '2026-01-01',
      }),
    );
    const opening = mem.accounts.filter((a) => a.code.value === 'EQUITY:OPENING_BALANCE:BOB');
    expect(opening).toHaveLength(1);
    expect(mem.accounts.some((a) => a.nature === 'INCOME')).toBe(false);
    const net = new MoneyDecimal(balanceOf(userLedgerAccount(BANK_C))).plus(
      balanceOf(userLedgerAccount(CARD_X)),
    );
    expect(net.toFixed(2)).toBe('1700.00');
    expect(balanceOf(opening[0]!)).toBe('-1700.00');
    expect(
      mem.entries.every((e) => e.entryType === 'OPENING' && e.entryDate.toString() === '2026-01-01'),
    ).toBe(true);
  });

  it('[TC-LEDGER-TRANSFER-001] transferencia de 300.00 BOB: dos postings, saldos 700.00 / 300.00 y total 1000.00', async () => {
    await svc.postJournalEntry(
      cmd([asset(BANK_A, '1000.00'), system('OPENING_BALANCE', '-1000.00')], { entryType: 'OPENING' }),
    );
    const t = await svc.postJournalEntry(cmd([asset(BANK_B, '300.00'), asset(BANK_A, '-300.00')]));
    const e = mem.entries.find((x) => x.id === t.journalEntryId)!;
    expect(e.postings).toHaveLength(2);
    expect(e.totalsByCurrency().get('BOB')!.isZero()).toBe(true);
    expect(balanceOf(userLedgerAccount(BANK_A))).toBe('700.00');
    expect(balanceOf(userLedgerAccount(BANK_B))).toBe('300.00');
  });

  it('[TC-LEDGER-CHART-002] (aplicación) cuentas de sistema por moneda creadas una sola vez y reutilizadas', async () => {
    await svc.postJournalEntry(
      cmd([system('EXPENSE', '0.100000', 'USDT', S1), asset(BINANCE, '-0.100000', 'USDT')]),
    );
    await svc.postJournalEntry(
      cmd([system('EXPENSE', '2.000000', 'USDT', S1), asset(BINANCE, '-2.000000', 'USDT')]),
    );
    const expense = mem.accounts.filter((a) => a.code.value === 'EXPENSE:USDT');
    expect(expense).toHaveLength(1);
    expect([expense[0]!.nature, expense[0]!.currency.code]).toEqual(['EXPENSE', 'USDT']);
    const a = await svc.ledgerAccountForUserAccount({
      workspaceId: W1,
      accountId: BINANCE,
      nature: 'ASSET',
      currency: 'USDT',
    });
    const b = await svc.ledgerAccountForUserAccount({
      workspaceId: W1,
      accountId: BINANCE,
      nature: 'ASSET',
      currency: 'USDT',
    });
    expect(a).toEqual(b);
    expect(a.code).toBe(`ASSET:${BINANCE}`);
  });

  it('[TC-LEDGER-BALANCE-001] (aplicación) un asiento rechazado no persiste postings, eventos ni auditoría', async () => {
    expect(
      await codeOf(
        svc.postJournalEntry(cmd([system('EXPENSE', '50.00', 'BOB', S1), asset(BANK_A, '-49.00')])),
      ),
    ).toBe('LEDGER_UNBALANCED_ENTRY');
    expect([mem.entries.length, mem.events.length, mem.audits.length, mem.accounts.length]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      await codeOf(svc.postJournalEntry(cmd([system('EXPENSE', '1.00', 'XXX', S1), asset(BANK_A, '-1.00')]))),
    ).toBe('REFERENCE_NOT_FOUND');
    expect(
      await codeOf(
        svc.postJournalEntry(
          cmd([
            system('EXPENSE', '1.00', 'BOB', S1),
            {
              target: { kind: 'LEDGER_ACCOUNT', ledgerAccountId: T1 },
              amount: { amount: '-1.00', currency: 'BOB' },
            },
          ]),
        ),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-LEDGER-EVENT-001] el evento cumple contracts/events/ledger/JournalEntryPosted.v1, suma 0 por moneda y escala canónica', async () => {
    const registry = EventSchemaRegistry.fromDirectory(
      fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url)),
    );
    let captured: Parameters<ReturnType<InMemoryLedger['deps']>['outbox']['append']>[0] | undefined;
    const deps = mem.deps();
    const svc2 = new LedgerService(
      { ...deps, outbox: { append: async (d) => (captured = d) } },
      mem.auditPort,
    );
    await svc2.postJournalEntry(
      cmd([
        asset(BINANCE, '-100.000000', 'USDT'),
        system('FX_TRADING', '100.000000', 'USDT'),
        system('FX_TRADING', '-690.00'),
        asset(BANK_A, '685.00'),
        system('EXPENSE', '5.00', 'BOB', S1),
      ]),
    );
    const envelope = buildEnvelope(captured!) as unknown as Parameters<typeof registry.validate>[0];
    expect(() => registry.validate(envelope)).not.toThrow();
    const postings = (envelope.payload as { postings: { amount: { amount: string; currency: string } }[] })
      .postings;
    expect(postings).toHaveLength(5);
    expect(postings.map((p) => p.amount)).toContainEqual({ amount: '-100.000000', currency: 'USDT' });
    expect(postings.map((p) => p.amount)).toContainEqual({ amount: '685.00', currency: 'BOB' });
    const scale: Record<string, number> = { BOB: 2, USDT: 6 };
    const sums = new Map<string, InstanceType<typeof MoneyDecimal>>();
    for (const { amount } of postings) {
      expect(amount.amount.split('.')[1]?.length ?? 0).toBe(scale[amount.currency]);
      sums.set(amount.currency, (sums.get(amount.currency) ?? new MoneyDecimal(0)).plus(amount.amount));
    }
    expect([...sums.values()].every((s) => s.isZero())).toBe(true);
    expect(() =>
      registry.validate({ ...envelope, payload: { ...envelope.payload, postings: postings.slice(0, 1) } }),
    ).toThrow();
  });
});

describe('LedgerService — ReverseJournalEntry y periodos', () => {
  it('[TC-LEDGER-REVERSAL-001] (aplicación) la reversa vuelve el saldo a 1000.00, publica evento y audita con motivo', async () => {
    await svc.postJournalEntry(
      cmd([asset(BANK_A, '1000.00'), system('OPENING_BALANCE', '-1000.00')], { entryType: 'OPENING' }),
    );
    const e1 = await svc.postJournalEntry(
      cmd([system('EXPENSE', '120.00', 'BOB', S1), asset(BANK_A, '-120.00')]),
    );
    const r1 = await svc.reverseJournalEntry({
      workspaceId: W1,
      journalEntryId: e1.journalEntryId,
      reverseDate: '2026-03-20',
      reason: 'duplicado',
    });
    expect(balanceOf(userLedgerAccount(BANK_A))).toBe('1000.00');
    const r = mem.entries.find((x) => x.id === r1.journalEntryId)!;
    expect([r.entryType, r.reversesEntryId, r.entryDate.toString()]).toEqual([
      'REVERSAL',
      e1.journalEntryId,
      '2026-03-20',
    ]);
    expect(mem.events.at(-1)!.payload['reversesEntryId']).toBe(e1.journalEntryId);
    expect(mem.audits.at(-1)).toMatchObject({ action: 'ledger.journal_entry.reversed', reason: 'duplicado' });
  });

  it('[TC-LEDGER-REVERSAL-002] (aplicación) segunda reversa → ALREADY_REVERSED; reversa de reversa → NOT_REVERSIBLE', async () => {
    const e = await svc.postJournalEntry(
      cmd([system('EXPENSE', '45.00', 'BOB', S1), asset(BANK_A, '-45.00')]),
    );
    const r = await svc.reverseJournalEntry({
      workspaceId: W1,
      journalEntryId: e.journalEntryId,
      reverseDate: '2026-03-20',
      reason: 'x',
    });
    expect(
      await codeOf(
        svc.reverseJournalEntry({
          workspaceId: W1,
          journalEntryId: e.journalEntryId,
          reverseDate: '2026-03-21',
          reason: 'x',
        }),
      ),
    ).toBe('LEDGER_ENTRY_ALREADY_REVERSED');
    expect(
      await codeOf(
        svc.reverseJournalEntry({
          workspaceId: W1,
          journalEntryId: r.journalEntryId,
          reverseDate: '2026-03-21',
          reason: 'x',
        }),
      ),
    ).toBe('LEDGER_ENTRY_NOT_REVERSIBLE');
    expect(
      await codeOf(
        svc.reverseJournalEntry({
          workspaceId: W1,
          journalEntryId: T1,
          reverseDate: '2026-03-21',
          reason: 'x',
        }),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
    expect(mem.entries).toHaveLength(2);
  });

  it('[TC-LEDGER-PERIOD-001] con el puerto de bloqueo: agosto cerrado rechaza 15/08 y la reversa al 10/08; 01/09 se acepta', async () => {
    await svc.postJournalEntry(
      cmd([asset(BANK_A, '1000.00'), system('OPENING_BALANCE', '-1000.00')], {
        entryType: 'OPENING',
        entryDate: '2026-07-01',
      }),
    );
    const july = await svc.postJournalEntry(
      cmd([system('EXPENSE', '120.00', 'BOB', S1), asset(BANK_A, '-120.00')], { entryDate: '2026-07-20' }),
    );
    await svc.lockPeriod({ workspaceId: W1, yearMonth: '2026-08', periodId: T1 });
    await svc.lockPeriod({ workspaceId: W1, yearMonth: '2026-08', periodId: T1 }); // idempotente
    expect(mem.audits.filter((a) => a.action === 'ledger.period_lock.locked')).toHaveLength(1);
    const events = mem.events.length;
    expect(
      await codeOf(
        svc.postJournalEntry(
          cmd([system('EXPENSE', '45.00', 'BOB', S1), asset(BANK_A, '-45.00')], { entryDate: '2026-08-15' }),
        ),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(
      await codeOf(
        svc.reverseJournalEntry({
          workspaceId: W1,
          journalEntryId: july.journalEntryId,
          reverseDate: '2026-08-10',
          reason: 'x',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(mem.events).toHaveLength(events);
    await svc.postJournalEntry(
      cmd([system('EXPENSE', '45.00', 'BOB', S1), asset(BANK_A, '-45.00')], { entryDate: '2026-09-01' }),
    );
    expect(balanceOf(userLedgerAccount(BANK_A))).toBe('835.00');
    await svc.unlockPeriod({ workspaceId: W1, yearMonth: '2026-08', reason: 'reapertura' });
    await svc.unlockPeriod({ workspaceId: W1, yearMonth: '2026-08', reason: 'reapertura' });
    expect(mem.audits.filter((a) => a.action === 'ledger.period_lock.unlocked')).toHaveLength(1);
    await svc.postJournalEntry(
      cmd([system('EXPENSE', '45.00', 'BOB', S1), asset(BANK_A, '-45.00')], { entryDate: '2026-08-15' }),
    );
  });

  it('[TC-CLASSIFICATION-RECATEGORIZE-002] assertPeriodOpen: PERIOD_CLOSED en un mes cerrado, sin efectos; abierto ⇒ ok', async () => {
    await svc.lockPeriod({ workspaceId: W1, yearMonth: '2026-08', periodId: T1 });
    const [audits, events, entries] = [mem.audits.length, mem.events.length, mem.entries.length];
    expect(await codeOf(svc.assertPeriodOpen({ workspaceId: W1, date: '2026-08-31' }))).toBe('PERIOD_CLOSED');
    expect(await codeOf(svc.assertPeriodOpen({ workspaceId: W1, date: '2026-08-01' }))).toBe('PERIOD_CLOSED');
    await svc.assertPeriodOpen({ workspaceId: W1, date: '2026-09-01' });
    await svc.assertPeriodOpen({ workspaceId: W1, date: '2026-07-31' });
    expect(await codeOf(svc.assertPeriodOpen({ workspaceId: W1, date: '2026-02-30' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect([mem.audits.length, mem.events.length, mem.entries.length]).toEqual([audits, events, entries]);
  });
});
