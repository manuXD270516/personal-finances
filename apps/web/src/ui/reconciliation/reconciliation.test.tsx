import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../common/types';
import { EMPTY_TRANSACTION_FILTERS, transactionsQuery } from '../transactions/logic';
import { TransactionsListView, WithoutStatementBadge } from '../transactions/TransactionsListView';
import { esContext, textOf } from '../test-support';
import {
  absMoney,
  adjustmentDirection,
  differenceState,
  isEditable,
  parseStatementBalance,
  sessionCandidates,
  sessionTransactionsQuery,
  type Reconciliation,
  type ReconciliationStatus,
} from './logic';
import {
  AdjustmentPanel,
  ReconciliationIndicator,
  SessionHistory,
  SessionSummary,
  SessionTransactions,
  StartForm,
} from './ReconciliationView';

const f = esContext('Reconciliation');
const txf = esContext('Transactions');
const BANK = '0190a000-0000-7000-8000-0000000000a1';
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const session = (over: Partial<Reconciliation> = {}): Reconciliation => ({
  id: '0190a000-0000-7000-8000-000000000a01',
  accountId: BANK,
  status: 'IN_PROGRESS',
  statementDate: '2026-03-31',
  statementBalance: bob('3350.00'),
  clearedBalance: bob('3350.00'),
  difference: bob('0.00'),
  adjustmentTransactionId: null,
  startedBy: '0190a000-0000-7000-8000-0000000000b1',
  startedAt: '2026-04-05T14:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  version: 1,
  ...over,
});

const tx = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  kind: 'EXPENSE',
  status: 'CLEARED',
  transactionDate: '2026-03-05',
  amount: bob('150.00'),
  description: 'Hipermaxi',
  legs: [{ accountId: BANK, amount: bob('-150.00'), role: 'MAIN' }],
  splits: [],
  source: 'MANUAL',
  revision: 1,
  version: 1,
  createdAt: '2026-03-05T12:00:00.000Z',
  ...over,
});

const names = {
  account: () => 'Bank A',
  category: () => undefined,
  counterparty: () => undefined,
  tag: () => undefined,
};

describe('Lógica de la reconciliación (transactions/reconciliation 6.1)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-001] el saldo del extracto admite signo y se rechaza con más decimales que la moneda', () => {
    const opts = { locale: 'es-BO', currency: 'BOB', scale: 2 };
    expect(parseStatementBalance('3.350,00', opts)).toEqual({ ok: true, value: '3350.00' });
    expect(parseStatementBalance('3350.00', opts)).toEqual({ ok: true, value: '3350.00' });
    expect(parseStatementBalance('-12,5', opts)).toEqual({ ok: true, value: '-12.50' });
    expect(parseStatementBalance('0', opts)).toEqual({ ok: true, value: '0.00' });
    expect(parseStatementBalance('-0', opts)).toEqual({ ok: true, value: '0.00' });
    expect(parseStatementBalance('3350,005', opts)).toEqual({ ok: false, error: 'SCALE' });
    expect(parseStatementBalance('', opts)).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseStatementBalance('abc', opts)).toEqual({ ok: false, error: 'INVALID' });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] la diferencia define el ajuste: positiva aumenta, negativa disminuye, cero no necesita', () => {
    expect(differenceState(bob('0.00'))).toBe('ZERO');
    expect(differenceState(bob('-0.00'))).toBe('ZERO');
    expect(differenceState(bob('-5.00'))).toBe('NEGATIVE');
    expect(differenceState(bob('5.00'))).toBe('POSITIVE');
    expect(differenceState(null)).toBeNull();
    expect(adjustmentDirection(bob('-5.00'))).toBe('DECREASE');
    expect(adjustmentDirection(bob('40.90'))).toBe('INCREASE');
    expect(adjustmentDirection(bob('0.00'))).toBeNull();
    expect(absMoney(bob('-5.00'))).toEqual(bob('5.00'));
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] la sesión lista solo posted y cleared de la cuenta hasta la fecha del extracto, por fecha', () => {
    const list = [
      tx('c', { transactionDate: '2026-03-20', status: 'POSTED' }),
      tx('a', { transactionDate: '2026-03-05' }),
      tx('late', { transactionDate: '2026-04-02' }),
      tx('done', { status: 'RECONCILED' }),
      tx('pend', { status: 'PENDING' }),
      tx('other', { legs: [{ accountId: 'otra', amount: bob('-1.00'), role: 'MAIN' }] }),
    ];
    expect(sessionCandidates(list, BANK, '2026-03-31').map((t) => t.id)).toEqual(['a', 'c']);
    expect(sessionTransactionsQuery(BANK, '2026-03-31').toString()).toBe(
      `accountId=${BANK}&status=POSTED&status=CLEARED&dateTo=2026-03-31&sort=transactionDate`,
    );
    expect(isEditable(session(), true)).toBe(true);
    expect(isEditable(session(), false)).toBe(false);
    expect(isEditable(session({ status: 'COMPLETED' }), true)).toBe(false);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-018] el filtro de conciliadas sin extracto envía systemFlag y por omisión no filtra', () => {
    expect(transactionsQuery(EMPTY_TRANSACTION_FILTERS).has('systemFlag')).toBe(false);
    const q = transactionsQuery({ ...EMPTY_TRANSACTION_FILTERS, withoutStatement: true, accountId: BANK });
    expect(q.getAll('systemFlag')).toEqual(['RECONCILED_WITHOUT_STATEMENT']);
    expect(q.get('accountId')).toBe(BANK);
  });
});

