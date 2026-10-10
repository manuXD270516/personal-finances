import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PARALLEL_RATE } from '../dashboard/fixtures';
import type { HomeQuestionStatus, Money } from '../dashboard/types';
import { activeNav } from '../shell/nav';
import { esContext, textOf } from '../test-support';
import { CommitmentsHomeView } from './CommitmentsHomeView';
import { amountText, homeSlice, itemPath, statusLabel } from './logic';
import type {
  CommittedBlock,
  SurprisePayments,
  UpcomingPaymentItem,
  UpcomingPayments,
  ValuedTotal,
} from './types';
import { UpcomingFullView } from './UpcomingFullView';

const f = esContext('Upcoming');
const bob = (amount: string): Money => ({ amount, currency: 'BOB' });
const usd = (amount: string): Money => ({ amount, currency: 'USD' });
const valued = (amount: string, extra: Partial<ValuedTotal> = {}): ValuedTotal => ({
  byCurrency: [bob(amount)],
  consolidated: { amount: bob(amount), complete: true, unconverted: [] },
  ...extra,
});

const item = (
  name: string,
  date: string,
  amount: string | null,
  over: Partial<UpcomingPaymentItem> = {},
): UpcomingPaymentItem => ({
  kind: 'OCCURRENCE',
  occurrenceId: `occ-${name}`,
  definitionId: `def-${name}`,
  name,
  accountId: 'acc-1',
  accountName: 'Banco BOB',
  date,
  status: 'SCHEDULED',
  amountType: 'FIXED',
  amount: amount === null ? null : bob(amount),
  estimated: false,
  withoutAmount: amount === null,
  converted: amount === null ? null : bob(amount),
  ...over,
});

/** Seis pagos de la semana (TC-REPORTING-UPCOMING-017), FixedClock 2026-10-20 en La Paz. */
const SIX: UpcomingPaymentItem[] = [
  item('Netflix', '2026-10-15', '49.00', { status: 'OVERDUE', daysOverdue: 5 }),
  item('Cena', '2026-10-18', '300.00', {
    kind: 'PENDING_TRANSACTION',
    occurrenceId: undefined as never,
    transactionId: 'txn-cena',
    status: 'PENDING',
    amountType: 'ACTUAL',
  }),
  item('Internet', '2026-10-22', '199.00'),
  item('Spotify', '2026-10-25', null, {
    amount: usd('5.99'),
    converted: bob('71.88'),
    withoutAmount: false,
  }),
  item('Luz', '2026-10-26', '180.00', { amountType: 'ESTIMATED', estimated: true }),
  item('Agua', '2026-10-27', null, { amountType: 'VARIABLE' }),
];

const COMMITTED: CommittedBlock = {
  periodId: 'p-2026-10',
  label: '2026-10',
  from: '2026-10-01',
  to: '2026-10-31',
  total: valued('999.88', { byCurrency: [bob('928.00'), usd('5.99')] }),
  fromCommitments: valued('699.88'),
  fromPending: valued('300.00'),
  withoutAmountCount: 1,
  overdueFromPreviousPeriods: { count: 1, ...valued('120.00') },
};

const UPCOMING: UpcomingPayments = {
  window: { from: '2026-10-20', to: '2026-10-27', days: 7 },
  items: SIX,
  totals: { ...valued('799.88', { byCurrency: [bob('728.00'), usd('5.99')] }), withoutAmountCount: 1 },
  committed: COMMITTED,
  projectedBalances: [
    {
      accountId: 'acc-1',
      accountName: 'Banco BOB',
      currency: 'BOB',
      booked: bob('4000.00'),
      pendingIn: bob('150.00'),
      pendingOut: bob('300.00'),
      projected: bob('3850.00'),
    },
  ],
  hasCommitments: true,
  meta: {
    generatedAt: '2026-10-20T14:00:00.000Z',
    reportingCurrency: 'BOB',
    timeZone: 'America/La_Paz',
    rateWindowDays: 7,
    dataFreshness: '2026-10-20T13:00:00.000Z',
    approx: false,
    rates: [PARALLEL_RATE],
    attributions: [PARALLEL_RATE.attribution!],
  },
};

