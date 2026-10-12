import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardView } from '../dashboard/DashboardView';
import { EMPTY_SUMMARY, SPENDABLE_SUMMARY, SUMMARY } from '../dashboard/fixtures';
import type { FormatContext, ReportSummary } from '../dashboard/types';
import { activeNav } from '../shell/nav';
import { businessDateOf, daysUntil, nearPeriodEnd, subtracted } from './logic';
import { SpendableCard, SpendableDetailView } from './SpendableView';
import type { Spendable, SpendableSummary } from './types';

const load = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
const ctxOf = (locale: string): FormatContext => {
  const tr = createTranslator({ locale, messages: load(locale), namespace: 'Dashboard' });
  return {
    locale: 'es-BO',
    timeZone: 'America/La_Paz',
    t: (key, values) => tr(key as never, values as never),
    has: (key) => tr.has(key as never),
  };
};
const ctx = ctxOf('es');
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
const GENERATED = '2026-10-20T14:00:00Z';

const card = (spendable: SpendableSummary | null, over: { noData?: boolean; generatedAt?: string } = {}) =>
  renderToStaticMarkup(
    <SpendableCard
      summary={spendable}
      noData={over.noData ? { actionHint: 'CREATE_ACCOUNT' } : undefined}
      generatedAt={over.generatedAt ?? GENERATED}
      ctx={ctx}
      links={{
        detailHref: '/es/disponible',
        createBudgetHref: '/es/planificacion/presupuestos',
        upcomingHref: '/es/pagos-proximos',
        createAccountHref: '/es/cuentas/nueva',
      }}
    />,
  );
const withSpendable = (over: Partial<SpendableSummary>): SpendableSummary => ({
  ...SPENDABLE_SUMMARY,
  ...over,
});

