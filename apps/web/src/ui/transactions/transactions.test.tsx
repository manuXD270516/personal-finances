import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditLogEntry, Transaction } from '../common/types';
import { esContext, textOf } from '../test-support';
import {
  amountFor,
  availableActions,
  buildTimeline,
  EMPTY_TRANSACTION_FILTERS,
  transactionsQuery,
} from './logic';
import { newSplitRow, splitByPercent, splitEqually, summarizeSplits } from './splits';
import { TransactionsListView } from './TransactionsListView';
import { TransactionTimeline, type NameResolver } from './TransactionTimeline';

const f = esContext('Transactions');
const U_EDITOR = '0190a000-0000-7000-8000-0000000000b2';
const U_VIEWER = '0190a000-0000-7000-8000-0000000000b3';
const TX = '0190a000-0000-7000-8000-0000000000e1';
const BANK = '0190a000-0000-7000-8000-0000000000c1';
const CARD = '0190a000-0000-7000-8000-0000000000c4';
const SUPER = '0190a000-0000-7000-8000-0000000000d1';
const FARMACIA = '0190a000-0000-7000-8000-0000000000f1';
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const names: NameResolver = {
  account: (id) => ({ [BANK]: 'Bank A', [CARD]: 'Credit Card' })[id],
  category: (id) => (id === SUPER ? 'Supermercado' : undefined),
  counterparty: (id) => (id === FARMACIA ? 'Farmacia Demo' : undefined),
  tag: () => undefined,
};

const entry = (over: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: '0190a000-0000-7000-8000-000000000a01',
  occurredAt: '2026-03-12T14:00:00.000Z',
  actor: { type: 'USER', userId: U_EDITOR, process: null },
  action: 'transactions.transaction.created',
  aggregateType: 'Transaction',
  aggregateId: TX,
  aggregateVersion: 1,
  changes: [],
  reason: null,
  origin: 'ui',
  ...over,
});

/** Historial del scenario "editar y anular": 120.00 → 102.00 BOB (reversa + nuevo asiento) y anulación. */
const HISTORY: AuditLogEntry[] = [
  entry({
    id: '0190a000-0000-7000-8000-000000000a03',
    occurredAt: '2026-03-12T16:00:00.000Z',
    action: 'transactions.transaction.voided',
    aggregateVersion: 3,
    reason: 'Compra duplicada',
    changes: [
      { field: 'status', before: 'POSTED', after: 'VOIDED' },
      { field: 'journalEntryId', before: 'x', after: 'y' },
    ],
  }),
  entry({
    id: '0190a000-0000-7000-8000-000000000a01',
    changes: [
      { field: 'kind', before: null, after: 'EXPENSE' },
      { field: 'status', before: null, after: 'POSTED' },
      { field: 'transactionDate', before: null, after: '2026-03-12' },
      { field: 'accountId', before: null, after: BANK },
      { field: 'amount', before: null, after: bob('120.00') },
      {
        field: 'splits',
        before: null,
        after: JSON.stringify([{ id: 's1', amount: bob('120.00'), categoryId: SUPER, tagIds: [] }]),
      },
      { field: 'paymentMethod', before: null, after: 'QR' },
      { field: 'counterpartyId', before: null, after: FARMACIA },
    ],
  }),
  entry({
    id: '0190a000-0000-7000-8000-000000000a02',
    occurredAt: '2026-03-12T15:00:00.000Z',
    action: 'transactions.transaction.updated',
    aggregateVersion: 2,
    changes: [
      { field: 'amount', before: bob('120.00'), after: bob('102.00') },
      { field: 'revision', before: 1, after: 2 },
      { field: 'journalEntryId', before: 'a', after: 'b' },
    ],
  }),
];

const renderTimeline = (entries: AuditLogEntry[], currentUserId = U_EDITOR) =>
  renderToStaticMarkup(
    <TransactionTimeline entries={entries} ctx={f} names={names} currentUserId={currentUserId} />,
  );

