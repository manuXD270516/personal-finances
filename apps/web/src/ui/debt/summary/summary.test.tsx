import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../../test-support';
import { DebtSummaryCardView } from './DebtSummaryCard';
import { DebtSummaryView } from './DebtSummaryPanel';
import { debtDetailPath, debtFreeMonth, hasInterest, nextDue } from './logic';
import type { DebtSummary } from './types';

const f = esContext('DebtSummary');
const m = (amount: string, currency = 'BOB') => ({ amount, currency });
const href = (p: string) => p;

const summary = (over: Partial<DebtSummary> = {}): DebtSummary => ({
  status: 'ACTIVE',
  asOf: '2026-10-28',
  baseCurrency: 'BOB',
  debts: [
    {
      kind: 'LOAN',
      id: 'loan-1',
      name: 'Préstamo auto',
      balances: [
        {
          accountId: 'a-loan',
          accountName: 'Préstamo auto',
          outstanding: m('45000.00'),
          includedInNetWorth: true,
        },
      ],
      estimatedPayoffDate: '2029-06-05',
      payoffEstimable: true,
    },
    {
      kind: 'CREDIT_CARD',
      id: 'card-1',
      name: 'Visa Oro',
      balances: [
        {
          accountId: 'a-bob',
          accountName: 'Visa Oro BOB',
          outstanding: m('1120.50'),
          includedInNetWorth: true,
        },
        {
          accountId: 'a-usd',
          accountName: 'Visa Oro USD',
          outstanding: m('100.00', 'USD'),
          includedInNetWorth: true,
        },
      ],
      estimatedPayoffDate: '2026-11-15',
      payoffEstimable: true,
    },
    {
      kind: 'OTHER_LIABILITY',
      id: 'a-fam',
      name: 'Deuda familiar',
      balances: [
        {
          accountId: 'a-fam',
          accountName: 'Deuda familiar',
          outstanding: m('2000.00'),
          includedInNetWorth: false,
        },
      ],
      estimatedPayoffDate: null,
      payoffEstimable: false,
    },
  ],
  totals: {
    byCurrency: [m('48120.50'), m('100.00', 'USD')],
    consolidated: { amount: m('49100.50'), complete: true, unconverted: [] },
  },
  creditBalances: [],
  interestYtd: {
    from: '2026-01-01',
    to: '2026-10-28',
    byCurrency: [m('3250.40'), m('12.00', 'USD')],
    consolidated: { amount: m('3367.40'), complete: true, unconverted: [] },
    attribution: [
      { kind: 'LOAN', id: 'loan-1', name: 'Préstamo auto', byCurrency: [m('3250.40')] },
      { kind: 'CREDIT_CARD', id: 'card-1', name: 'Visa Oro', byCurrency: [m('12.00', 'USD')] },
      { kind: 'OTHER', id: null, name: null, byCurrency: [] },
    ],
    attributionConsistent: true,
  },
  debtFree: {
    date: '2029-06-05',
    excluded: [{ kind: 'OTHER_LIABILITY', id: 'a-fam', name: 'Deuda familiar' }],
  },
  upcomingDues: [
    {
      kind: 'LOAN',
      id: 'loan-1',
      name: 'Préstamo auto',
      accountId: 'a-loan',
      dueDate: '2026-11-05',
      amount: m('1850.00'),
      minimum: null,
      estimated: false,
      overdueDays: 0,
    },
    {
      kind: 'CREDIT_CARD',
      id: 'card-1',
      name: 'Visa Oro',
      accountId: 'a-bob',
      dueDate: '2026-11-15',
      amount: m('1120.50'),
      minimum: m('56.02'),
      estimated: false,
      overdueDays: 0,
    },
  ],
  meta: { ratesUsed: [], rateWindowDays: 7 },
  ...over,
});

const card = (s: DebtSummary) =>
  textOf(
    renderToStaticMarkup(
      <DebtSummaryCardView
        summary={s}
        f={f}
        href="/debts?vista=resumen"
        registerLoanHref="/debts/nuevo"
        registerCardHref="/debts/tarjetas/nueva"
      />,
    ),
  );
const cardHtml = (s: DebtSummary) =>
  renderToStaticMarkup(
    <DebtSummaryCardView
      summary={s}
      f={f}
      href="/debts?vista=resumen"
      registerLoanHref="/debts/nuevo"
      registerCardHref="/debts/tarjetas/nueva"
    />,
  );

