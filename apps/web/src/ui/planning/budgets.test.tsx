import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { esContext, textOf } from '../test-support';
import {
  ALQUILER_FIJO,
  CAT,
  EDUCACION_MINIMO,
  RESTAURANTES_EXCEDIDO,
  RESTAURANTES_ROLLOVER,
  SALARIO_ESPERADO,
  SUPERMERCADO_MAXIMO,
  plan,
} from './budget-fixtures';
import {
  buildLineBody,
  emptyLineForm,
  formFromLine,
  projectionExceeds,
  settlementOf,
  statusPresentation,
  type LineFormValues,
} from './budget-logic';
import { BudgetLineForm, natureOf, type TargetOptions } from './BudgetLineForm';
import { BudgetLinesTable, type TargetNames } from './BudgetLinesTable';
import { BudgetProgressWidgetView } from './BudgetProgressWidget';
import { BudgetTotalsView } from './BudgetTotalsView';

const f = esContext('Budgets');
const names: TargetNames = {
  CATEGORY: new Map([
    [CAT.super, 'Supermercado'],
    [CAT.rest, 'Restaurantes'],
    [CAT.alquiler, 'Alquiler'],
    [CAT.educ, 'Educación'],
    [CAT.salario, 'Salario'],
  ]),
  GROUP: new Map(),
  TAG: new Map(),
};