describe('Q5 del Home: cifra principal y desglose (add-spendable-amount, tarea 6.1)', () => {
  it('[TC-REPORTING-SPENDABLE-001] muestra 5.521,00 BOB libre de compromisos con cada término del desglose, el periodo y los enlaces', () => {
    const html = card(SPENDABLE_SUMMARY);
    expect(html).toMatch(/data-testid="spendable-amount"[^>]*>5\.521,00 BOB</);
    expect(html).toContain('data-status="AVAILABLE"');
    const t = text(html);
    expect(t).toContain('¿Cuánto puedo gastar?');
    expect(t).toContain('Libre de compromisos');
    expect(t).toContain('Periodo 2026-10');
    const term = (key: string) =>
      new RegExp(`data-testid="spendable-term-${key}-amount">([^<]*)<`).exec(html)?.[1];
    expect(term('liquid')).toBe('15.800,00 BOB');
    expect(term('reservedForGoals')).toBe('-5.000,00 BOB');
    expect(term('committed')).toBe('-3.179,00 BOB');
    expect(term('plannedGoalContributions')).toBe('-600,00 BOB');
    expect(term('minimumReserve')).toBe('-1.500,00 BOB');
    expect(term('spendable')).toBe('5.521,00 BOB');
    expect(html).toContain('href="/es/disponible"');
    // Los ingresos esperados no suman: la ayuda lo dice.
    expect(t).toContain('Los ingresos esperados no suman');
  });

  it('[TC-REPORTING-SPENDABLE-001] sin reserva mínima el término no se muestra (no un 0,00 en el desglose)', () => {
    const [bobTerms] = SPENDABLE_SUMMARY.byCurrency;
    const html = card(
      withSpendable({
        byCurrency: [{ ...bobTerms!, minimumReserve: null, spendable: bob('7021.00') }],
        consolidated: { total: bob('7021.00'), complete: true, unconverted: [] },
      }),
    );
    expect(html).not.toContain('spendable-term-minimumReserve');
    expect(html).toMatch(/data-testid="spendable-amount"[^>]*>7\.021,00 BOB</);
  });

  it('[TC-REPORTING-SPENDABLE-002] avisa de los pagos sin monto y de las tarjetas sin pago programado, con pluralización', () => {
    const one = text(card(withSpendable({ withoutAmountCount: 1, cardsWithoutPaymentCount: 1 })));
    expect(one).toContain('1 pago sin monto no está descontado');
    expect(one).toContain('1 tarjeta sin pago programado');
    const many = text(card(withSpendable({ withoutAmountCount: 3, cardsWithoutPaymentCount: 2 })));
    expect(many).toContain('3 pagos sin monto no están descontados');
    expect(many).toContain('2 tarjetas sin pago programado');
    const none = card(withSpendable({ withoutAmountCount: 0, cardsWithoutPaymentCount: 0 }));
    expect(none).not.toContain('spendable-without-amount');
    expect(none).not.toContain('spendable-cards-without-payment');
  });

  it('[TC-REPORTING-SPENDABLE-006] BOB y USD: cada moneda con su desglose y el consolidado incompleto sin tasa muestra lo no convertido', () => {
    const [bobTerms] = SPENDABLE_SUMMARY.byCurrency;
    const html = card(
      withSpendable({
        byCurrency: [
          bobTerms!,
          {
            currency: 'USD',
            liquid: usd('50.00'),
            reservedForGoals: usd('0.00'),
            committed: usd('5.99'),
            plannedGoalContributions: usd('0.00'),
            minimumReserve: null,
            spendable: usd('44.01'),
          },
        ],
        consolidated: { total: bob('5521.00'), complete: false, unconverted: [usd('44.01')] },
      }),
    );
    expect(html).toContain('data-currency="USD"');
    expect(text(html)).toContain('En USD');
    expect(html).toContain('data-testid="spendable-incomplete"');
    expect(text(html)).toContain('44,01 USD sin convertir');
  });

  it('[TC-REPORTING-SPENDABLE-007] el faltante en BOB con excedente en USD indica "conviene convertir"', () => {
    const html = card(withSpendable({ shortfalls: [bob('200.00')] }));
    expect(html).toContain('data-testid="spendable-shortfall"');
    expect(text(html)).toContain('En BOB faltan 200,00 BOB: conviene convertir.');
    expect(html).not.toContain('spendable-warning');
  });

  it('[TC-REPORTING-SPENDABLE-008] el disponible negativo se muestra con signo, alerta con texto e icono y el desglose, nunca 0,00', () => {
    const html = card(
      withSpendable({
        status: 'WARNING',
        byCurrency: [
          {
            currency: 'BOB',
            liquid: bob('2000.00'),
            reservedForGoals: bob('0.00'),
            committed: bob('2600.00'),
            plannedGoalContributions: bob('0.00'),
            minimumReserve: null,
            spendable: bob('-600.00'),
          },
        ],
        consolidated: { total: bob('-600.00'), complete: true, unconverted: [] },
      }),
    );
    expect(html).toMatch(/data-testid="spendable-amount"[^>]*>-600,00 BOB</);
    expect(html).toContain('data-alert="true"');
    expect(html).toMatch(/role="alert"[^>]*data-testid="spendable-warning"/);
    expect(text(html)).toContain('Disponible negativo');
    expect(html).toContain('<span aria-hidden="true">⚠</span>');
    expect(html).toMatch(/data-testid="spendable-term-liquid-amount">2\.000,00 BOB</);
    expect(html).toMatch(/data-testid="spendable-term-committed-amount">-2\.600,00 BOB</);
  });

  it('[TC-REPORTING-SPENDABLE-010] la segunda vista muestra "según tu presupuesto" o, sin plan, ofrece crearlo sin quitar la primera', () => {
    const two = card(SPENDABLE_SUMMARY);
    expect(two).toMatch(/data-testid="spendable-budget-amount">3\.750,00 BOB</);
    expect(text(two)).toContain('Según tu presupuesto');
    const none = card(
      withSpendable({
        budgetView: {
          status: 'NO_PLAN',
          action: 'CREATE_BUDGET',
          budgetId: null,
          amount: null,
          complete: null,
        },
      }),
    );
    expect(text(none)).toContain('No hay presupuesto de este periodo.');
    expect(none).toMatch(
      /<a href="\/es\/planificacion\/presupuestos"[^>]*data-action="CREATE_BUDGET">Crear presupuesto</,
    );
    expect(none).not.toContain('spendable-budget-amount');
    expect(none).toMatch(/data-testid="spendable-amount"[^>]*>5\.521,00 BOB</);
    const partial = card(
      withSpendable({
        budgetView: { ...SPENDABLE_SUMMARY.budgetView, complete: false },
      }),
    );
    expect(partial).toContain('data-testid="spendable-budget-partial"');
  });

  it('[TC-REPORTING-SPENDABLE-011] cerca del fin del periodo enlaza a los próximos pagos; lejos del fin, no', () => {
    expect(card(SPENDABLE_SUMMARY, { generatedAt: '2026-10-28T14:00:00Z' })).toContain(
      'href="/es/pagos-proximos"',
    );
    expect(card(SPENDABLE_SUMMARY, { generatedAt: '2026-10-10T14:00:00Z' })).not.toContain('pagos-proximos');
    // Fin de periodo en la zona del workspace: a las 23:30 del 31 en La Paz (03:30Z del 1) es el último día.
    expect(daysUntil('2026-10-31', '2026-11-01T03:30:00Z', 'America/La_Paz')).toBe(0);
    expect(businessDateOf('2026-11-01T03:30:00Z', 'America/La_Paz')).toBe('2026-10-31');
    expect(nearPeriodEnd('2026-10-31', '2026-11-02T14:00:00Z', 'America/La_Paz')).toBe(false);
  });

  it('[TC-REPORTING-SPENDABLE-015] sin cuentas líquidas la tarjeta indica que no hay datos y ofrece crear una cuenta, sin 0,00 BOB', () => {
    const html = card(null, { noData: true });
    expect(html).toContain('data-status="NO_DATA"');
    expect(text(html)).toContain('Aún no tienes cuentas líquidas.');
    expect(html).toContain('<a href="/es/cuentas/nueva">Crea tu primera cuenta para empezar.</a>');
    expect(html).not.toMatch(/\d+,\d{2}/);
    // Sin bloque y sin NO_DATA (respuesta anterior a Phase 4) no se dibuja nada.
    expect(card(null)).toBe('');
  });

  it('subtracted niega los términos que restan y deja el cero sin signo', () => {
    expect(subtracted(bob('5000.00'))).toEqual(bob('-5000.00'));
    expect(subtracted(bob('-5.00'))).toEqual(bob('5.00'));
    expect(subtracted(bob('0.00'))).toEqual(bob('0.00'));
  });
});