describe('Tarjeta "Deudas" del Home', () => {
  it('[TC-DEBT-SUMMARY-009] muestra total, interés del año, fecha libre de deudas sin contar la deuda familiar y el próximo vencimiento', () => {
    const text = card(summary());
    expect(text).toContain('49.100,50 BOB adeudados');
    expect(text).toContain('3.367,40 BOB de interés en 2026');
    expect(text).toContain('libre de deudas en junio de 2029 (sin contar Deuda familiar)');
    expect(text).toContain('Préstamo auto · 05/11/2026 · 1.850,00 BOB');
    expect(cardHtml(summary())).toContain('href="/debts?vista=resumen"');
    expect(text).toContain('Supone que pagas lo facturado');
  });

  it('[TC-DEBT-SUMMARY-009] consolidado incompleto: 48.120,50 BOB con el aviso "sin convertir: 100,00 USD"', () => {
    const s = summary({
      totals: {
        byCurrency: [m('48120.50'), m('100.00', 'USD')],
        consolidated: { amount: m('48120.50'), complete: false, unconverted: [m('100.00', 'USD')] },
      },
    });
    const text = card(s);
    expect(text).toContain('48.120,50 BOB adeudados');
    expect(text).toContain('sin convertir: 100,00 USD');
    expect(cardHtml(s)).toContain('role="status"');
  });

  it('[TC-DEBT-SUMMARY-009] una cuota atrasada se marca con texto e icono', () => {
    const s = summary({
      upcomingDues: [{ ...summary().upcomingDues[0]!, overdueDays: 2 }],
    });
    expect(card(s)).toContain('2 días de atraso');
  });

  it('[TC-DEBT-SUMMARY-010] sin cuentas de pasivo: indica que no hay deudas registradas, ofrece registrar y no muestra montos en cero', () => {
    const s = summary({
      status: 'NO_LIABILITIES',
      debts: [],
      totals: { byCurrency: [], consolidated: { amount: m('0.00'), complete: true, unconverted: [] } },
      upcomingDues: [],
      debtFree: { date: null, excluded: [] },
    });
    const text = card(s);
    expect(text).toContain('No hay deudas registradas.');
    expect(text).toContain('Registrar un préstamo');
    expect(text).toContain('Registrar una tarjeta');
    expect(text).not.toMatch(/0,00/);
    const html = cardHtml(s);
    expect(html).toContain('href="/debts/nuevo"');
    expect(html).toContain('href="/debts/tarjetas/nueva"');
  });

  it('[TC-DEBT-SUMMARY-010] pasivos saldados: "No hay deudas pendientes." sin fecha ni próximo vencimiento', () => {
    const s = summary({
      status: 'NO_DEBT',
      debts: [],
      totals: { byCurrency: [], consolidated: { amount: m('0.00'), complete: true, unconverted: [] } },
      interestYtd: {
        ...summary().interestYtd,
        byCurrency: [],
        consolidated: { amount: m('0.00'), complete: true, unconverted: [] },
      },
      upcomingDues: [],
      debtFree: { date: null, excluded: [] },
    });
    const text = card(s);
    expect(text).toContain('No hay deudas pendientes.');
    expect(text).not.toContain('libre de deudas');
    expect(text).not.toContain('Próximo vencimiento');
    expect(text).not.toMatch(/0,00/);
  });

  it('[TC-DEBT-SUMMARY-009] si ninguna deuda es estimable lo dice sin inventar una fecha', () => {
    const s = summary({
      debtFree: { date: null, excluded: [{ kind: 'OTHER_LIABILITY', id: 'a-fam', name: 'Deuda familiar' }] },
    });
    const text = card(s);
    expect(text).toContain('No podemos estimar cuándo terminas de pagar: Deuda familiar');
    expect(text).not.toContain('libre de deudas en');
  });
});