describe('historial de la transacción como línea de tiempo del ciclo de vida (6.2, decisión del owner 2026-10-03)', () => {
  it('[TC-TRANSACTIONS-HISTORY-001] creación, edición (120.00 → 102.00 BOB con reversa) y anulación con motivo, en orden y como estado → estado', () => {
    const html = renderTimeline(HISTORY);
    const entries = html.match(/<li data-testid="timeline-entry"[\s\S]*?<\/li>/g) ?? [];
    expect(entries).toHaveLength(3);
    const [created, edited, voided] = entries as [string, string, string];
    expect(created).toContain('data-from="" data-to="POSTED"');
    expect(textOf(created)).toContain('Registrada');
    expect(textOf(created)).toContain('— → Contabilizada');
    expect(textOf(created)).toContain('Supermercado: 120,00 BOB');
    expect(textOf(created)).toContain('Bank A');
    expect(textOf(created)).toContain('Farmacia Demo');
    expect(textOf(created)).toMatch(/Medio de pago—QR/);
    expect(edited).toContain('data-to="POSTED"');
    expect(textOf(edited)).toContain('Sin cambio de estado (sigue Contabilizada)');
    expect(textOf(edited)).toContain(
      'Revisión contable 1 → 2: reversa del asiento anterior y nuevo asiento.',
    );
    expect(edited).toContain('<td style="');
    expect(textOf(edited)).toContain('Monto120,00 BOB102,00 BOB');
    // Los campos técnicos no se listan como cambios.
    expect(edited).not.toContain('data-field="journalEntryId"');
    expect(edited).not.toContain('data-field="revision"');
    expect(voided).toContain('data-from="POSTED" data-to="VOIDED"');
    expect(textOf(voided)).toContain('Contabilizada → Anulada');
    expect(textOf(voided)).toContain('Motivo: Compra duplicada');
    // Quién y cuándo, en la zona del workspace: 2026-03-12T16:00Z = 12:00 en La Paz.
    expect(textOf(voided)).toMatch(/por ti · 12[^<]*mar[^<]*2026[^<]*12:00/);
  });

  it('con otro usuario como actor (p. ej. un VIEWER mirando) ve el actor de otro usuario y el cambio 120.00 → 102.00 BOB', () => {
    const html = renderTimeline(HISTORY, U_VIEWER);
    expect(textOf(html)).toContain('por el usuario …000000b2');
    expect(textOf(html)).toContain('120,00 BOB102,00 BOB');
    expect(html).toContain('<h2 id="tx-history-title"');
    expect(renderTimeline([])).toContain('Todavía no hay cambios registrados.');
  });

  it('acciones y campos sin traducción se muestran con su identificador sin romper', () => {
    const html = renderTimeline([
      entry({
        action: 'transactions.transaction.mystery',
        changes: [{ field: 'zzz', before: { a: 1 }, after: true }],
      }),
    ]);
    expect(html).toContain('<strong>transactions.transaction.mystery</strong>');
    expect(textOf(html)).toContain('zzz{&quot;a&quot;:1}Sí');
    expect(buildTimeline([])).toEqual([]);
  });
  it('las entradas del asiento vinculado se muestran como efecto contable de la entrada con la misma correlación', () => {
    const C1 = '0190a000-0000-7000-8000-000000000c01';
    const C2 = '0190a000-0000-7000-8000-000000000c02';
    const items = buildTimeline([
      entry({
        id: 'l1',
        action: 'ledger.journal_entry.posted',
        aggregateType: 'JournalEntry',
        correlationId: C1,
      }),
      entry({ id: 't1', correlationId: C1, changes: [{ field: 'status', before: null, after: 'POSTED' }] }),
      entry({
        id: 't2',
        occurredAt: '2026-03-12T15:00:00.000Z',
        action: 'transactions.transaction.updated',
        correlationId: C2,
      }),
      entry({
        id: 'l2',
        occurredAt: '2026-03-12T15:00:00.000Z',
        action: 'ledger.journal_entry.reversed',
        aggregateType: 'JournalEntry',
        correlationId: C2,
      }),
      entry({
        id: 'l3',
        occurredAt: '2026-03-12T17:00:00.000Z',
        action: 'ledger.journal_entry.posted',
        aggregateType: 'JournalEntry',
      }),
    ]);
    expect(items.map((i) => [i.id, i.related.map((r) => r.id)])).toEqual([
      ['t1', ['l1']],
      ['t2', ['l2']],
      ['l3', []],
    ]);
    const html = renderToStaticMarkup(
      <TransactionTimeline
        entries={[
          entry({
            id: 'l1',
            action: 'ledger.journal_entry.posted',
            aggregateType: 'JournalEntry',
            correlationId: C1,
          }),
          entry({
            id: 't1',
            correlationId: C1,
            changes: [{ field: 'status', before: null, after: 'POSTED' }],
          }),
        ]}
        ctx={f}
        names={names}
      />,
    );
    expect(html.match(/data-testid="timeline-entry"/g)).toHaveLength(1);
    expect(textOf(html)).toContain('Efecto contable: Asiento contable registrado');
  });
});

const tx = (over: Partial<Transaction>): Transaction => ({
  id: TX,
  kind: 'EXPENSE',
  status: 'POSTED',
  transactionDate: '2026-03-12',
  amount: bob('85.50'),
  legs: [{ accountId: BANK, amount: bob('-85.50'), role: 'MAIN' }],
  splits: [{ id: 's1', amount: bob('85.50'), categoryId: SUPER }],
  source: 'MANUAL',
  revision: 1,
  version: 1,
  createdAt: '2026-03-12T14:00:00Z',
  ...over,
});