describe('Q5 en el Home completo', () => {
  const render = (summary: ReportSummary) =>
    renderToStaticMarkup(
      <DashboardView
        summary={summary}
        {...ctx}
        spendableDetailHref="/es/disponible"
        createBudgetHref="/es/planificacion/presupuestos"
        upcomingHref="/es/pagos-proximos"
        createAccountHref="/es/cuentas/nueva"
      />,
    );

  it('[TC-REPORTING-SPENDABLE-001] la tarjeta va justo después del dinero disponible y antes de los compromisos', () => {
    const html = renderToStaticMarkup(
      <DashboardView
        summary={SUMMARY}
        {...ctx}
        commitmentsSection={<section data-testid="commitments">Q4 y Q8</section>}
      />,
    );
    const liquid = html.indexOf('data-testid="liquid-balance"');
    const q5 = html.indexOf('data-testid="question-Q5"');
    const commitments = html.indexOf('data-testid="commitments"');
    expect(q5).toBeGreaterThan(liquid);
    expect(commitments).toBeGreaterThan(q5);
  });

  it('[TC-REPORTING-SPENDABLE-015] sin cuentas Q5 es NO_DATA con la acción de crear una cuenta y el Home no muestra 0,00 BOB', () => {
    const html = render(EMPTY_SUMMARY);
    expect(html).toMatch(/data-testid="question-Q5"[^>]*data-status="NO_DATA"/);
    expect(html).toContain('data-testid="question-Q5-no-data"');
    expect(html).not.toMatch(/0,00 BOB|0\.00 BOB/);
  });

  it('[TC-REPORTING-DASHBOARD-005] con una API anterior (Q5 no disponible por fase) la tarjeta sigue como "no disponible"', () => {
    const old: ReportSummary = {
      ...SUMMARY,
      spendable: undefined,
      questions: SUMMARY.questions.map((q) =>
        q.question === 'Q5'
          ? { ...q, status: 'NOT_AVAILABLE_IN_PHASE' as const, actionHint: 'AVAILABLE_IN_PHASE_2' }
          : q,
      ),
    };
    expect(render(old)).toMatch(/data-testid="question-Q5"[^>]*data-status="NOT_AVAILABLE_IN_PHASE"/);
  });

  it('el detalle del disponible cuelga del Inicio en la navegación', () => {
    expect(activeNav('/es/disponible')).toBe('home');
    expect(activeNav('/disponible')).toBe('home');
  });
});