describe('Pantalla de reconciliación (transactions/reconciliation 6.1)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-003] la cabecera muestra extracto, saldo confirmado y diferencia en vivo (anunciada) con su explicación en texto', () => {
    const html = renderToStaticMarkup(<SessionSummary session={session()} f={f} />);
    const text = textOf(html);
    expect(text).toContain('31 mar de 2026');
    expect(text).toContain('3.350,00 BOB');
    expect(html).toMatch(/data-testid="rec-difference"[^>]*aria-live="polite"/);
    expect(html).toMatch(/data-state="ZERO"/);
    expect(text).toContain('Cuadra');
    expect(html).not.toContain('rec-difference-hint');
    // Diferencia negativa: lo confirmado supera al extracto; el aviso lleva el monto y la salida (ajuste o desconfirmar).
    const neg = textOf(
      renderToStaticMarkup(
        <SessionSummary
          session={session({ difference: bob('-5.00'), clearedBalance: bob('3355.00') })}
          f={f}
        />,
      ),
    );
    expect(neg).toContain('Sobra confirmado');
    expect(neg).toContain('Lo confirmado supera al extracto');
    expect(neg).toContain('5,00 BOB');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] cada transacción tiene su casilla "confirmada" accesible; en una sesión de solo lectura no hay casillas', () => {
    const list = [tx('a'), tx('b', { status: 'POSTED', description: 'Taxi', transactionDate: '2026-03-20' })];
    const editable = renderToStaticMarkup(
      <SessionTransactions
        transactions={list}
        accountId={BANK}
        names={names}
        f={f}
        txf={txf}
        href={(p) => p}
        editable
      />,
    );
    expect(editable.match(/type="checkbox"/g)).toHaveLength(2);
    expect(editable).toContain('aria-label="Confirmada en el extracto: Hipermaxi"');
    expect(editable).toMatch(/aria-label="Confirmada en el extracto: Hipermaxi"[^>]*checked=""/);
    expect(editable).not.toMatch(/aria-label="Confirmada en el extracto: Taxi"[^>]*checked=""/);
    expect(editable).toContain('aria-label="Transacciones de la cuenta hasta la fecha del extracto"');
    const readOnly = renderToStaticMarkup(
      <SessionTransactions
        transactions={list}
        accountId={BANK}
        names={names}
        f={f}
        txf={txf}
        href={(p) => p}
        editable={false}
      />,
    );
    expect(readOnly).not.toContain('type="checkbox"');
    expect(
      textOf(
        renderToStaticMarkup(
          <SessionTransactions
            transactions={[]}
            accountId={BANK}
            names={names}
            f={f}
            txf={txf}
            href={(p) => p}
            editable
          />,
        ),
      ),
    ).toContain('No hay transacciones por confirmar');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] el diálogo de ajuste explica la dirección y el monto y exige el motivo', () => {
    const html = renderToStaticMarkup(
      <AdjustmentPanel
        difference={bob('-5.00')}
        f={f}
        locale="es-BO"
        busy={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const text = textOf(html);
    expect(html).toContain('role="alertdialog"');
    expect(text).toContain('La diferencia no es cero');
    expect(text).toContain('ajuste de disminución');
    expect(text).toContain('5,00 BOB');
    expect(html).toContain('name="adjustmentReason"');
    expect(html).toContain('required');
    // Sin motivo, confirmar queda deshabilitado.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Crear el ajuste y finalizar/);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-001] el formulario de inicio pide fecha (máx. hoy) y saldo; en un pasivo explica que la deuda va en positivo', () => {
    const html = renderToStaticMarkup(
      <StartForm f={f} currency="BOB" liability today="2026-04-05" busy={false} onSubmit={() => undefined} />,
    );
    expect(html).toContain('type="date"');
    expect(html).toContain('max="2026-04-05"');
    expect(textOf(html)).toContain('Saldo del extracto (BOB)');
    expect(textOf(html)).toContain('ingresa la deuda como número positivo');
    const asset = renderToStaticMarkup(
      <StartForm
        f={f}
        currency="BOB"
        liability={false}
        today="2026-04-05"
        busy={false}
        onSubmit={() => undefined}
      />,
    );
    expect(textOf(asset)).not.toContain('deuda como número positivo');
  });

  it('el historial lista las sesiones con su estado y enlace; vacío informa que no hay conciliaciones', () => {
    const html = renderToStaticMarkup(
      <SessionHistory
        sessions={[
          session({ status: 'COMPLETED', completedAt: '2026-04-05T14:00:00.000Z' }),
          session({ id: 'x', status: 'CANCELLED' }),
        ]}
        f={f}
        href={(id) => `/s/${id}`}
        currentId="x"
      />,
    );
    expect(html.match(/data-testid="reconciliation-history-item"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('Extracto del 31 mar de 2026');
    expect(textOf(html)).toContain('Completada');
    expect(textOf(html)).toContain('Cancelada');
    expect(html).toContain('aria-current="true"');
    expect(textOf(renderToStaticMarkup(<SessionHistory sessions={[]} f={f} href={(id) => id} />))).toContain(
      'todavía no tiene conciliaciones',
    );
  });
});

