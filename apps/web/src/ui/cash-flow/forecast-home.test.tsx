import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SUMMARY, SPENDABLE_SUMMARY } from '../dashboard/fixtures';
import { TopCategoriesWidget } from '../dashboard/TopCategoriesWidget';
import type { HomeQuestionStatus, ReportSummary } from '../dashboard/types';
import type { Category, CategoryGroup } from '../common/types';
import { SpendableCard, SpendableDetailView } from '../spendable/SpendableView';
import { horizonView } from '../spendable/logic';
import {
  categoryOptions,
  draftOf,
  MAX_ESSENTIAL_CATEGORIES,
  settingsChanged,
  toggleCategory,
} from '../spendable/settings-logic';
import { SpendableSettingsView } from '../spendable/SpendableSettings';
import { esContext } from '../test-support';
import { CommitmentsHomeView } from '../upcoming/CommitmentsHomeView';
import type { UpcomingPayments } from '../upcoming/types';
import { HOME_BLOCK_HIGH, HOME_BLOCK_NONE, HOME_BLOCK_PREDICTED, bob } from './fixtures';
import { homeCashFlowSummary } from './logic';
import type { SpendableSettings } from './types';

const strip = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
const href = (path: string) => `/es${path}`;

// ───────────────────────────────────────────── Q8

const upcomingCtx = esContext('Upcoming');
const UPCOMING: UpcomingPayments = {
  window: { from: '2026-10-20', to: '2026-10-27', days: 7 },
  items: [],
  totals: {
    byCurrency: [],
    consolidated: { amount: bob('0.00'), complete: true, unconverted: [] },
    withoutAmountCount: 0,
  },
  committed: null,
  projectedBalances: [],
  hasCommitments: true,
  meta: {
    generatedAt: '2026-10-20T14:00:00.000Z',
    reportingCurrency: 'BOB',
    timeZone: 'America/La_Paz',
    rateWindowDays: 7,
    approx: false,
    rates: [],
    attributions: [],
  },
};
const Q4: HomeQuestionStatus = { question: 'Q4', status: 'AVAILABLE', actionHint: null };
const Q8: HomeQuestionStatus = { question: 'Q8', status: 'AVAILABLE', actionHint: null };

const q8 = (cashFlow: Parameters<typeof CommitmentsHomeView>[0]['cashFlow'], over = {}) =>
  renderToStaticMarkup(
    <CommitmentsHomeView
      upcoming={UPCOMING}
      q4={Q4}
      q8={Q8}
      f={upcomingCtx}
      fullHref="/es/pagos-proximos"
      createHref="/es/recurring"
      href={href}
      cashFlow={cashFlow}
      cashFlowHref={(currency) => `/es/flujo-de-caja${currency ? `?moneda=${currency}` : ''}`}
      {...over}
    />,
  );