describe('Vista de detalle del disponible (tarea 6.2)', () => {
  const DETAIL: Spendable = {
    ...SPENDABLE_SUMMARY,
    committedItems: [
      {
        source: 'OCCURRENCE',
        id: 'o1',
        definitionId: 'd1',
        name: 'Seguro',
        kind: 'EXPENSE',
        date: '2026-09-28',
        accountId: 'a1',
        amount: bob('120.00'),
        overdueFromPrevious: true,
      },
      {
        source: 'PENDING',
        id: 't1',
        definitionId: null,
        name: null,
        kind: 'EXPENSE',
        date: '2026-10-18',
        accountId: 'a1',
        amount: bob('300.00'),
        overdueFromPrevious: false,
      },
    ],
    reservedByAccount: [
      {
        accountId: 'a1',
        name: 'Banco BOB',
        balance: bob('1500.00'),
        reserved: bob('2000.00'),
        counted: bob('1500.00'),
      },
    ],
    plannedByGoal: [{ goalId: 'g1', goalName: 'Fondo de emergencia', pending: bob('600.00') }],
    meta: {
      generatedAt: GENERATED,
      rateWindowDays: 7,
      dataFreshness: '2026-10-20T13:55:00Z',
      ratesUsed: [
        {
          rate: { base: 'USD', quote: 'BOB', value: '12.00' },
          fxRateId: 'r1',
          derivation: 'DIRECT',
          rateType: 'PARALLEL',
          source: 'PROVIDER',
          asOf: '2026-10-20T13:00:00Z',
          ageDays: 0,
          ageSeconds: 3600,
          approx: false,
          stale: false,
          attribution: null,
        } as never,
      ],
      attributions: [
        {
          provider: 'PARALELO_BO',
          text: 'Fuente: paralelo.bo',
          url: 'https://paralelo.bo',
          license: 'CC BY 4.0',
          licenseUrl: null,
        },
      ],
    },
  };
  const html = renderToStaticMarkup(
    <SpendableDetailView spendable={DETAIL} ctx={ctx} links={{ homeHref: '/es' }} />,
  );

  it('[TC-REPORTING-SPENDABLE-012] lista los compromisos descontados con fecha, marca de vencido y nombre por omisión de la pendiente', () => {
    const items = html.match(/<li data-testid="spendable-committed-item"[\s\S]*?<\/li>/g) ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('data-overdue="true"');
    expect(text(items[0]!)).toContain('Seguro');
    expect(text(items[0]!)).toContain('120,00 BOB');
    expect(text(items[0]!)).toContain('Vencido de un periodo anterior');
    expect(text(items[1]!)).toContain('Transacción pendiente');
  });

  it('[TC-REPORTING-SPENDABLE-005] muestra lo reservado por cuenta con el tope en el saldo y los aportes planificados por meta', () => {
    expect(text(html)).toContain(
      'Banco BOB: reservado 2.000,00 BOB, resta 1.500,00 BOB (saldo 1.500,00 BOB)',
    );
    expect(text(html)).toContain('Fondo de emergencia · 600,00 BOB');
  });

  it('[TC-REPORTING-SPENDABLE-006] informa las tasas usadas con su atribución y la frescura de los datos', () => {
    expect(text(html)).toContain('USD/BOB 12.00');
    expect(html).toContain(
      '<a href="https://paralelo.bo" target="_blank" rel="noopener noreferrer">Fuente: paralelo.bo</a>',
    );
    expect(html).toContain('data-testid="spendable-meta"');
    expect(html).toContain('href="/es"');
  });
});

describe('i18n de la tarjeta Q5 (es, en, pt)', () => {
  it('las tres lenguas traducen el desglose, los avisos y la vista de detalle con las mismas claves', () => {
    const keys = (locale: string) => {
      const dash = (load(locale)['Dashboard'] as Record<string, unknown>)['spendable'] as Record<
        string,
        unknown
      >;
      const flat = (o: Record<string, unknown>, prefix = ''): string[] =>
        Object.entries(o).flatMap(([k, v]) =>
          typeof v === 'object' && v !== null
            ? flat(v as Record<string, unknown>, `${prefix}${k}.`)
            : [`${prefix}${k}`],
        );
      return flat(dash).sort();
    };
    expect(keys('en')).toEqual(keys('es'));
    expect(keys('pt')).toEqual(keys('es'));
    for (const locale of ['en', 'pt']) {
      const c = ctxOf(locale);
      const html = renderToStaticMarkup(
        <SpendableCard summary={SPENDABLE_SUMMARY} noData={undefined} generatedAt={GENERATED} ctx={c} />,
      );
      expect(html).not.toContain('¿Cuánto puedo gastar?');
      expect(html).toMatch(/data-testid="spendable-amount"[^>]*>5\.521,00 BOB</);
    }
    expect(
      text(
        renderToStaticMarkup(
          <SpendableCard
            summary={SPENDABLE_SUMMARY}
            noData={undefined}
            generatedAt={GENERATED}
            ctx={ctxOf('en')}
          />,
        ),
      ),
    ).toContain('How much can I spend?');
  });
});
