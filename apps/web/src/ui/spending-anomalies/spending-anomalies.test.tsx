import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FormatContext } from '../dashboard/types';
import { esContext, textOf } from '../test-support';
import { AnomalyBadge } from './AnomalyMarks';
import {
  batchesOf,
  DEFAULT_FILTERS,
  filtersFromSearch,
  filtersToSearch,
  listApiPath,
  marksApiPath,
  reasonText,
} from './logic';
import { SpendingAnomaliesView, type SpendingAnomaliesViewProps } from './SpendingAnomaliesView';
import type { AnomalyNames, SpendingAnomaly, SpendingAnomalyReason } from './types';

const f = esContext('SpendingAnomalies');
const href = (path: string) => `/es${path}`;
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const names: AnomalyNames = {
  category: (id) => (id === 'cat-1' ? 'Restaurantes' : undefined),
  counterparty: (id) => (id === 'cp-1' ? 'Pizzería Demo' : undefined),
};

const categoryReason: SpendingAnomalyReason = {
  kind: 'CATEGORY_OUTLIER',
  categoryId: 'cat-1',
  counterpartyId: null,
  reference: bob('80.00'),
  ratio: '3.8',
  robustScore: '20.15',
  sampleSize: 12,
};

const anomaly = (over: Partial<SpendingAnomaly> = {}): SpendingAnomaly => ({
  id: '0198f0aa-0000-7000-8000-000000000001',
  transactionId: '0198f0aa-0000-7000-8000-0000000000a1',
  transactionVersion: 1,
  transactionDate: '2026-11-12',
  transactionChanged: false,
  amount: bob('304.00'),
  reportingAmount: bob('304.00'),
  categoryIds: ['cat-1'],
  counterpartyId: 'cp-1',
  reasons: [categoryReason],
  status: 'OPEN',
  detectedAt: '2026-11-13T05:15:00.000Z',
  decidedAt: null,
  decidedBy: null,
  dismissReason: null,
  ...over,
});

const view = (over: Partial<SpendingAnomaliesViewProps> = {}) =>
  renderToStaticMarkup(
    <SpendingAnomaliesView
      page={{ featureStatus: 'ENABLED' }}
      items={[anomaly()]}
      names={names}
      filters={DEFAULT_FILTERS}
      f={f}
      canDecide
      hasMore={false}
      onFilters={() => undefined}
      onDismiss={() => undefined}
      onRestore={() => undefined}
      onMore={() => undefined}
      href={href}
      {...over}
    />,
  );