describe('tarjeta Q8 con el saldo esperado de 30 días (add-cash-flow-forecast, tarea 6.2)', () => {
  it('[TC-REPORTING-FORECAST-017] con riesgo alto en BOB muestra el riesgo, el mínimo -679,00 BOB, la fecha y el enlace al calendario', () => {
    const html = q8(HOME_BLOCK_HIGH);
    const text = strip(html);
    expect(html).toContain('data-testid="cash-flow-q8" data-kind="RISK" data-risk="HIGH"');
    expect(text).toContain('Riesgo alto de déficit en BOB');
    expect(html).toMatch(/data-testid="cash-flow-q8-lowest">-679,00 BOB el 1 nov de 2026</);
    expect(html).toMatch(
      /<a href="\/es\/flujo-de-caja\?moneda=BOB" data-testid="cash-flow-link">Ver el flujo de caja<\/a>/,
    );
  });

  it('[TC-REPORTING-FORECAST-017] sin riesgo muestra el saldo más bajo consolidado (4.949,12 BOB el 28 oct) sin alarma', () => {
    const html = q8(HOME_BLOCK_NONE);
    expect(html).toContain('data-kind="LOWEST"');
    expect(strip(html)).toContain('Sin riesgo de déficit');
    expect(html).toMatch(/data-testid="cash-flow-q8-lowest">4\.949,12 BOB el 28 oct de 2026</);
    expect(strip(html)).toContain('Saldo más bajo esperado en los próximos 30 días');
    expect(html).toContain('href="/es/flujo-de-caja"');
  });

  it('[TC-REPORTING-FORECAST-017] un consolidado incompleto lo dice', () => {
    const html = q8({ ...HOME_BLOCK_NONE, complete: false });
    expect(html).toContain('data-testid="cash-flow-q8-incomplete"');
  });

  it('[TC-REPORTING-FORECAST-017] sin cuentas líquidas (cashFlow null) la tarjeta no muestra saldo esperado ni riesgo y sigue listando pagos', () => {
    for (const none of [null, undefined]) {
      const html = q8(none);
      expect(html).not.toContain('cash-flow-q8');
      expect(html).not.toContain('cash-flow-link');
      expect(html).toContain('data-testid="question-Q8"');
    }
    expect(homeCashFlowSummary(null)).toEqual({ kind: 'NONE' });
    expect(homeCashFlowSummary({ ...HOME_BLOCK_NONE, consolidatedLowest: null })).toEqual({ kind: 'NONE' });
  });

  it('[TC-REPORTING-FORECAST-017] el resumen toma la moneda con riesgo y, sin riesgo, el consolidado', () => {
    expect(homeCashFlowSummary(HOME_BLOCK_HIGH)).toMatchObject({
      kind: 'RISK',
      risk: 'HIGH',
      currency: 'BOB',
    });
    expect(homeCashFlowSummary(HOME_BLOCK_NONE)).toMatchObject({ kind: 'LOWEST', date: '2026-10-28' });
    // Riesgo NONE en la moneda peor: el mínimo consolidado manda; sin consolidado, el de esa moneda.
    const worstNone = {
      ...HOME_BLOCK_NONE,
      worst: { ...HOME_BLOCK_HIGH.worst!, risk: 'NONE' as const },
      consolidatedLowest: null,
    };
    expect(homeCashFlowSummary(worstNone)).toMatchObject({ kind: 'LOWEST', date: '2026-11-01' });
  });

  it('[TC-REPORTING-FORECAST-017] sin compromisos ni pendientes (Q8 NO_DATA) no se agrega el bloque de saldo', () => {
    const html = q8(HOME_BLOCK_HIGH, {
      q8: { question: 'Q8', status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' },
    });
    expect(html).toContain('question-Q8-no-data');
    expect(html).not.toContain('cash-flow-q8');
  });
});

// ───────────────────────────────────────────── Q5

const dash = esContext('Dashboard');
const ESSENTIALS_TERMS = {
  ...SPENDABLE_SUMMARY.byCurrency[0]!,
  essentials: bob('1100.00'),
  spendable: bob('4421.00'),
};
const card = (summary: typeof SPENDABLE_SUMMARY) =>
  renderToStaticMarkup(
    <SpendableCard
      summary={summary}
      noData={undefined}
      generatedAt="2026-10-20T14:00:00Z"
      ctx={dash}
      links={{ detailHref: '/es/disponible', settingsHref: '/es/disponible/ajustes' }}
    />,
  );
const horizon = (over: Partial<NonNullable<typeof SPENDABLE_SUMMARY.horizon>>) => ({
  mode: 'FINANCIAL_PERIOD' as const,
  from: '2026-10-20',
  to: '2026-10-31',
  nextIncome: null,
  fallback: false,
  ...over,
});

describe('tarjeta Q5: horizonte y esenciales (add-cash-flow-forecast, tarea 6.2)', () => {
  it('[TC-REPORTING-FORECAST-022] con los ajustes por omisión muestra el periodo financiero y ningún término de esenciales', () => {
    const html = card({ ...SPENDABLE_SUMMARY, horizon: horizon({}) });
    expect(html).toContain('data-testid="spendable-horizon" data-horizon="PERIOD"');
    expect(strip(html)).toContain('Horizonte: periodo financiero 2026-10');
    expect(html).not.toContain('spendable-term-essentials');
    expect(html).toMatch(/data-testid="spendable-amount"[^>]*>5\.521,00 BOB</);
    // Una API anterior (sin horizon ni essentials) no cambia la tarjeta.
    expect(card(SPENDABLE_SUMMARY)).not.toContain('spendable-horizon');
  });

  it('[TC-REPORTING-FORECAST-022] hasta el próximo ingreso muestra la ocurrencia y su fecha', () => {
    const summary = {
      ...SPENDABLE_SUMMARY,
      horizon: horizon({
        mode: 'NEXT_INCOME',
        to: '2026-10-31',
        nextIncome: { occurrenceId: 'occ-sueldo', name: 'Sueldo', date: '2026-10-31' },
      }),
    };
    const html = card(summary);
    expect(html).toContain('data-horizon="NEXT_INCOME"');
    expect(strip(html)).toContain('hasta el próximo ingreso, «Sueldo» el 31 oct de 2026');
    expect(horizonView(summary)).toMatchObject({ kind: 'NEXT_INCOME', name: 'Sueldo' });
  });

  it('[TC-REPORTING-FORECAST-022] sin ingreso esperado avisa del respaldo de 30 días', () => {
    const summary = {
      ...SPENDABLE_SUMMARY,
      horizon: horizon({ mode: 'NEXT_INCOME', to: '2026-11-19', fallback: true }),
    };
    const html = card(summary);
    expect(html).toContain('data-horizon="FALLBACK"');
    expect(strip(html)).toContain('no hay un ingreso esperado, así que se usan 30 días');
    expect(horizonView(summary)?.kind).toBe('FALLBACK');
  });

  it('[TC-REPORTING-FORECAST-022] cuando el término de esenciales no es null se muestra restando; con null no aparece', () => {
    const on = card({ ...SPENDABLE_SUMMARY, byCurrency: [ESSENTIALS_TERMS] });
    expect(on).toMatch(/data-testid="spendable-term-essentials-amount">-1\.100,00 BOB</);
    expect(strip(on)).toContain('Esenciales presupuestados');
    const off = card({
      ...SPENDABLE_SUMMARY,
      byCurrency: [{ ...ESSENTIALS_TERMS, essentials: null, spendable: bob('5521.00') }],
    });
    expect(off).not.toContain('spendable-term-essentials');
  });

  it('[TC-REPORTING-FORECAST-027] la tarjeta enlaza a los ajustes del disponible', () => {
    expect(card(SPENDABLE_SUMMARY)).toContain('href="/es/disponible/ajustes"');
  });

  it('[TC-REPORTING-FORECAST-022] el detalle muestra las líneas de esenciales con lo comprometido, el prorrateo y los avisos', () => {
    const spendable = {
      ...SPENDABLE_SUMMARY,
      byCurrency: [ESSENTIALS_TERMS],
      horizon: horizon({}),
      committedItems: [],
      reservedByAccount: [],
      plannedByGoal: [],
      essentialItems: [
        {
          categoryId: 'cat-super',
          name: 'Supermercado',
          periodLabel: '2026-10',
          reference: bob('1500.00'),
          actual: bob('400.00'),
          committed: bob('0.00'),
          counted: bob('1100.00'),
          prorated: false,
        },
        {
          categoryId: 'cat-transp',
          name: 'Transporte',
          periodLabel: '2026-11',
          reference: bob('300.00'),
          actual: bob('0.00'),
          committed: bob('0.00'),
          counted: bob('100.00'),
          prorated: true,
        },
      ],
      essentialWarnings: [
        { categoryId: 'cat-salud', reason: 'NO_LINE' as const, periodLabel: '2026-10' },
        { categoryId: 'cat-vieja', reason: 'ARCHIVED' as const, periodLabel: null },
        { categoryId: 'cat-sin-plan', reason: 'NO_PLAN' as const, periodLabel: '2026-11' },
      ],
      meta: { generatedAt: '2026-10-20T14:00:00Z', rateWindowDays: 7, ratesUsed: [], attributions: [] },
    };
    const html = renderToStaticMarkup(
      <SpendableDetailView
        spendable={spendable}
        ctx={dash}
        links={{ settingsHref: '/es/disponible/ajustes' }}
        categoryNames={new Map([['cat-salud', 'Salud']])}
      />,
    );
    const text = strip(html);
    expect([...html.matchAll(/data-testid="spendable-essential-item"/g)]).toHaveLength(2);
    expect(html).toMatch(/<caption[^>]*>Esenciales que restan del disponible<\/caption>/);
    expect(html).toContain('<th scope="col">Categoría</th>');
    expect(html).toContain('data-testid="spendable-essential-prorated"');
    expect(text).toContain('1.100,00 BOB');
    expect([...html.matchAll(/data-testid="spendable-essential-warning"/g)]).toHaveLength(3);
    expect(text).toContain('Salud: el plan de 2026-10 no tiene una línea para esa categoría.');
    expect(text).toContain('Una categoría esencial: la categoría está archivada');
    expect(text).toContain('no hay un plan para 2026-11');
    expect(html).toContain('href="/es/disponible/ajustes"');
  });

  it('[TC-REPORTING-FORECAST-022] el detalle con los esenciales desactivados dice cómo activarlos', () => {
    const html = renderToStaticMarkup(
      <SpendableDetailView
        spendable={{
          ...SPENDABLE_SUMMARY,
          committedItems: [],
          reservedByAccount: [],
          plannedByGoal: [],
          essentialItems: [],
          essentialWarnings: [],
          meta: { generatedAt: '2026-10-20T14:00:00Z', rateWindowDays: 7, ratesUsed: [], attributions: [] },
        }}
        ctx={dash}
      />,
    );
    expect(html).toContain('data-testid="spendable-essentials-off"');
  });
});

// ───────────────────────────────────────────── Q7

const widget = (summary: ReportSummary) =>
  renderToStaticMarkup(<TopCategoriesWidget summary={summary} ctx={dash} kind="expense" />);

describe('Q7: variación por categoría (add-cash-flow-forecast, tarea 6.2)', () => {
  const variation = (
    over: Partial<NonNullable<ReportSummary['topExpenseCategories'][number]['variation']>>,
  ) => ({
    amount: bob('105.00'),
    percent: '8.75',
    isNew: false,
    direction: 'UNFAVORABLE' as const,
    ...over,
  });
  const summary = (...cats: ReportSummary['topExpenseCategories'][number][]): ReportSummary => ({
    ...SUMMARY,
    topExpenseCategories: cats,
  });
  const cat = (name: string, amount: string, previous: string, v: ReturnType<typeof variation> | null) => ({
    categoryId: `cat-${name}`,
    name,
    amount: bob(amount),
    complete: true,
    previousAmount: bob(previous),
    variation: v,
  });

  it('[TC-REPORTING-FORECAST-029] Supermercado +105,00 BOB, +8,75 %, desfavorable', () => {
    const html = widget(summary(cat('Supermercado', '1305.00', '1200.00', variation({}))));
    expect(html).toMatch(/data-testid="top-category-delta"[^>]*>\+105,00 BOB</);
    expect(html).toMatch(/data-testid="top-category-percent"[^>]*>\+8,75 %</);
    expect(html).toMatch(/data-testid="top-category-direction">desfavorable</);
    expect(html).toContain('data-direction="UNFAVORABLE"');
    // Glifo + texto: el sentido no se comunica solo con color.
    expect(html).toContain('aria-hidden="true"');
  });

  it('[TC-REPORTING-FORECAST-029] Fees +5,00 BOB es "nuevo", sin porcentaje', () => {
    const html = widget(
      summary(cat('Fees', '5.00', '0.00', variation({ amount: bob('5.00'), percent: null, isNew: true }))),
    );
    expect(html).toMatch(/data-testid="top-category-new">nuevo</);
    expect(html).toMatch(/data-testid="top-category-delta"[^>]*>\+5,00 BOB</);
    expect(html).not.toContain('top-category-percent');
    expect(html).toContain('data-trend="new"');
  });

  it('[TC-REPORTING-FORECAST-029] una baja del gasto es favorable y con signo menos; sin cambio no inventa un porcentaje', () => {
    const down = widget(
      summary(
        cat(
          'Ocio',
          '80.00',
          '100.00',
          variation({ amount: bob('-20.00'), percent: '-20.00', direction: 'FAVORABLE' }),
        ),
      ),
    );
    expect(down).toMatch(/data-testid="top-category-delta"[^>]*>-20,00 BOB</);
    expect(down).toMatch(/data-testid="top-category-percent"[^>]*>-20,00 %</);
    expect(down).toMatch(/data-testid="top-category-direction">favorable</);
    const flat = widget(
      summary(
        cat('Fijo', '50.00', '50.00', variation({ amount: bob('0.00'), percent: '0.00', direction: 'NONE' })),
      ),
    );
    expect(flat).toMatch(/data-testid="top-category-direction">sin cambio</);
    expect(flat).toContain('data-trend="flat"');
  });

  it('[TC-REPORTING-FORECAST-029] sin variación del servidor (API anterior) conserva la comparación local de antes', () => {
    const html = widget(summary(cat('Supermercado', '1305.00', '1200.00', null)));
    expect(html).toContain('data-trend="up"');
    expect(html).not.toContain('top-category-percent');
  });
});

// ───────────────────────────────────────────── ajustes del disponible

const SAVED: SpendableSettings = {
  horizonMode: 'FINANCIAL_PERIOD',
  subtractEssentials: false,
  essentialCategoryIds: [],
  version: 1,
};
const GROUPS: CategoryGroup[] = [
  { id: 'g-casa', name: 'Casa', kind: 'EXPENSE', sortOrder: 1, version: 1 },
  { id: 'g-ing', name: 'Ingresos', kind: 'INCOME', sortOrder: 2, version: 1 },
];
const category = (id: string, name: string, over: Partial<Category> = {}): Category => ({
  id,
  groupId: 'g-casa',
  name,
  kind: 'EXPENSE',
  isSystem: false,
  sortOrder: 1,
  version: 1,
  ...over,
});
const CATEGORIES: Category[] = [
  category('c-super', 'Supermercado'),
  category('c-transp', 'Transporte', { sortOrder: 2 }),
  category('c-vieja', 'Gimnasio', { archivedAt: '2026-01-01T00:00:00Z', sortOrder: 3 }),
  category('c-salario', 'Salario', { kind: 'INCOME', groupId: 'g-ing' }),
];

const settingsView = (over: Partial<Parameters<typeof SpendableSettingsView>[0]> = {}) =>
  renderToStaticMarkup(
    <SpendableSettingsView
      f={dash}
      uiLocale="es"
      draft={draftOf(SAVED)}
      options={categoryOptions(CATEGORIES, GROUPS, [])}
      canEdit
      backHref="/es/disponible"
      {...over}
    />,
  );

describe('ajustes del disponible (add-cash-flow-forecast, tarea 6.3)', () => {
  it('[TC-REPORTING-FORECAST-028] solo ofrece categorías de gasto no archivadas (no el salario ni las archivadas)', () => {
    const options = categoryOptions(CATEGORIES, GROUPS, []);
    expect(options.map((o) => o.label)).toEqual(['Casa · Supermercado', 'Casa · Transporte']);
    // Una archivada ya marcada se conserva para poder quitarla.
    const kept = categoryOptions(CATEGORIES, GROUPS, ['c-vieja']);
    expect(kept.find((o) => o.id === 'c-vieja')).toMatchObject({ archived: true });
  });

  it('[TC-REPORTING-FORECAST-027] marcar, desmarcar y el tope de 50 categorías', () => {
    expect(toggleCategory([], 'a')).toEqual(['a']);
    expect(toggleCategory(['a', 'b'], 'a')).toEqual(['b']);
    const full = Array.from({ length: MAX_ESSENTIAL_CATEGORIES }, (_, i) => `c${i}`);
    expect(toggleCategory(full, 'extra')).toEqual(full);
    expect(toggleCategory(full, 'c3')).toHaveLength(MAX_ESSENTIAL_CATEGORIES - 1);
  });

  it('[TC-REPORTING-FORECAST-027] detecta cambios sin importar el orden de las categorías', () => {
    const saved: SpendableSettings = { ...SAVED, essentialCategoryIds: ['a', 'b'] };
    expect(settingsChanged(saved, draftOf(saved))).toBe(false);
    expect(settingsChanged(saved, { ...draftOf(saved), essentialCategoryIds: ['b', 'a'] })).toBe(false);
    expect(settingsChanged(saved, { ...draftOf(saved), essentialCategoryIds: ['a'] })).toBe(true);
    expect(settingsChanged(saved, { ...draftOf(saved), horizonMode: 'NEXT_INCOME' })).toBe(true);
    expect(settingsChanged(saved, { ...draftOf(saved), subtractEssentials: true })).toBe(true);
  });

  it('[TC-REPORTING-FORECAST-027] el OWNER ve los controles habilitados y el botón de guardar', () => {
    const html = settingsView();
    expect(html).toContain('data-testid="settings-save"');
    expect(html).not.toContain('data-testid="spendable-settings-readonly"');
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
    expect(html).toMatch(/data-testid="settings-horizon-FINANCIAL_PERIOD"[^>]*checked=""/);
    expect(html).toContain('data-testid="settings-subtract-essentials"');
    expect([...html.matchAll(/data-testid="settings-category"/g)]).toHaveLength(2);
    expect(strip(html)).toContain('0 de 50 categorías seleccionadas');
  });

  it('[TC-REPORTING-FORECAST-028] el resto de los roles lo lee en solo lectura: controles deshabilitados y sin guardar', () => {
    const html = settingsView({ canEdit: false });
    expect(html).toContain('data-testid="spendable-settings-readonly"');
    expect(html).not.toContain('data-testid="settings-save"');
    expect([...html.matchAll(/<fieldset[^>]*disabled/g)].length).toBe(3);
    expect(strip(html)).toContain('Solo el propietario');
  });

  it('[TC-REPORTING-FORECAST-027] una versión vencida (412) muestra el mensaje del catálogo y ofrece recargar', () => {
    const html = settingsView({ problem: { code: 'PRECONDITION_FAILED' }, onReload: () => undefined });
    expect(html).toContain('data-error-code="PRECONDITION_FAILED"');
    expect(strip(html)).toContain('Este registro cambió desde que lo abriste');
    expect(html).toContain('data-testid="settings-reload"');
  });

  it('[TC-REPORTING-FORECAST-028] categoría de ingreso (422) y archivada (409) muestran los mensajes existentes, sin recargar', () => {
    const kind = settingsView({ problem: { code: 'CATEGORY_KIND_MISMATCH' } });
    expect(kind).toContain('data-error-code="CATEGORY_KIND_MISMATCH"');
    expect(strip(kind)).toContain('La categoría no corresponde al tipo de movimiento.');
    expect(kind).not.toContain('settings-reload');
    const archived = settingsView({ problem: { code: 'CATEGORY_ARCHIVED' } });
    expect(strip(archived)).toContain('La categoría está archivada. Elige otra.');
  });

  it('[TC-REPORTING-FORECAST-027] llegado al máximo deshabilita las demás casillas y lo explica', () => {
    const ids = Array.from({ length: MAX_ESSENTIAL_CATEGORIES }, (_, i) => `x${i}`);
    const html = settingsView({
      draft: { ...draftOf(SAVED), subtractEssentials: true, essentialCategoryIds: ids },
    });
    expect(html).toContain('data-testid="settings-categories-max"');
    expect(html).toMatch(/data-testid="settings-category"[^>]*disabled=""/);
  });

  it('[TC-REPORTING-FORECAST-027] avisa si se guardó y si no hay cambios', () => {
    expect(strip(settingsView({ notice: 'saved' }))).toContain('Ajustes guardados.');
    expect(strip(settingsView({ notice: 'noChanges' }))).toContain('No hay cambios que guardar.');
  });
});

describe('tarjeta Q8 con la probabilidad de déficit con el gasto predicho (add-predicted-cash-flow-band, tarea 6.2)', () => {
  it('[TC-REPORTING-PREDICTED-010] muestra que los pagos conocidos no tienen riesgo y, aparte, un déficit posible en BOB el 14 dic si el gasto variable es alto', () => {
    const html = q8(HOME_BLOCK_PREDICTED);
    expect(strip(html)).toContain('Sin riesgo de déficit');
    expect(html).toContain('data-testid="cash-flow-q8-risk"');
    expect(html).toMatch(/data-testid="cash-flow-q8-predicted"\s+data-likelihood="POSSIBLE"/);
    expect(strip(html)).toContain('Si tu gasto variable es alto: déficit posible en BOB el 14 dic de 2026');
    // Línea aparte del riesgo de los pagos conocidos y con el enlace al calendario.
    expect(html).toContain('data-testid="cash-flow-link"');
    expect(html.indexOf('cash-flow-q8-risk')).toBeLessThan(html.indexOf('cash-flow-q8-predicted'));
  });

  it('[TC-REPORTING-PREDICTED-010] probable e improbable tienen su propio texto', () => {
    const likely = q8({
      ...HOME_BLOCK_NONE,
      predictedShortfall: { currency: 'BOB', likelihood: 'LIKELY', date: '2026-12-10' },
    });
    expect(strip(likely)).toContain('déficit probable en BOB el 10 dic de 2026');
    const unlikely = q8({
      ...HOME_BLOCK_NONE,
      predictedShortfall: { currency: 'BOB', likelihood: 'UNLIKELY', date: null },
    });
    expect(strip(unlikely)).toContain('el déficit es improbable en BOB');
  });

  it('[TC-REPORTING-PREDICTED-010] sin predictedShortfall la tarjeta no cambia', () => {
    expect(q8(HOME_BLOCK_NONE)).not.toContain('cash-flow-q8-predicted');
    expect(q8({ ...HOME_BLOCK_NONE, predictedShortfall: null })).not.toContain('cash-flow-q8-predicted');
  });
});