describe('Indicador y marca de conciliada sin extracto (docs/33 D111)', () => {
  const status = (over: Partial<ReconciliationStatus> = {}): ReconciliationStatus => ({
    accountId: BANK,
    lastCompleted: {
      reconciliationId: 'r1',
      statementDate: '2026-03-31',
      statementBalance: bob('3350.00'),
      difference: bob('0.00'),
      completedAt: '2026-04-05T14:00:00.000Z',
    },
    inProgressReconciliationId: null,
    unreconciledPostedCountThrough: 1,
    unreconciledClearedCountThrough: 0,
    reconciledWithoutStatementCount: 0,
    reconciledThrough: false,
    reconciliationBasis: null,
    ...over,
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-010] el indicador dice si la cuenta está conciliada al corte, el último extracto y las pendientes', () => {
    const html = renderToStaticMarkup(
      <ReconciliationIndicator status={status()} f={f} through="2026-04-05" withoutStatementHref="/x" />,
    );
    const text = textOf(html);
    expect(html).toMatch(/data-reconciled="false"/);
    expect(text).toContain('Sin conciliar al 5 abr de 2026');
    expect(text).toContain('Último extracto conciliado: 31 mar de 2026 por 3.350,00 BOB');
    expect(text).toContain('1 transacción sin reconciliar');
    expect(html).not.toContain('reconciliation-indicator-without-statement');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-020] una cuenta conciliada sin extracto se indica con su base, el conteo y el enlace al listado filtrado', () => {
    const html = renderToStaticMarkup(
      <ReconciliationIndicator
        status={status({
          lastCompleted: null,
          unreconciledPostedCountThrough: 0,
          reconciledWithoutStatementCount: 2,
          reconciledThrough: true,
          reconciliationBasis: 'WITHOUT_STATEMENT',
        })}
        f={f}
        through="2026-03-31"
        withoutStatementHref="/transacciones?cuenta=a&sinExtracto=1"
      />,
    );
    const text = textOf(html);
    expect(html).toMatch(/data-basis="WITHOUT_STATEMENT"/);
    expect(text).toContain('Conciliada sin extracto al 31 mar de 2026');
    expect(text).toContain('2 transacciones conciliadas sin extracto, pendientes de revisión');
    expect(text).toContain('Todavía no se concilió contra un extracto');
    expect(html).toContain('href="/transacciones?cuenta=a&amp;sinExtracto=1"');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-018] la insignia "conciliada sin extracto — pendiente de revisión" solo aparece con la marca (o el modo)', () => {
    const flagged = tx('f', {
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
      systemFlags: ['RECONCILED_WITHOUT_STATEMENT'],
    });
    const verified = tx('v', { status: 'RECONCILED', reconciliationMode: 'STATEMENT', systemFlags: [] });
    expect(textOf(renderToStaticMarkup(<WithoutStatementBadge tx={flagged} f={txf} />))).toBe(
      'Conciliada sin extracto — pendiente de revisión',
    );
    expect(renderToStaticMarkup(<WithoutStatementBadge tx={verified} f={txf} />)).toBe('');
    expect(renderToStaticMarkup(<WithoutStatementBadge tx={tx('c')} f={txf} />)).toBe('');
    const list = renderToStaticMarkup(
      <TransactionsListView
        transactions={[flagged, verified]}
        names={names}
        f={txf}
        href={(p) => p}
        selected={new Set()}
        selectable={false}
      />,
    );
    expect(list.match(/data-testid="tx-without-statement"/g)).toHaveLength(1);
  });
});