describe('motivo por plantilla', () => {
  it('[TC-FORECAST-ANOMALY-014] dice 3,8 veces la mediana de «Restaurantes» con 80,00 BOB y 12 gastos con los formatos es-BO', () => {
    expect(reasonText(categoryReason, f, names)).toBe(
      '3,8 veces la mediana de "Restaurantes" (80,00 BOB en los últimos 12 meses, 12 gastos)',
    );
  });

  it('[TC-FORECAST-ANOMALY-030] los motivos de contraparte (con su categoría principal) y de contraparte nueva usan su plantilla', () => {
    const counterparty: SpendingAnomalyReason = {
      ...categoryReason,
      kind: 'COUNTERPARTY_OUTLIER',
      categoryId: null,
      counterpartyId: 'cp-1',
      reference: bob('95.00'),
      ratio: '3.2',
      sampleSize: 10,
    };
    // Marca anterior al change 85 (sin categoría): plantilla sin categoría.
    expect(reasonText(counterparty, f, names)).toBe(
      '3,2 veces la mediana de tus gastos con "Pizzería Demo" (95,00 BOB en los últimos 12 meses, 10 gastos)',
    );
    // TC-FORECAST-ANOMALY-030: con la categoría principal.
    expect(reasonText({ ...counterparty, categoryId: 'cat-1' }, f, names)).toBe(
      '3,2 veces la mediana de "Pizzería Demo" en "Restaurantes" (95,00 BOB en los últimos 12 meses, 10 gastos)',
    );
    const fresh: SpendingAnomalyReason = {
      kind: 'NEW_COUNTERPARTY_HIGH_AMOUNT',
      categoryId: null,
      counterpartyId: 'cp-nueva',
      reference: bob('900.00'),
      ratio: null,
      robustScore: null,
      sampleSize: 140,
    };
    expect(reasonText(fresh, f, { ...names, counterparty: () => 'Tienda Online Nueva' })).toBe(
      'Contraparte nueva "Tienda Online Nueva", sin gastos en los últimos 12 meses, con un monto igual o mayor al percentil alto de tus gastos (900,00 BOB, 140 gastos)',
    );
  });

  it('[TC-FORECAST-ANOMALY-014] una categoría que ya no existe se nombra «sin nombre» y no rompe el texto', () => {
    expect(reasonText({ ...categoryReason, categoryId: 'borrada' }, f, names)).toContain('"sin nombre"');
  });

  it('[TC-FORECAST-ANOMALY-014] en inglés y portugués usa los formatos de su idioma y ningún texto habla de error ni de fraude', () => {
    for (const locale of ['es', 'en', 'pt'] as const) {
      const messages = JSON.parse(
        readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, unknown>;
      const tr = createTranslator({ locale, messages, namespace: 'SpendingAnomalies' as never });
      const ctx: FormatContext = {
        locale: locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : 'es-BO',
        timeZone: 'America/La_Paz',
        t: (key, values) => tr(key as never, values as never),
        has: (key) => tr.has(key as never),
      };
      const text = reasonText(categoryReason, ctx, names);
      expect(text, locale).toContain('Restaurantes');
      expect(text, locale).toContain(locale === 'en' ? '3.8' : '3,8');
      const catalog = (messages['SpendingAnomalies'] ?? {}) as Record<string, unknown>;
      expect(JSON.stringify(catalog), locale).not.toMatch(
        /\b(error|errores|erro|erros|fraude|fraud|fraudulent)\b/i,
      );
    }
  });
});

describe('lista de gastos atípicos', () => {
  it('[TC-FORECAST-ANOMALY-016] muestra el gasto con su fecha, monto, categoría, contraparte y motivo en una tabla accesible', () => {
    const html = view();
    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    const text = textOf(html).replaceAll('&quot;', '"');
    expect(text).toContain('Gastos atípicos');
    expect(text).toContain('304,00 BOB');
    expect(text).toContain('Restaurantes');
    expect(text).toContain('Pizzería Demo');
    expect(text).toContain('3,8 veces la mediana de "Restaurantes"');
    expect(html).toContain('data-testid="anomaly-row"');
    expect(html).toContain('/es/transacciones/0198f0aa-0000-7000-8000-0000000000a1');
  });

  it('[TC-FORECAST-ANOMALY-016] un gasto en dólares muestra su equivalente en la moneda de reporte', () => {
    const text = textOf(
      view({
        items: [anomaly({ amount: { amount: '50.00', currency: 'USD' }, reportingAmount: bob('348.00') })],
      }),
    );
    expect(text).toContain('50,00 USD');
    expect(text).toContain('Equivale a 348,00 BOB');
  });

  it('[TC-FORECAST-ANOMALY-018] un abierto ofrece «No es atípico» con el motivo opcional; un descartado, «Restaurar» y quién y cuándo', () => {
    const open = view();
    expect(open).toContain('data-testid="anomaly-dismiss"');
    expect(open).toContain('Gasto puntual esperado');
    expect(open).not.toContain('data-testid="anomaly-restore"');
    const dismissed = view({
      items: [
        anomaly({
          status: 'DISMISSED',
          decidedAt: '2026-11-13T15:00:00.000Z',
          decidedBy: '0198f0aa-0000-7000-8000-0000000000b1',
          dismissReason: 'EXPECTED_ONE_OFF',
        }),
      ],
      filters: { ...DEFAULT_FILTERS, status: 'DISMISSED' },
    });
    expect(dismissed).toContain('data-testid="anomaly-restore"');
    expect(dismissed).not.toContain('data-testid="anomaly-dismiss"');
    expect(textOf(dismissed)).toContain('Descartado el');
    expect(textOf(dismissed)).toContain('Gasto puntual esperado');
  });

  it('[TC-FORECAST-ANOMALY-022] un VIEWER ve la lista sin botones ni columna de acciones', () => {
    const html = view({ canDecide: false });
    expect(html).toContain('data-testid="anomaly-row"');
    expect(html).not.toContain('anomaly-dismiss');
    expect(html).not.toContain('anomaly-restore');
    expect(textOf(html)).not.toContain('Acciones');
  });

  it('[TC-FORECAST-ANOMALY-021] una transacción editada después de la detección lo indica', () => {
    expect(textOf(view({ items: [anomaly({ transactionChanged: true })] }))).toContain(
      'La transacción cambió desde que se detectó.',
    );
  });

  it('[TC-FORECAST-ANOMALY-016] sin gastos atípicos, o con la detección deshabilitada, lo dice sin esconder lo ya detectado', () => {
    expect(textOf(view({ items: [] }))).toContain('No hay gastos atípicos abiertos en este rango.');
    const filtered = view({ items: [], filters: { ...DEFAULT_FILTERS, status: 'ALL' } });
    expect(textOf(filtered)).toContain('No hay gastos atípicos con estos filtros.');
    const disabled = view({ page: { featureStatus: 'DISABLED' } });
    expect(textOf(disabled)).toContain('deshabilitada en esta instalación');
    expect(disabled).toContain('data-testid="anomaly-row"');
  });

  it('[TC-FORECAST-ANOMALY-016] los filtros de estado y de rango de fechas tienen etiqueta y la vista pagina con «Cargar más»', () => {
    const html = view({ hasMore: true });
    for (const label of ['Estado', 'Desde', 'Hasta']) expect(textOf(html)).toContain(label);
    expect(html).toContain('for="anomaly-status"');
    expect(html).toContain('data-testid="anomalies-more"');
  });

  it('la vista no habla de error ni de fraude', () => {
    expect(textOf(view())).not.toMatch(/\b(error|errores|fraude)\b/i);
  });
});

describe('marca en la transacción', () => {
  it('[TC-FORECAST-ANOMALY-017] la fila del listado muestra «Atípico» con el motivo en el título y el enlace a /gastos-atipicos', () => {
    const html = renderToStaticMarkup(
      <AnomalyBadge
        anomaly={anomaly()}
        f={f}
        names={{ ...names, account: () => undefined, tag: () => undefined }}
        href={href}
      />,
    );
    expect(html).toContain('data-testid="tx-anomaly-mark"');
    expect(html).toContain('href="/es/gastos-atipicos"');
    expect(textOf(html)).toContain('Atípico');
    // El motivo va en un botón de información con popover, no en `title` (M-09, TC-PLATFORM-PERCEIVED-011).
    expect(html).not.toContain('title=');
    expect(html).toMatch(/popover="auto"/);
    expect(html).toContain('3,8 veces la mediana');
  });
});

describe('rutas y filtros', () => {
  it('[TC-FORECAST-ANOMALY-016] los filtros viajan por la URL y lo inválido vuelve al valor por omisión', () => {
    expect(
      filtersFromSearch(new URLSearchParams('estado=DISMISSED&desde=2026-11-01&hasta=2026-11-30')),
    ).toEqual({
      status: 'DISMISSED',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(filtersFromSearch(new URLSearchParams('estado=XX&desde=ayer'))).toEqual(DEFAULT_FILTERS);
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe('');
    expect(filtersToSearch({ status: 'ALL', from: '2026-11-01', to: '' }).toString()).toBe(
      'estado=ALL&desde=2026-11-01',
    );
  });

  it('[TC-FORECAST-ANOMALY-016] la consulta de la lista lleva el estado, el rango y el cursor', () => {
    expect(
      listApiPath('/workspaces/w1', { status: 'OPEN', from: '2026-11-01', to: '2026-11-30' }, 'abc'),
    ).toBe('/workspaces/w1/spending-anomalies?status=OPEN&limit=50&from=2026-11-01&to=2026-11-30&cursor=abc');
  });

  it('[TC-FORECAST-ANOMALY-017] la consulta de marcas va por transactionId, de a 100 ids sin repetidos', () => {
    expect(marksApiPath('/workspaces/w1', ['a', 'b'])).toBe(
      '/workspaces/w1/spending-anomalies?transactionId=a&transactionId=b',
    );
    const ids = Array.from({ length: 230 }, (_, i) => `t${i}`);
    expect(batchesOf([...ids, 't0']).map((b) => b.length)).toEqual([100, 100, 30]);
    expect(batchesOf([])).toEqual([]);
  });
});