describe('Pantalla de presupuestos (planning/budgets 6.1)', () => {
  it('[TC-PLANNING-BUDGET-006] (UI) el máximo excedido muestra restante −50,00, 108,3 % y el estado con TEXTO e ICONO (no solo color)', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([RESTAURANTES_EXCEDIDO])} names={names} f={f} canEdit />,
    );
    const text = textOf(html);
    expect(text).toContain('Restaurantes');
    expect(text).toContain('-50,00 BOB');
    expect(text).toContain('108,3 %');
    expect(text).toContain('Excedido');
    // El icono es decorativo (aria-hidden) y el texto está en el mismo elemento de estado.
    expect(html).toMatch(/data-status="OVER"[^>]*><span aria-hidden="true">▲<\/span> Excedido/);
    expect(html).toContain('aria-label="Uso del presupuesto Restaurantes"');
    // Los cuatro umbrales por defecto están cruzados y se anuncian a lectores de pantalla.
    expect(html.match(/data-crossed="true"/g)).toHaveLength(4);
    expect(text).toContain('cruzado');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it('[TC-PLANNING-BUDGET-009] (UI) la proyección de 1.650,00 BOB supera el máximo y lo dice con texto e icono', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([SUPERMERCADO_MAXIMO])} names={names} f={f} canEdit />,
    );
    expect(textOf(html)).toContain('1.650,00 BOB');
    expect(html).toContain('data-testid="line-projection-exceeds"');
    expect(textOf(html)).toContain('La proyección supera el máximo');
    expect(projectionExceeds(SUPERMERCADO_MAXIMO)).toBe(true);
    expect(projectionExceeds(RESTAURANTES_EXCEDIDO)).toBe(true);
  });

  it('[TC-PLANNING-BUDGET-022] (UI) las líneas fijas y de mínimo no proyectan: muestran Pendiente o Cumplido', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([ALQUILER_FIJO, EDUCACION_MINIMO])} names={names} f={f} canEdit />,
    );
    expect(html.match(/data-testid="line-settlement"/g)).toHaveLength(2);
    expect(html).toMatch(/data-settlement="MET"[^>]*>Cumplido/);
    expect(html).toMatch(/data-settlement="PENDING"[^>]*>Pendiente/);
    expect(textOf(html)).not.toContain('42.000');
    expect(html).not.toContain('line-projection-exceeds');
    expect(settlementOf(ALQUILER_FIJO)).toBe('MET');
    expect(settlementOf(EDUCACION_MINIMO)).toBe('PENDING');
    expect(settlementOf(SUPERMERCADO_MAXIMO)).toBeNull();
    expect(settlementOf(SALARIO_ESPERADO)).toBeNull();
  });

  it('[TC-PLANNING-BUDGET-004] (UI) el ingreso esperado muestra lo real y la diferencia −1.500,00 con su rótulo', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([SALARIO_ESPERADO])} names={names} f={f} canEdit />,
    );
    const text = textOf(html);
    expect(text).toContain('6.500,00 BOB');
    expect(text).toContain('-1.500,00 BOB');
    expect(text).toContain('Diferencia con lo esperado');
    expect(text).toContain('ingreso esperado');
    // Sin umbrales en ingresos.
    expect(html).toContain('aria-label="Sin umbrales"');
  });

  it('[TC-PLANNING-ACTUAL-006] (UI) el gastado incompleto avisa del monto sin convertir y el remanente se marca provisional', () => {
    const html = renderToStaticMarkup(
      <BudgetLinesTable budget={plan([RESTAURANTES_ROLLOVER])} names={names} f={f} canEdit />,
    );
    const text = textOf(html);
    expect(text).toContain('341,00 BOB');
    expect(text).toContain('Sin convertir: 5,00 EUR');
    expect(html).toContain('data-testid="line-incomplete"');
    expect(text).toContain('Incluye +80,00 BOB de remanente (provisional)');
    expect(html).toContain('data-rollover-status="PROVISIONAL"');
  });

  it('[TC-PLANNING-BUDGET-013] (UI) un VIEWER no ve acciones; un periodo cerrado es de solo lectura aunque pueda editar', () => {
    const lines = [RESTAURANTES_EXCEDIDO];
    const viewer = renderToStaticMarkup(
      <BudgetLinesTable budget={plan(lines)} names={names} f={f} canEdit={false} />,
    );
    expect(viewer).not.toContain('<button');
    expect(textOf(viewer)).not.toContain('Acciones');
    const closed = renderToStaticMarkup(
      <BudgetLinesTable budget={plan(lines, { periodStatus: 'CLOSED' })} names={names} f={f} canEdit />,
    );
    expect(closed).not.toContain('<button');
    const editor = renderToStaticMarkup(
      <BudgetLinesTable budget={plan(lines)} names={names} f={f} canEdit />,
    );
    expect(editor).toContain('aria-label="Editar la línea Restaurantes"');
    expect(editor).toContain('aria-label="Quitar la línea Restaurantes"');
  });

  it('sin líneas muestra el estado vacío', () => {
    expect(
      textOf(renderToStaticMarkup(<BudgetLinesTable budget={plan([])} names={names} f={f} canEdit />)),
    ).toContain('no tiene líneas todavía');
  });

  it('[TC-PLANNING-BUDGET-011] (UI) los totales muestran el disponible para gastar 3.750,00 BOB y el aviso de incompleto con las tasas usadas', () => {
    const complete = renderToStaticMarkup(<BudgetTotalsView budget={plan([])} f={f} />);
    expect(textOf(complete)).toContain('3.750,00 BOB');
    expect(complete).not.toContain('budget-incomplete');
    const budget = plan([], {
      totals: {
        ...plan([]).totals,
        complete: false,
        unconverted: [{ amount: '5.00', currency: 'EUR' }],
        toAssign: { amount: '500.00', currency: 'BOB' },
      },
      meta: {
        ...plan([]).meta,
        ratesUsed: [
          {
            rate: { base: 'USD', quote: 'BOB', value: '12.050000000000000000' },
            rateType: 'PARALLEL',
            source: 'PROVIDER',
            asOf: '2026-11-12T10:00:00.000Z',
          },
        ],
        attributions: [{ provider: 'PARALELO_BO', text: 'Fuente: paralelo.bo', url: 'https://paralelo.bo' }],
      },
    });
    const html = renderToStaticMarkup(<BudgetTotalsView budget={budget} f={f} />);
    const text = textOf(html);
    expect(html).toContain('role="status"');
    expect(text).toContain('Gastado incompleto');
    expect(text).toContain('Sin convertir: 5,00 EUR');
    expect(text).toContain('1 USD = 12.05 BOB · PARALLEL');
    expect(text).toContain('Fuente: paralelo.bo');
    expect(text).toContain('Por asignar');
    expect(text).toContain('500,00 BOB');
  });

  it('[TC-PLANNING-BUDGET-020] (UI) un plan base cero asignado de más rotula "Asignado de más"', () => {
    const budget = plan([], {
      totals: { ...plan([]).totals, toAssign: { amount: '-100.00', currency: 'BOB' } },
    });
    expect(textOf(renderToStaticMarkup(<BudgetTotalsView budget={budget} f={f} />))).toContain(
      'Asignado de más',
    );
  });
});