const AVAILABLE: HomeQuestionStatus = { question: 'Q4', status: 'AVAILABLE', actionHint: null };
const NO_DATA = (question: 'Q4' | 'Q8'): HomeQuestionStatus => ({
  question,
  status: 'NO_DATA',
  actionHint: 'CREATE_COMMITMENT',
});
const href = (path: string) => `/es${path}`;

const home = (over: Partial<Parameters<typeof CommitmentsHomeView>[0]> = {}) =>
  renderToStaticMarkup(
    <CommitmentsHomeView
      upcoming={UPCOMING}
      q4={AVAILABLE}
      q8={{ ...AVAILABLE, question: 'Q8' }}
      f={f}
      fullHref="/es/pagos-proximos"
      createHref="/es/recurring"
      href={href}
      {...over}
    />,
  );

describe('tarjeta Q8 del Home (docs/35 D148)', () => {
  it('[TC-REPORTING-UPCOMING-017] muestra 5 de los 6 pagos de la semana, indica 1 más y enlaza a la vista completa', () => {
    const html = home();
    const rows = [...html.matchAll(/data-testid="upcoming-item"/g)];
    expect(rows).toHaveLength(5);
    const text = textOf(html);
    for (const name of ['Netflix', 'Cena', 'Internet', 'Spotify', 'Luz']) expect(text).toContain(name);
    expect(text).not.toContain('Agua');
    expect(text).toContain('y 1 pago más');
    expect(html).toContain('href="/es/pagos-proximos"');
    expect(text).toContain('Ver todos los pagos próximos');
  });

  it('[TC-REPORTING-UPCOMING-017] lo vencido va marcado con texto y glifo; la pendiente y el estimado se distinguen', () => {
    const html = home();
    expect(textOf(html)).toContain('Vencido hace 5 días');
    expect(html).toContain('data-status="OVERDUE"');
    expect(html).toContain('aria-hidden="true">▲</span>');
    expect(textOf(html)).toContain('Pendiente');
    expect(textOf(html)).toContain('180,00 BOB (estimado)');
  });

  it('[TC-REPORTING-UPCOMING-017] la tarjeta Q4 muestra el total comprometido del periodo y lo vencido de periodos anteriores aparte', () => {
    const html = home();
    expect(html).toContain('data-testid="committed-total"');
    expect(textOf(html)).toContain('999,88 BOB');
    expect(textOf(html)).toContain('octubre de 2026');
    expect(textOf(html)).toContain('1 pago sin monto');
    expect(textOf(html)).toContain(
      '1 pago vencido de periodos anteriores (120,00 BOB); no suma al total del periodo.',
    );
  });

  it('[TC-REPORTING-UPCOMING-018] sin compromisos ni pendientes ambas tarjetas dicen que no hay datos, ofrecen crear un compromiso y no muestran 0.00 BOB', () => {
    const html = home({
      upcoming: undefined,
      q4: NO_DATA('Q4'),
      q8: NO_DATA('Q8'),
    });
    expect(html).toContain('data-testid="question-Q4-no-data"');
    expect(html).toContain('data-testid="question-Q8-no-data"');
    expect(html.match(/data-action="CREATE_COMMITMENT"/g)).toHaveLength(2);
    expect(html).toContain('href="/es/recurring"');
    expect(textOf(html)).toContain('Aún no hay compromisos ni pagos pendientes.');
    expect(html).not.toMatch(/0[.,]00/);
    expect(html).not.toContain('upcoming-full-link');
  });

  it('[TC-REPORTING-DASHBOARD-005] sin cuentas Q4 y Q8 piden crear la primera cuenta, sin montos', () => {
    const noAccounts = (question: 'Q4' | 'Q8'): HomeQuestionStatus => ({
      question,
      status: 'NO_DATA',
      actionHint: 'CREATE_ACCOUNT',
    });
    const html = home({
      upcoming: undefined,
      q4: noAccounts('Q4'),
      q8: noAccounts('Q8'),
      createAccountHref: '/es/cuentas/nueva',
    });
    expect(html.match(/data-action="CREATE_ACCOUNT"/g)).toHaveLength(2);
    expect(html).toContain('href="/es/cuentas/nueva"');
    expect(textOf(html)).toContain('Crea tu primera cuenta para empezar.');
    expect(html).not.toMatch(/\d+,\d{2}/);
  });

  it('semana sin pagos: lo dice sin declararse no disponible', () => {
    const html = home({ upcoming: { ...UPCOMING, items: [] } });
    expect(html).toContain('data-testid="upcoming-empty"');
    expect(textOf(html)).toContain('No hay pagos en los próximos 7 días.');
    expect(html).not.toContain('NOT_AVAILABLE_IN_PHASE');
    expect(html).toContain('upcoming-full-link');
  });

  it('una lectura fallida lo dice sin romper el resto', () => {
    const html = home({ upcoming: 'error' });
    expect(html).toContain('data-testid="question-Q4-error"');
    expect(html).toContain('data-testid="question-Q8-error"');
  });

  it('un total incompleto avisa y lista lo que no tiene tasa, sin convertir 1:1', () => {
    const html = home({
      upcoming: {
        ...UPCOMING,
        totals: {
          ...UPCOMING.totals,
          consolidated: { amount: bob('728.00'), complete: false, unconverted: [usd('5.99')] },
        },
      },
    });
    expect(html).toContain('data-testid="upcoming-incomplete"');
    expect(textOf(html)).toContain('Total incompleto');
    expect(textOf(html)).toContain('5,99 USD');
  });
});