describe('Resumen de deudas (pestaña de /debts)', () => {
  const panel = (s: DebtSummary) => renderToStaticMarkup(<DebtSummaryView summary={s} f={f} href={href} />);

  it('[TC-DEBT-SUMMARY-001] tabla por deuda y moneda con encabezados de fila y columna; la deuda familiar no es estimable y no está en el patrimonio', () => {
    const html = panel(summary());
    const text = textOf(html);
    expect(html).toContain(
      '<caption class="pf-sr-only">Deudas por tipo y moneda con su fecha estimada de fin</caption>',
    );
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(text).toContain('48.120,50 BOB');
    expect(text).toContain('100,00 USD');
    expect(text).toContain('Consolidado en BOB: 49.100,50 BOB');
    expect(text).toContain('No estimable');
    expect(text).toContain('No incluido en el patrimonio');
    expect(html).toContain('href="/debts/loan-1"');
    expect(html).toContain('href="/debts/tarjetas/card-1"');
    expect((html.match(/data-testid="debt-row"/g) ?? []).length).toBe(4);
  });

  it('[TC-DEBT-SUMMARY-003] el saldo a favor se muestra aparte con su nota', () => {
    const s = summary({
      creditBalances: [{ accountId: 'a-usd', name: 'Visa Oro USD', amount: m('30.00', 'USD') }],
    });
    const text = textOf(panel(s));
    expect(text).toContain('Visa Oro USD: 30,00 USD a favor');
    expect(text).toContain('no restan de lo que debes');
  });

  it('[TC-DEBT-SUMMARY-004] desglose del interés por préstamo y tarjeta; consolidado 3.367,40 BOB', () => {
    const text = textOf(panel(summary()));
    expect(text).toContain('Interés pagado en 2026');
    expect(text).toContain('Consolidado en BOB: 3.367,40 BOB');
    expect(text).toContain('3.250,40 BOB');
    expect(text).toContain('12,00 USD');
    expect(text).not.toContain('Otros intereses');
  });

  it('[TC-DEBT-SUMMARY-005] otros intereses (25,00 BOB) y aviso cuando el desglose no cuadra', () => {
    const base = summary();
    const s = summary({
      interestYtd: {
        ...base.interestYtd,
        attribution: [
          ...base.interestYtd.attribution.slice(0, 2),
          { kind: 'OTHER', id: null, name: null, byCurrency: [m('-25.00')] },
        ],
        attributionConsistent: false,
      },
    });
    const html = panel(s);
    expect(textOf(html)).toContain('Otros intereses');
    expect(html).toContain('data-testid="debt-attribution-inconsistent"');
  });

  it('[TC-DEBT-SUMMARY-006] fecha libre de deudas con los supuestos y las deudas que no cuentan', () => {
    const text = textOf(panel(summary()));
    expect(text).toContain('junio de 2029 (05/06/2029)');
    expect(text).toContain('Supuestos:');
    expect(text).toContain('No se pudo estimar y no cuenta en la fecha: Deuda familiar.');
  });

  it('[TC-DEBT-SUMMARY-007] todos los próximos vencimientos con el mínimo de la tarjeta', () => {
    const html = panel(summary());
    expect((html.match(/data-testid="debt-due-row"/g) ?? []).length).toBe(2);
    expect(textOf(html)).toContain('56,02 BOB');
  });

  it('[TC-DEBT-SUMMARY-010] sin pasivos y sin deudas pendientes, solo el mensaje', () => {
    const none = panel(summary({ status: 'NO_LIABILITIES', debts: [] }));
    expect(textOf(none)).toContain('Aún no registraste préstamos ni tarjetas');
    expect(none).not.toContain('debt-totals-table');
    const settled = panel(summary({ status: 'NO_DEBT', debts: [] }));
    expect(textOf(settled)).toContain('No hay deudas pendientes.');
    expect(settled).not.toContain('debt-dues-table');
  });
});

describe('lógica del resumen de deudas', () => {
  it('[TC-DEBT-SUMMARY-009] mes y año de la fecha libre de deudas en es-BO', () => {
    expect(debtFreeMonth('2029-06-05', 'es-BO')).toBe('junio de 2029');
  });

  it('[TC-DEBT-SUMMARY-007] el próximo vencimiento es el primero de la lista y los otros pasivos no tienen detalle', () => {
    expect(nextDue(summary())?.name).toBe('Préstamo auto');
    expect(nextDue(summary({ upcomingDues: [] }))).toBeNull();
    expect(debtDetailPath('LOAN', 'x')).toBe('/debts/x');
    expect(debtDetailPath('CREDIT_CARD', 'x')).toBe('/debts/tarjetas/x');
    expect(debtDetailPath('OTHER_LIABILITY', 'x')).toBeNull();
  });

  it('[TC-DEBT-SUMMARY-010] un interés en cero no cuenta como interés', () => {
    const base = summary();
    expect(hasInterest(base)).toBe(true);
    expect(hasInterest({ ...base, interestYtd: { ...base.interestYtd, byCurrency: [m('0.00')] } })).toBe(
      false,
    );
    expect(hasInterest({ ...base, interestYtd: { ...base.interestYtd, byCurrency: [] } })).toBe(false);
  });
});
