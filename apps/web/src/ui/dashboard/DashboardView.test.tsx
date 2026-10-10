import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compareCategory, hasCategoryComparison } from './category-comparison';
import { DashboardSkeleton, DashboardView } from './DashboardView';
import { EMPTY_SUMMARY, PARALLEL_RATE, SUMMARY } from './fixtures';
import { formatAge, formatSignedDecimal } from './format';
import { RateSourceBadge } from './RateSourceBadge';
import type { FormatContext, ReportSummary, ResolvedRate, TopCategory } from './types';

const messages = JSON.parse(
  readFileSync(new URL('../../../messages/es.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const tr = createTranslator({ locale: 'es', messages, namespace: 'Dashboard' });
const ctx: FormatContext = {
  locale: 'es-BO',
  timeZone: 'America/La_Paz',
  t: (key, values) => tr(key as never, values as never),
  has: (key) => tr.has(key as never),
};

const render = (summary: ReportSummary) => renderToStaticMarkup(<DashboardView summary={summary} {...ctx} />);
const renderBadge = (rate: ResolvedRate) => renderToStaticMarkup(<RateSourceBadge rate={rate} ctx={ctx} />);
/** HTML de la primera sección con ese `data-testid` (las secciones del Home no se anidan). */
const section = (html: string, testId: string): string => {
  const m = new RegExp(`<section data-testid="${testId}"[\\s\\S]*?</section>`).exec(html);
  if (!m) throw new Error(`sin sección ${testId}`);
  return m[0];
};
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
/** Elemento `<li data-testid="top-category">` de una categoría (no anidan otros `<li>`). */
const categoryRow = (html: string, name: string): string => {
  const rows = html.match(/<li data-testid="top-category"[\s\S]*?<\/li>/g) ?? [];
  const row = rows.find((r) => r.includes(`>${name}<`));
  if (!row) throw new Error(`sin categoría ${name}`);
  return row;
};
const cat = (id: string, name: string, amount: string, previous?: string | null): TopCategory => ({
  categoryId: `0190a000-0000-7000-8000-0000000000${id}`,
  name,
  amount: { amount, currency: 'BOB' },
  complete: true,
  ...(previous === undefined
    ? {}
    : { previousAmount: previous === null ? null : { amount: previous, currency: 'BOB' } }),
});
/** El fixture con el top de gasto reemplazado. */
const withExpenseTop = (...items: TopCategory[]): ReportSummary => ({
  ...SUMMARY,
  topExpenseCategories: items,
});

describe('Home: dinero disponible y tasa usada (add-basic-dashboard, tarea 6.1)', () => {
  it('Q1 muestra el consolidado, los totales líquidos por moneda y la tasa USDT/BOB PARALLEL con su fuente', () => {
    const q1 = section(render(SUMMARY), 'liquid-balance');
    expect(q1).toContain('¿Cuánto dinero tengo?');
    expect(q1).toMatch(/data-testid="liquid-balance-amount"[^>]*>1\.406,50 BOB</);
    expect(q1).toContain('805,50 BOB');
    expect(q1).toContain('50,000000 USDT');
    const badge = text(q1);
    expect(badge).toContain('USDT/BOB 12,02 · PARALLEL');
    expect(q1).toContain(
      '<a href="https://paralelo.bo" target="_blank" rel="noopener noreferrer">Fuente: paralelo.bo</a>',
    );
    expect(q1).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(badge).toContain('CC BY 4.0');
    // Vigencia 2026-09-30T21:53:07Z = 17:53 en La Paz; antigüedad 413 s = 6 min.
    expect(badge).toMatch(/vigencia: 30[^·]*2026[^·]*(17:53|5:53)/);
    expect(badge).toContain('hace 6 min');
    expect(q1).toContain('data-stale="false"');
    expect(q1).not.toContain('obsoleta');
    expect(q1).not.toContain('liquid-balance-incomplete');
  });

  it('una tasa de provider obsoleta se marca con el texto "obsoleta" y su antigüedad (hace 8 h)', () => {
    const html = renderBadge({
      ...PARALLEL_RATE,
      asOf: '2026-09-30T13:53:07Z',
      ageSeconds: 29_213,
      selection: 'LAST_KNOWN_STALE',
      stale: true,
    });
    expect(html).toContain('data-stale="true"');
    expect(html).toContain('<strong data-testid="rate-stale">obsoleta</strong>');
    expect(text(html)).toContain('hace 8 h');
    expect(text(html)).toContain('Fuente: paralelo.bo');
  });

  it('una tasa manual muestra su fuente declarada y el origen manual, sin atribución de provider', () => {
    const html = renderBadge({
      ...PARALLEL_RATE,
      rate: { base: 'USDT', quote: 'BOB', value: '11.98' },
      rateType: 'P2P',
      source: 'MANUAL',
      provider: null,
      selection: 'MANUAL',
      attribution: null,
      sourceLabel: 'Casa de cambio centro',
    });
    expect(text(html)).toContain('USDT/BOB 11,98 · P2P');
    expect(text(html)).toContain('Fuente: Casa de cambio centro · origen manual');
    expect(html).not.toContain('paralelo.bo');
  });

  it('los montos sin tasa vigente se listan sin convertir con la acción de registrar la tasa (sin 1:1)', () => {
    const html = render({
      ...SUMMARY,
      consolidated: {
        ...SUMMARY.consolidated,
        complete: false,
        unconverted: [{ amount: '0.01000000', currency: 'BTC' }],
      },
    });
    const q1 = section(html, 'liquid-balance');
    expect(q1).toContain('data-testid="liquid-balance-incomplete"');
    expect(text(q1)).toContain('Total incompleto');
    expect(q1).toMatch(/data-testid="unconverted-amount">0,01000000 BTC</);
    expect(q1).toContain('Registrar tasa BTC/BOB');
    // Con la pantalla de tasas disponible, la acción es un enlace con el par prellenado.
    const linked = renderToStaticMarkup(
      <DashboardView
        summary={{
          ...SUMMARY,
          consolidated: {
            ...SUMMARY.consolidated,
            complete: false,
            unconverted: [{ amount: '0.01000000', currency: 'BTC' }],
          },
        }}
        {...ctx}
        registerRateHref="/fx"
      />,
    );
    expect(linked).toContain('<a href="/fx?base=BTC&amp;quote=BOB">Registrar tasa BTC/BOB</a>');
    expect(q1).toMatch(/data-testid="liquid-balance-amount"[^>]*>1\.406,50 BOB</);
  });

  it('saldos por cuenta en su moneda original y convertidos cuando hay tasa', () => {
    const list = section(render(SUMMARY), 'account-balances');
    expect(text(list)).toContain('Banco BOB (Banco): 685,00 BOB');
    expect(text(list)).toContain('Caja BOB (Efectivo): 120,50 BOB');
    expect(text(list)).toContain('Wallet USDT (Billetera cripto): 50,000000 USDT ≈ 601,00 BOB');
    expect(text(list)).toContain('Visa (Tarjeta de crédito · pasivo): 400,00 BOB');
  });
});

describe('Home: ingresos, gastos, ahorro y comparación (tarea 6.1)', () => {
  it('Q2, Q3 y Q6 con la tasa de ahorro y la variación contra el mes anterior', () => {
    const html = render(SUMMARY);
    expect(section(html, 'income')).toMatch(/data-testid="income-amount"[^>]*>8\.000,00 BOB</);
    expect(section(html, 'expense')).toMatch(/data-testid="expense-amount"[^>]*>1\.305,00 BOB</);
    const savings = section(html, 'savings');
    expect(savings).toMatch(/data-testid="savings-amount"[^>]*>6\.695,00 BOB</);
    expect(savings).toContain('<strong data-testid="savings-rate">83,7 %</strong>');
  });

  it('un aumento de gasto se comunica con texto ("aumento de gasto"), no solo con color', () => {
    const expense = section(render(SUMMARY), 'expense');
    expect(expense).toContain('data-trend="expense-up"');
    expect(text(expense)).toContain('+105,00 BOB (+8,75 %) · aumento de gasto respecto al mes anterior');
  });

  it('sin ingresos el mes anterior la variación porcentual se muestra como "nuevo"', () => {
    const income = section(render(SUMMARY), 'income');
    expect(income).toContain('data-trend="income-up"');
    expect(text(income)).toContain('+8.000,00 BOB (nuevo)');
  });

  it('sin ingresos en el mes la tasa de ahorro se muestra como "—" (nunca 0 % ni infinito)', () => {
    const html = render({
      ...SUMMARY,
      consolidated: {
        ...SUMMARY.consolidated,
        income: { amount: '0.00', currency: 'BOB' },
        savingsRate: null,
      },
    });
    expect(section(html, 'savings')).toContain('<strong data-testid="savings-rate">—</strong>');
  });

  it('un gasto que baja se indica como disminución', () => {
    const html = render({
      ...SUMMARY,
      comparison: {
        ...SUMMARY.comparison!,
        expense: {
          ...SUMMARY.comparison!.expense,
          deltaAbs: { amount: '-95.00', currency: 'BOB' },
          deltaPct: '-6.78',
        },
      },
    });
    const expense = section(html, 'expense');
    expect(expense).toContain('data-trend="expense-down"');
    expect(text(expense)).toContain('-95,00 BOB (-6,78 %) · disminución de gasto');
  });

  it('top de categorías en el orden de la API y con el neto negativo sin ocultar', () => {
    const html = render({
      ...SUMMARY,
      topExpenseCategories: [
        ...SUMMARY.topExpenseCategories,
        {
          categoryId: '0190a000-0000-7000-8000-0000000000d4',
          name: 'Reembolsado',
          amount: { amount: '-30.00', currency: 'BOB' },
          complete: true,
        },
      ],
    });
    const top = text(section(html, 'top-categories'));
    expect(top.indexOf('Supermercado: 1.200,00 BOB')).toBeLessThan(top.indexOf('Restaurantes: 100,00 BOB'));
    expect(top).toContain('Reembolsado: -30,00 BOB');
  });

  it('patrimonio neto con activos, pasivos y desglose por moneda y tipo de cuenta', () => {
    const nw = section(render(SUMMARY), 'net-worth');
    expect(nw).toMatch(/data-testid="net-worth-amount"[^>]*>1\.006,50 BOB</);
    expect(nw).toContain('<span data-testid="net-worth-assets">1.406,50 BOB</span>');
    expect(nw).toContain('<span data-testid="net-worth-liabilities">400,00 BOB</span>');
    expect(text(nw)).toContain('Tarjeta de crédito-400,00 BOB');
    expect(text(nw)).toContain('USDT50,000000 USDT601,00 BOB');
    expect(nw).not.toContain('net-worth-incomplete');
  });

  it('pie con periodo, instante de generación y la atribución de la fuente una sola vez', () => {
    const html = render(SUMMARY);
    const footer = /<footer[\s\S]*<\/footer>/.exec(html)![0];
    expect(text(html)).toMatch(/Periodo: del 1[^<]*sept[^<]*2026 al 30[^<]*sept[^<]*2026/);
    expect(footer).toContain('data-testid="dashboard-generated-at"');
    expect(footer).toContain('Moneda de reporte: BOB');
    expect(footer.match(/Fuente: paralelo\.bo/g)).toHaveLength(1);
    expect(footer).toContain('CC BY 4.0');
  });

  it('esqueleto de carga sin cifras', () => {
    const html = renderToStaticMarkup(<DashboardSkeleton label="Cargando el resumen…" />);
    expect(html).toContain('data-testid="dashboard-skeleton"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(text(html)).toContain('Cargando el resumen…');
    expect(html).not.toMatch(/\d+,\d{2}/);
  });
});

describe('Home: "Este mes" con categorías y comparación con el mes anterior (FR-REPORTING-004, D50)', () => {
  it('jerarquía: h2 dinero disponible → h2 "Este mes" (h3 ingresos, gastos, ahorro, categorías) → h2 patrimonio → h2 próximamente', () => {
    const html = render(SUMMARY);
    const headings = [...html.matchAll(/<(h[1-6])[^>]*>([^<]*)<\/h[1-6]>/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(headings).toEqual([
      'h2 ¿Cuánto dinero tengo?',
      'h2 Este mes',
      'h3 ¿Cuánto ingresó?',
      'h3 ¿Cuánto gasté?',
      'h3 ¿Cuánto ahorré?',
      'h3 Principales categorías de gasto',
      'h3 Principales fuentes de ingreso',
      'h2 Patrimonio y cuentas',
      'h3 Patrimonio neto',
      'h3 Saldos por cuenta',
      'h2 Próximamente',
      'h3 ¿Cuánto puedo gastar?',
      'h3 ¿Voy a cumplir mis metas?',
    ]);
    // "Este mes" va justo después del dinero disponible y antes del patrimonio.
    const month = html.indexOf('data-testid="month-overview"');
    expect(month).toBeGreaterThan(html.indexOf('data-testid="liquid-balance"'));
    expect(month).toBeLessThan(html.indexOf('data-testid="net-worth"'));
    // Tokens del sistema de diseño (docs/28 §5) y rejilla mobile-first.
    expect(html).toContain('--pf-fin-warning:#B45309');
    expect(html).toContain('@media (min-width:768px)');
    expect(html).toContain('prefers-reduced-motion');
  });

  it('[TC-REPORTING-KPI-006] categorías en el orden de la API, numeradas, con barras decorativas proporcionales a la mayor', () => {
    const top = section(render({ ...SUMMARY, comparison: null }), 'top-categories');
    expect(text(top)).toContain('Las 3 categorías con más gasto neto del mes');
    expect(top).toContain('<ol class="pf-home-cats">');
    const sup = categoryRow(top, 'Supermercado');
    expect(sup).toContain('<div class="pf-home-meter" aria-hidden="true">');
    expect(sup).toContain('width:100.0%');
    expect(categoryRow(top, 'Restaurantes')).toContain('width:8.3%');
    // Sin comparación no se inventan variaciones (aunque la respuesta traiga montos anteriores).
    expect(top).toContain('data-comparison="unavailable"');
    expect(top).not.toContain('top-category-trend');
  });

  it('[TC-REPORTING-KPI-007] [TC-REPORTING-KPI-010] cada categoría muestra la variación contra el mismo tramo del mes anterior (de la misma respuesta) con glifo, signo y texto', () => {
    const top = section(render(SUMMARY), 'top-categories');
    expect(top).toContain('data-comparison="ready"');
    const sup = categoryRow(top, 'Supermercado');
    expect(sup).toContain('data-trend="up"');
    expect(sup).toContain('data-tone="warning"');
    expect(sup).toContain('<span aria-hidden="true" class="pf-home-trend-icon">▲</span>');
    expect(text(sup)).toContain('+200,00 BOB más que el mes anterior · mes anterior: 1.000,00 BOB');
    const res = categoryRow(top, 'Restaurantes');
    expect(res).toContain('data-trend="down"');
    expect(res).toContain('data-tone="ok"');
    expect(text(res)).toContain('-50,00 BOB menos que el mes anterior · mes anterior: 150,00 BOB');
    // Marca de "mes anterior" en la barra: 150 / 1200 = 12,5 %.
    expect(res).toContain('left:calc(12.5% - 1px)');
    const fees = categoryRow(top, 'Fees');
    expect(fees).toContain('data-trend="flat"');
    expect(text(fees)).toContain('igual que el mes anterior · mes anterior: 5,00 BOB');
    expect(text(top)).toContain('Marca: gasto en los mismos días del mes anterior');
  });

  it('[TC-REPORTING-KPI-010] monto anterior cero = categoría "nueva"; monto anterior no disponible (null) = no se afirma nada', () => {
    const html = render(
      withExpenseTop(
        cat('d1', 'Supermercado', '1200.00', '1200.00'),
        cat('d2', 'Restaurantes', '100.00', '0.00'),
        cat('d3', 'Viajes', '80.00', null),
      ),
    );
    const res = categoryRow(section(html, 'top-categories'), 'Restaurantes');
    expect(res).toContain('data-trend="new"');
    expect(text(res)).toContain('+100,00 BOB nuevo: sin gasto el mes anterior');
    expect(res).not.toContain('data-testid="top-category-previous"');
    const viajes = categoryRow(section(html, 'top-categories'), 'Viajes');
    expect(viajes).toContain('data-trend="unknown"');
    expect(text(viajes)).toContain('sin comparación con el mes anterior');
    expect(viajes).not.toContain('top-category-previous-marker');
  });

  it('[TC-REPORTING-KPI-009] top de ingresos junto al de gastos: barras de ingreso y "más ingreso" en tono positivo', () => {
    const html = render(SUMMARY);
    const income = section(html, 'top-income-categories');
    expect(income).toContain('aria-labelledby="top-income-categories-title"');
    expect(text(income)).toContain('La categoría con más ingreso neto del mes');
    const sal = categoryRow(income, 'Salario');
    expect(sal).toContain('data-kind="income"');
    expect(sal).toContain('data-trend="up"');
    expect(sal).toContain('data-tone="ok"');
    expect(text(sal)).toContain('+500,00 BOB más que el mes anterior · mes anterior: 7.500,00 BOB');
    // Menos ingreso que el mes anterior = atención (texto + glifo, no solo color).
    const less = render({ ...SUMMARY, topIncomeCategories: [cat('c1', 'Salario', '7000.00', '7500.00')] });
    const down = categoryRow(section(less, 'top-income-categories'), 'Salario');
    expect(down).toContain('data-tone="warning"');
    expect(text(down)).toContain('-500,00 BOB menos que el mes anterior');
    // Los dos tops van juntos en la columna de categorías de "Este mes", gasto primero.
    expect(html).toContain('<div class="pf-home-tops">');
    expect(html.indexOf('data-testid="top-categories"')).toBeLessThan(
      html.indexOf('data-testid="top-income-categories"'),
    );
  });

  it('sin ingresos en el mes el top de ingresos muestra su estado vacío; una respuesta sin el campo no lo muestra', () => {
    const empty = section(render({ ...SUMMARY, topIncomeCategories: [] }), 'top-income-categories');
    expect(text(empty)).toContain('Sin ingresos registrados este mes.');
    expect(empty).not.toContain('register-expense-action');
    const { topIncomeCategories: _omit, ...legacy } = SUMMARY;
    expect(render(legacy)).not.toContain('data-testid="top-income-categories"');
  });

  it('la resta por categoría es exacta (bigint) y un neto negativo no tiene barra', () => {
    expect(compareCategory(cat('e1', 'Grande', '12345678901234567.89', '0.01'))).toEqual({
      trend: 'up',
      previous: { amount: '0.01', currency: 'BOB' },
      delta: { amount: '12345678901234567.88', currency: 'BOB' },
    });
    // Moneda distinta (no debería ocurrir) o sin monto anterior: sin variación.
    expect(
      compareCategory({ ...cat('e1', 'X', '1.00'), previousAmount: { amount: '1.00', currency: 'USD' } })
        .trend,
    ).toBe('unknown');
    expect(compareCategory(cat('e1', 'X', '1.00')).trend).toBe('unknown');
    const html = render(withExpenseTop(cat('d4', 'Reembolsado', '-30.00')));
    expect(categoryRow(section(html, 'top-categories'), 'Reembolsado')).toContain('width:0.0%');
  });

  it('la variación por categoría sale de la misma respuesta: solo con comparación y Q7 disponible', () => {
    expect(hasCategoryComparison(SUMMARY)).toBe(true);
    expect(hasCategoryComparison({ ...SUMMARY, comparison: null })).toBe(false);
    expect(
      hasCategoryComparison({
        ...SUMMARY,
        questions: SUMMARY.questions.map((q) => (q.question === 'Q7' ? { ...q, status: 'NO_DATA' } : q)),
      }),
    ).toBe(false);
  });

  it('con cuentas y sin gastos, el top muestra un estado vacío con la acción de registrar un gasto', () => {
    const html = renderToStaticMarkup(
      <DashboardView
        summary={{ ...SUMMARY, topExpenseCategories: [] }}
        {...ctx}
        registerExpenseHref="/transacciones/nueva"
      />,
    );
    const top = section(html, 'top-categories');
    expect(text(top)).toContain('Sin gastos registrados este mes.');
    expect(top).toContain(
      '<a href="/transacciones/nueva" data-testid="register-expense-action">Registrar un gasto</a>',
    );
  });

  it('los KPI del mes indican el sentido con glifo decorativo y tono semántico además del texto', () => {
    const html = render(SUMMARY);
    const expense = section(html, 'expense');
    expect(expense).toContain('data-tone="warning"');
    expect(expense).toContain('<span aria-hidden="true" class="pf-home-trend-icon">▲</span>');
    expect(section(html, 'income')).toContain('data-tone="ok"');
    // Barras ingresos vs gastos a la misma escala (8000 vs 1305 ⇒ 16,3 %).
    expect(expense).toContain('width:16.3%');
    expect(section(html, 'income')).toContain('width:100.0%');
  });
});

describe('Home: preguntas no disponibles y estados vacíos (tarea 6.2)', () => {
  it('[TC-REPORTING-DASHBOARD-005] Q5 y Q9 dicen que aún no están disponibles, con acción sugerida y sin montos', () => {
    const html = render(SUMMARY);
    const expected = {
      Q5: ['¿Cuánto puedo gastar?', 'fase 2'],
      Q9: ['¿Voy a cumplir mis metas?', 'fase 4'],
    } as const;
    for (const [q, [title, phase]] of Object.entries(expected)) {
      const widget = section(html, `question-${q}`);
      expect(widget).toContain('data-status="NOT_AVAILABLE_IN_PHASE"');
      expect(text(widget)).toContain(title);
      expect(text(widget)).toContain('Aún no disponible');
      expect(text(widget)).toContain(phase);
      expect(text(widget)).not.toMatch(/\d+[.,]\d{2}|BOB|USDT/);
    }
    // Las preguntas habilitadas (incluidas Q4 y Q8 desde Phase 3) no se muestran como "no disponibles".
    for (const q of ['Q1', 'Q4', 'Q8']) expect(html).not.toContain(`data-testid="question-${q}" `);
    expect(html.match(/Aún no disponible/g)).toHaveLength(2);
  });

  it('[TC-REPORTING-DASHBOARD-005] las tarjetas de Q4 y Q8 llegan por la sección de compromisos, entre el dinero disponible y el mes', () => {
    const html = renderToStaticMarkup(
      <DashboardView
        summary={SUMMARY}
        {...ctx}
        commitmentsSection={<section data-testid="commitments">tarjetas Q4 y Q8</section>}
      />,
    );
    const liquid = html.indexOf('data-testid="liquid-balance"');
    const commitments = html.indexOf('data-testid="commitments"');
    const month = html.indexOf('data-testid="month-overview"');
    expect(liquid).toBeGreaterThanOrEqual(0);
    expect(commitments).toBeGreaterThan(liquid);
    expect(month).toBeGreaterThan(commitments);
  });

  it('[TC-REPORTING-DASHBOARD-005] workspace sin cuentas: "¿Cuánto dinero tengo?" indica que no hay cuentas y ofrece crear una, sin 0.00 BOB', () => {
    const html = renderToStaticMarkup(
      <DashboardView summary={EMPTY_SUMMARY} {...ctx} createAccountHref="/cuentas/nueva" />,
    );
    const q1 = section(html, 'liquid-balance');
    expect(q1).toContain('data-status="NO_DATA"');
    expect(text(q1)).toContain('No tienes cuentas todavía.');
    expect(q1).toContain('<a href="/cuentas/nueva">Crea tu primera cuenta para empezar.</a>');
    expect(q1).not.toContain('liquid-balance-amount');
    // Ningún cero sustituto en todo el Home.
    expect(html).not.toMatch(/0,00 BOB|0\.00 BOB/);
    expect(html).not.toContain('net-worth-amount');
    // "Este mes" sin cuentas: un único estado vacío con la acción, sin KPI en cero ni top de categorías.
    expect(html).toContain('data-testid="month-no-data"');
    expect(text(html)).toContain('Aún no hay movimientos este mes.');
    expect(html).not.toContain('data-testid="income-amount"');
    expect(html).not.toContain('data-testid="top-categories"');
  });
});

describe('formato del Home', () => {
  it('antigüedad legible y signo explícito sin pasar por number', () => {
    const t = ctx.t;
    expect(formatAge(30, t)).toBe('hace menos de 1 min');
    expect(formatAge(413, t)).toBe('hace 6 min');
    expect(formatAge(29_213, t)).toBe('hace 8 h');
    expect(formatAge(3 * 86_400 + 5, t)).toBe('hace 3 d');
    expect(formatSignedDecimal('105.00', 'es-BO')).toBe('+105,00');
    expect(formatSignedDecimal('-0.00', 'es-BO')).toBe('0,00');
    expect(formatSignedDecimal('12345678901234567890.12', 'es-BO')).toBe('+12.345.678.901.234.567.890,12');
  });
});