describe('lógica de la vista', () => {
  it('homeSlice recorta a 5 e informa el resto', () => {
    expect(homeSlice(SIX)).toMatchObject({ more: 1 });
    expect(homeSlice(SIX).shown).toHaveLength(5);
    expect(homeSlice(SIX.slice(0, 2))).toMatchObject({ more: 0 });
  });

  it('[TC-REPORTING-UPCOMING-006] el texto del monto sigue su tipo: exacto, estimado, rango y variable', () => {
    const range = item('Gimnasio', '2026-10-24', null, {
      amountType: 'MIN_MAX',
      withoutAmount: false,
      range: { min: bob('150.00'), max: bob('200.00') },
    });
    expect(amountText(item('Internet', '2026-10-22', '199.00'), f)).toBe('199,00 BOB');
    expect(amountText(SIX[4]!, f)).toBe('180,00 BOB (estimado)');
    expect(amountText(range, f)).toBe('150,00 BOB a 200,00 BOB');
    expect(amountText(SIX[5]!, f)).toBe('Monto variable');
  });

  it('el estado vencido incluye los días de atraso y el singular', () => {
    expect(statusLabel({ status: 'OVERDUE', daysOverdue: 1 }, f)).toBe('Vencido hace 1 día');
    expect(statusLabel({ status: 'PENDING_APPROVAL' }, f)).toBe('Por aprobar');
  });

  it('las acciones llevan a la ocurrencia (aprobar, omitir, vincular) o a la transacción pendiente', () => {
    expect(itemPath(SIX[0]!)).toBe('/recurring/occurrences/occ-Netflix');
    expect(itemPath(SIX[1]!)).toBe('/transacciones/txn-cena');
  });

  it('la vista completa pertenece a la sección Pagos recurrentes de la sidebar', () => {
    expect(activeNav('/es/pagos-proximos')).toBe('recurring');
    expect(activeNav('/pagos-proximos')).toBe('recurring');
  });
});

const SURPRISE: SurprisePayments = {
  periodId: 'p-2026-10',
  label: '2026-10',
  from: '2026-10-01',
  to: '2026-10-31',
  partial: true,
  count: 1,
  items: [
    {
      transactionId: 'txn-seguro',
      date: '2026-10-05',
      name: 'Seguro auto',
      amount: bob('350.00'),
      occurrenceId: 'occ-seguro',
      definitionId: 'def-seguro',
      generatedOn: '2026-10-12',
    },
  ],
  note: 'UNLINKED_PAYMENTS_NOT_DETECTED',
};

const full = (over: Partial<Parameters<typeof UpcomingFullView>[0]> = {}) =>
  renderToStaticMarkup(
    <UpcomingFullView
      upcoming={UPCOMING}
      surprise={SURPRISE}
      days={30}
      onDaysChange={() => undefined}
      f={f}
      href={href}
      {...over}
    />,
  );