describe('Formulario de línea', () => {
  const options: TargetOptions = {
    CATEGORY: [
      { id: CAT.rest, name: 'Restaurantes', nature: 'EXPENSE' },
      { id: CAT.salario, name: 'Salario', nature: 'INCOME' },
    ],
    GROUP: [],
    TAG: [{ id: 'tag-1', name: 'Viaje', nature: 'EXPENSE' }],
  };
  const render = (values: LineFormValues, mode: 'add' | 'edit' = 'add', errors = {}) =>
    renderToStaticMarkup(
      <BudgetLineForm
        mode={mode}
        values={values}
        errors={errors}
        targets={options}
        currency="BOB"
        f={f}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

  it('muestra solo los campos que aplican al tipo: máximo pide monto y umbrales; rango, mínimo y máximo', () => {
    const maximum = render({ ...emptyLineForm(), targetId: CAT.rest, kind: 'MAXIMUM' });
    expect(maximum).toContain('data-testid="form-planned"');
    expect(maximum).toContain('data-testid="form-thresholds"');
    expect(maximum).toContain('data-testid="form-rollover-policy"');
    expect(maximum).not.toContain('data-testid="form-min"');
    const range = render({ ...emptyLineForm(), targetId: CAT.rest, kind: 'RANGE' });
    expect(range).toContain('data-testid="form-min"');
    expect(range).toContain('data-testid="form-max"');
    expect(range).not.toContain('data-testid="form-planned"');
    const minimum = render({ ...emptyLineForm(), targetId: CAT.rest, kind: 'MINIMUM' });
    expect(minimum).toContain('data-testid="form-min"');
    expect(minimum).not.toContain('data-testid="form-thresholds"');
    expect(minimum).not.toContain('data-testid="form-rollover-policy"');
    const percent = render({ ...emptyLineForm(), targetId: CAT.rest, kind: 'PERCENT_OF_INCOME' });
    expect(percent).toContain('data-testid="form-percent"');
    expect(percent).toContain('data-testid="form-income-basis"');
  });

  it('[TC-PLANNING-BUDGET-004] un objetivo de ingreso solo admite el tipo fijo, sin umbrales ni remanente', () => {
    const values = { ...emptyLineForm(), targetId: CAT.salario, kind: 'MAXIMUM' as const };
    expect(natureOf(options, values)).toBe('INCOME');
    const html = render(values);
    expect(html).toContain('Fijo');
    expect(html).not.toContain('Máximo</option>');
    expect(html).not.toContain('data-testid="form-thresholds"');
    expect(html).not.toContain('data-testid="form-rollover-policy"');
    expect(textOf(html)).toContain('solo admiten un monto fijo');
  });

  it('la edición bloquea el objetivo y los errores se asocian al campo con aria-describedby', () => {
    const html = render({ ...emptyLineForm(), targetId: CAT.rest, kind: 'MAXIMUM' }, 'edit', {
      planned: 'scale',
    });
    expect(html).toMatch(/data-testid="form-target"[^>]*>/);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*data-testid="form-target"/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby=');
    expect(textOf(html)).toContain('más decimales de los que admite la moneda');
    expect(textOf(html)).toContain('Guardar cambios');
  });
});

describe('Armado y validación del cuerpo de la línea', () => {
  const opts = { currency: 'BOB', scale: 2, locale: 'es-BO', nature: 'EXPENSE' as const };
  const values = (over: Partial<LineFormValues>): LineFormValues => ({
    ...emptyLineForm(),
    targetId: CAT.rest,
    ...over,
  });

  it('máximo: monto canónico a la escala de la moneda; los demás campos del tipo van null', () => {
    const r = buildLineBody(values({ kind: 'MAXIMUM', planned: '1.234,50' }), opts);
    expect(r).toMatchObject({
      ok: true,
      body: {
        kind: 'MAXIMUM',
        planned: { amount: '1234.50', currency: 'BOB' },
        min: null,
        max: null,
        percent: null,
        incomeBasis: null,
        rolloverPolicy: 'NONE',
        rolloverCap: null,
        thresholds: null,
      },
    });
  });

  it('rechaza lo evidente en el cliente: vacío, no numérico y más decimales que la escala (sin redondear)', () => {
    expect(buildLineBody(values({ kind: 'MAXIMUM', planned: '' }), opts)).toEqual({
      ok: false,
      errors: { planned: 'required' },
    });
    expect(buildLineBody(values({ kind: 'MAXIMUM', planned: 'abc' }), opts)).toEqual({
      ok: false,
      errors: { planned: 'invalid' },
    });
    expect(buildLineBody(values({ kind: 'MAXIMUM', planned: '100,005' }), opts)).toEqual({
      ok: false,
      errors: { planned: 'scale' },
    });
    expect(buildLineBody(values({ kind: 'RANGE', min: '10' }), opts)).toEqual({
      ok: false,
      errors: { max: 'required' },
    });
  });

  it('porcentaje de ingresos, rollover con tope y umbrales personalizados', () => {
    const r = buildLineBody(
      values({
        kind: 'PERCENT_OF_INCOME',
        percent: '12,5',
        incomeBasis: 'ACTUAL',
        rolloverPolicy: 'CARRY_ALL',
        rolloverCap: '50',
        thresholds: '80, 110',
      }),
      opts,
    );
    expect(r).toMatchObject({
      ok: true,
      body: {
        percent: '12.5',
        incomeBasis: 'ACTUAL',
        rolloverPolicy: 'CARRY_ALL',
        rolloverCap: { amount: '50.00', currency: 'BOB' },
        thresholds: ['80', '110'],
      },
    });
    expect(buildLineBody(values({ kind: 'PERCENT_OF_INCOME', percent: '10,12345' }), opts).ok).toBe(false);
    expect(buildLineBody(values({ kind: 'MAXIMUM', planned: '1', thresholds: '80, x' }), opts)).toEqual({
      ok: false,
      errors: { thresholds: 'invalid' },
    });
  });

  it('un objetivo de ingreso ignora remanente y umbrales; el mínimo no envía umbrales', () => {
    const income = buildLineBody(
      values({ kind: 'FIXED', planned: '8000', rolloverPolicy: 'CARRY_ALL', thresholds: '50' }),
      { ...opts, nature: 'INCOME' },
    );
    expect(income).toMatchObject({ ok: true, body: { rolloverPolicy: 'NONE', thresholds: null } });
    const minimum = buildLineBody(values({ kind: 'MINIMUM', min: '400', thresholds: '50' }), opts);
    expect(minimum).toMatchObject({
      ok: true,
      body: { min: { amount: '400.00' }, thresholds: null, rolloverPolicy: 'NONE' },
    });
  });

  it('formFromLine devuelve los valores de la línea para editarla', () => {
    const form = formFromLine(RESTAURANTES_ROLLOVER);
    expect(form).toMatchObject({
      kind: 'MAXIMUM',
      planned: '600.00',
      rolloverPolicy: 'CARRY_POSITIVE',
      thresholds: '50, 75, 90, 100',
    });
  });

  it('cada estado tiene icono y clave de texto propios', () => {
    for (const s of [
      'UNDER',
      'ON_TARGET',
      'OVER',
      'WITHIN',
      'BELOW',
      'ABOVE',
      'PENDING',
      'MET',
      'NO_BUDGET',
    ] as const) {
      const p = statusPresentation(s);
      expect(p.icon.length).toBeGreaterThan(0);
      expect(f.has(`status.${p.textKey}`)).toBe(true);
    }
  });
});

describe('Widget del Home (planning/budgets 6.2)', () => {
  it('con plan muestra el disponible para gastar, lo planificado y lo gastado, y avisa si es incompleto', () => {
    const html = renderToStaticMarkup(
      <BudgetProgressWidgetView budget={plan([])} href="/es/planificacion/presupuestos" f={f} />,
    );
    const text = textOf(html);
    expect(html).toContain('data-state="ready"');
    expect(text).toContain('3.750,00 BOB');
    expect(text).toContain('De 5.000,00 BOB planificados llevas gastados 4.000,00 BOB.');
    expect(html).not.toContain('budget-widget-incomplete');
    const incomplete = renderToStaticMarkup(
      <BudgetProgressWidgetView
        budget={plan([], { totals: { ...plan([]).totals, complete: false } })}
        href="/x"
        f={f}
      />,
    );
    expect(incomplete).toContain('budget-widget-incomplete');
  });

  it('sin plan lo dice y ofrece crearlo, sin un cero sustituto', () => {
    const html = renderToStaticMarkup(
      <BudgetProgressWidgetView budget={null} href="/es/planificacion/presupuestos" f={f} />,
    );
    expect(html).toContain('data-state="none"');
    expect(textOf(html)).toContain('todavía no tiene un plan');
    expect(textOf(html)).not.toMatch(/\d,\d{2} BOB/);
    expect(html).toContain('href="/es/planificacion/presupuestos"');
  });
});