describe('registro de transacciones (6.2)', () => {
  it('un gasto pagado con QR se lista como salida con su medio de pago y contraparte', () => {
    const html = renderToStaticMarkup(
      <TransactionsListView
        transactions={[
          tx({ paymentMethod: 'QR', counterpartyId: FARMACIA }),
          tx({
            id: '0190a000-0000-7000-8000-0000000000e2',
            kind: 'INCOME',
            amount: bob('300.00'),
            legs: [{ accountId: BANK, amount: bob('300.00'), role: 'MAIN' }],
            splits: [],
            paymentMethod: 'QR',
            status: 'CLEARED',
          }),
          tx({
            id: '0190a000-0000-7000-8000-0000000000e3',
            kind: 'TRANSFER',
            amount: bob('350.00'),
            legs: [
              { accountId: BANK, amount: bob('-350.00'), role: 'SOURCE' },
              { accountId: CARD, amount: bob('350.00'), role: 'TARGET' },
            ],
            splits: [],
            status: 'VOIDED',
          }),
        ]}
        names={names}
        f={f}
        href={(p) => p}
        selected={new Set([TX])}
        selectable
      />,
    );
    const rows = html.match(/<li data-testid="transaction-row"[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(textOf(rows[0]!)).toContain('Farmacia Demo');
    expect(textOf(rows[0]!)).toContain('−85,50 BOB salida');
    expect(rows[0]).toContain('data-method="QR"');
    expect(rows[0]).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(textOf(rows[1]!)).toContain('+300,00 BOB entrada');
    expect(textOf(rows[1]!)).toContain('Confirmada');
    expect(textOf(rows[2]!)).toContain('Bank A → Credit Card');
    expect(textOf(rows[2]!)).toContain('350,00 BOB entre cuentas propias');
    // Una anulada no se puede seleccionar para el lote.
    expect(rows[2]).toMatch(/type="checkbox"[^>]*disabled=""/);
  });

  it('el monto se ve desde la cuenta filtrada (las transferencias tienen signo por cuenta)', () => {
    const transfer = tx({
      kind: 'TRANSFER',
      amount: bob('300.00'),
      legs: [
        { accountId: BANK, amount: bob('-310.00'), role: 'SOURCE' },
        { accountId: CARD, amount: bob('300.00'), role: 'TARGET' },
      ],
    });
    expect(amountFor(transfer, BANK)).toEqual({ money: bob('310.00'), direction: 'out' });
    expect(amountFor(transfer, CARD)).toEqual({ money: bob('300.00'), direction: 'in' });
    expect(amountFor(transfer)).toEqual({ money: bob('300.00'), direction: 'neutral' });
  });

  it('los filtros se traducen a la query de listTransactions (incluido medio de pago QR)', () => {
    expect(transactionsQuery(EMPTY_TRANSACTION_FILTERS).toString()).toBe('limit=50');
    expect(
      transactionsQuery(
        {
          ...EMPTY_TRANSACTION_FILTERS,
          q: ' farmacia ',
          accountId: BANK,
          kind: 'EXPENSE',
          paymentMethod: 'QR',
          dateFrom: '2026-03-01',
        },
        'c1',
      ).toString(),
    ).toBe(
      `q=farmacia&accountId=${BANK}&kind=EXPENSE&paymentMethod=QR&dateFrom=2026-03-01&limit=50&cursor=c1`,
    );
  });

  it('acciones según la máquina de estados (anulada terminal, reconciliada protegida)', () => {
    expect(availableActions(tx({ status: 'PENDING' }))).toMatchObject({
      post: true,
      clear: false,
      void: true,
    });
    expect(availableActions(tx({ status: 'POSTED' }))).toMatchObject({
      clear: true,
      reconcile: false,
      void: true,
    });
    expect(availableActions(tx({ status: 'CLEARED' }))).toMatchObject({ unclear: true, reconcile: true });
    expect(availableActions(tx({ status: 'RECONCILED' }))).toMatchObject({
      unreconcile: true,
      void: false,
      financialEdit: false,
    });
    expect(availableActions(tx({ status: 'VOIDED' }))).toMatchObject({
      edit: false,
      void: false,
      post: false,
    });
  });
});

describe('splits del formulario (6.1)', () => {
  const m = { locale: 'es-BO', currency: 'BOB', scale: 2 };
  it('una sola fila sin monto toma el total; varias deben cuadrar exactamente', () => {
    expect(summarizeSplits([newSplitRow()], '350.00', m)).toMatchObject({
      balanced: true,
      remaining: '0.00',
    });
    const rows = [newSplitRow({ amount: '300' }), newSplitRow({ amount: '49,99' })];
    expect(summarizeSplits(rows, '350.00', m)).toMatchObject({ balanced: false, remaining: '0.01' });
    expect(summarizeSplits([newSplitRow({ amount: '1,234' }), newSplitRow()], '350.00', m)).toMatchObject({
      remaining: null,
      balanced: false,
    });
  });

  it('[TC-TRANSACTIONS-SPLIT-003] partes iguales y porcentajes con mayor residuo, sin centavos perdidos', () => {
    const three = splitEqually([newSplitRow(), newSplitRow(), newSplitRow()], '100.00', m);
    expect(three.map((r) => r.amount)).toEqual(['33.34', '33.33', '33.33']);
    const usdt = { locale: 'es-BO', currency: 'USDT', scale: 6 };
    const half = splitByPercent(
      [newSplitRow({ percent: '50' }), newSplitRow({ percent: '50' })],
      '10.000001',
      usdt,
    );
    expect(half?.map((r) => r.amount)).toEqual(['5.000001', '5.000000']);
    expect(
      splitByPercent([newSplitRow({ percent: '60' }), newSplitRow({ percent: '30' })], '10.00', m),
    ).toBeNull();
  });
});