describe('vista completa /pagos-proximos', () => {
  it('lista con tabla accesible: encabezados de columna y de fila, caption y estados con texto', () => {
    const html = full();
    expect(html).toContain('<caption>');
    expect((html.match(/<th scope="col"/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('<th scope="row"');
    expect(html.match(/data-testid="upcoming-row"/g)).toHaveLength(6);
    expect(textOf(html)).toContain('Vencido hace 5 días');
  });

  it('el selector ofrece 7, 14, 30, 60 y 90 días con 30 seleccionado', () => {
    const html = full();
    for (const d of [7, 14, 30, 60, 90]) expect(html).toContain(`>${d} días</option>`);
    expect(html).toMatch(/<option value="30" selected="">/);
  });

  it('totales por moneda y consolidado con la tasa usada, su fuente y "valorado con la tasa de hoy"', () => {
    const html = full();
    const text = textOf(html);
    expect(html).toContain('data-testid="upcoming-total-consolidated"');
    expect(text).toContain('799,88 BOB');
    expect(text).toContain('728,00 BOB · 5,99 USD');
    expect(text).toContain('Valorado con la tasa de hoy en BOB');
    expect(text).toContain('USDT/BOB 12,02 · PARALLEL');
    expect(text).toContain('Fuente: paralelo.bo');
    expect(text).toContain('1 pago sin monto (no suma al total)');
  });

  it('[TC-REPORTING-UPCOMING-010] sin tasa vigente el consolidado se marca incompleto y el monto queda sin convertir', () => {
    const html = full({
      upcoming: {
        ...UPCOMING,
        items: [
          item('Spotify', '2026-10-25', null, { amount: usd('5.99'), converted: null, withoutAmount: false }),
        ],
        totals: {
          ...UPCOMING.totals,
          consolidated: { amount: bob('199.00'), complete: false, unconverted: [usd('5.99')] },
        },
      },
    });
    expect(html).toContain('data-testid="upcoming-incomplete"');
    expect(textOf(html)).toContain('Sin tasa');
    expect(textOf(html)).toContain('5,99 USD');
  });

  it('[TC-REPORTING-UPCOMING-016] el saldo proyectado se rotula como proyección y va junto al contable', () => {
    const html = full();
    const text = textOf(html);
    expect(text).toContain('Saldo proyectado por cuenta');
    expect(text).toContain('Proyección: saldo contable más ingresos pendientes menos gastos pendientes');
    expect(text).toContain('4.000,00 BOB');
    expect(html).toContain('data-testid="projected-amount"');
    expect(text).toContain('3.850,00 BOB');
  });

  it('[TC-REPORTING-UPCOMING-021] el indicador de pagos sorpresa muestra el detalle, el periodo parcial y su limitación', () => {
    const html = full();
    const text = textOf(html);
    expect(html).toContain('data-testid="surprise-count" data-count="1"');
    expect(text).toContain('1 pago sorpresa en 2026-10');
    expect(text).toContain('periodo en curso (parcial)');
    expect(text).toContain('Seguro auto: 350,00 BOB del');
    expect(textOf(html)).toContain('Solo se detectan los pagos vinculados a un compromiso');
  });

  it('un periodo sin sorpresas dice "Ningún pago sorpresa" y conserva la limitación', () => {
    const html = full({ surprise: { ...SURPRISE, count: 0, items: [], partial: false } });
    expect(textOf(html)).toContain('Ningún pago sorpresa en 2026-10');
    expect(html).toContain('data-testid="surprise-note"');
    expect(html).not.toContain('surprise-list');
  });

  it('sin pagos en la ventana: estado vacío con los días; los enlaces de gestión van a Recurrentes', () => {
    const html = full({ upcoming: { ...UPCOMING, items: [] }, surprise: 'error' });
    expect(textOf(html)).toContain('No hay pagos conocidos en los próximos 7 días.');
    expect(html).toContain('href="/es/recurring"');
    expect(html).toContain('data-testid="surprise-error"');
  });

  it('sin periodo que cubra hoy lo dice en lugar de inventar un total', () => {
    const html = full({ upcoming: { ...UPCOMING, committed: null } });
    expect(html).toContain('data-testid="committed-no-period"');
  });
});
