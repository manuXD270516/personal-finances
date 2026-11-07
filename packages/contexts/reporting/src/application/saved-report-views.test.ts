import { DomainError, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { SavedReportViewRules } from '../domain/index.js';
import { SavedReportViewsService } from './saved-report-views.js';
import { InMemoryFinancialReports } from './testing/in-memory-reports.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const OWNER = '0190a000-0000-7000-8000-000000000001';
const EDITOR = '0190a000-0000-7000-8000-000000000002';
const OTHER_WS = '0190a000-0000-7000-8000-0000000000a2';
const VIAJE = '0190a000-0000-7000-8000-0000000000e1';
const CATEGORIA = '0190a000-0000-7000-8000-0000000000c1';
const CUENTA = '0190a000-0000-7000-8000-0000000000b1';
const FANTASMA = '0190a000-0000-7000-8000-0000000000ff';

let mem: InMemoryFinancialReports;
let views: SavedReportViewsService;

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return null;
};

const trip = (over: Record<string, unknown> = {}) => ({
  userId: OWNER,
  workspaceId: WS,
  reportId: 'EXPENSES_BY_TAG',
  name: 'Gastos del viaje',
  params: { tagIds: [VIAJE], range: { kind: 'LAST_N_PERIODS', periods: 3 } },
  ...over,
});

beforeEach(() => {
  mem = new InMemoryFinancialReports();
  mem.clock.set(Instant.parse('2026-11-15T16:00:00Z'));
  mem.tree = {
    groups: [],
    categories: [
      {
        categoryId: CATEGORIA,
        name: 'Alimentación',
        kind: 'EXPENSE',
        groupId: 'g',
        parentId: null,
        systemCode: null,
        archived: true,
      },
    ],
    tags: [{ tagId: VIAJE, name: 'Viaje Cusco', archived: false }],
  };
  mem.addAccount({ accountId: CUENTA, name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  views = new SavedReportViewsService(mem.financialDeps());
});

describe('SavedReportViewRules', () => {
  it('[TC-REPORTING-REPORTS-049] una vista no guarda montos ni resultados: solo claves de filtro conocidas', () => {
    expect(() => SavedReportViewRules.params({ total: '100.00' })).toThrow(/only stores ids and filters/u);
    expect(() => SavedReportViewRules.params({ amount: { amount: '1.00', currency: 'BOB' } })).toThrow();
    expect(() => SavedReportViewRules.params({ tagIds: ['no-uuid'] })).toThrow();
    expect(() => SavedReportViewRules.params({ range: { kind: 'LAST_N_PERIODS', periods: 25 } })).toThrow();
    expect(() => SavedReportViewRules.params({ compare: 'CUSTOM' })).toThrow();
    expect(SavedReportViewRules.params({ tagIds: [VIAJE, VIAJE], rolling: 6 })).toEqual({
      tagIds: [VIAJE],
      rolling: 6,
    });
  });

  it('[TC-REPORTING-REPORTS-049] el nombre se recorta y tiene de 1 a 80 caracteres; el pronóstico no se guarda', () => {
    expect(SavedReportViewRules.name('  Gastos del viaje  ')).toBe('Gastos del viaje');
    expect(() => SavedReportViewRules.name('   ')).toThrow();
    expect(() => SavedReportViewRules.name('x'.repeat(81))).toThrow();
    expect(() => SavedReportViewRules.reportId('FORECAST_VS_ACTUAL')).toThrow();
    expect(SavedReportViewRules.reportId('FEES')).toBe('FEES');
  });
});

describe('vistas guardadas (TC-REPORTING-REPORTS-049)', () => {
  it('[TC-REPORTING-REPORTS-049] guarda "Gastos del viaje", aparece en la lista y al abrirla calcula el rango desde hoy', async () => {
    const created = await views.create(trip());
    expect(created).toMatchObject({ name: 'Gastos del viaje', reportId: 'EXPENSES_BY_TAG', version: 1 });
    expect((await views.list({ userId: OWNER, workspaceId: WS })).map((v) => v.name)).toEqual([
      'Gastos del viaje',
    ]);
    expect(await views.list({ userId: OWNER, workspaceId: WS, reportId: 'FEES' })).toEqual([]);

    const opened = await views.open({ userId: OWNER, workspaceId: WS, viewId: created.id });
    // Hoy es 2026-11-15: los últimos 3 periodos terminan en el que contiene hoy (por omisión el mes financiero).
    expect(opened.query['to']).toBe('2026-11-30');
    expect(opened.query['from']).toBe('2026-09-01');
    expect(opened.query['tagId']).toEqual([VIAJE]);
    expect(opened.warnings).toEqual([]);
  });

  it('[TC-REPORTING-REPORTS-049] un rango fijo se conserva y el periodo actual y el anterior se calculan desde hoy', async () => {
    const fixed = await views.create(
      trip({ name: 'Octubre', params: { range: { kind: 'FIXED', from: '2026-10-01', to: '2026-10-31' } } }),
    );
    expect((await views.open({ userId: OWNER, workspaceId: WS, viewId: fixed.id })).query).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const previous = await views.create(
      trip({ name: 'Anterior', params: { range: { kind: 'PREVIOUS_PERIOD' } } }),
    );
    expect((await views.open({ userId: OWNER, workspaceId: WS, viewId: previous.id })).query).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('[TC-REPORTING-REPORTS-049] el nombre repetido del mismo reporte se rechaza con SAVED_VIEW_NAME_TAKEN, sin distinguir mayúsculas', async () => {
    await views.create(trip());
    expect(await code(() => views.create(trip()))).toBe('SAVED_VIEW_NAME_TAKEN');
    expect(await code(() => views.create(trip({ name: 'GASTOS DEL VIAJE' })))).toBe('SAVED_VIEW_NAME_TAKEN');
    // Otro reporte puede repetir el nombre.
    expect((await views.create(trip({ reportId: 'EXPENSES_BY_ACCOUNT' }))).name).toBe('Gastos del viaje');
  });

  it('[TC-REPORTING-REPORTS-049] la vista 51 se rechaza con SAVED_VIEW_LIMIT_EXCEEDED', async () => {
    for (let i = 0; i < 50; i += 1) await views.create(trip({ name: `Vista ${i}` }));
    expect(await code(() => views.create(trip({ name: 'Vista 51' })))).toBe('SAVED_VIEW_LIMIT_EXCEEDED');
    // El tope es por usuario: otro miembro del workspace puede guardar la suya.
    expect((await views.create(trip({ userId: EDITOR, name: 'Vista 51' }))).name).toBe('Vista 51');
  }, 30_000);

  it('[TC-REPORTING-REPORTS-049] renombrar exige la versión vigente y respeta la unicidad; borrar la quita de la lista', async () => {
    const a = await views.create(trip());
    const b = await views.create(trip({ name: 'Otra' }));
    const renamed = await views.update({
      userId: OWNER,
      workspaceId: WS,
      viewId: a.id,
      expectedVersion: 1,
      name: 'Cusco 2026',
    });
    expect(renamed).toMatchObject({ name: 'Cusco 2026', version: 2 });
    expect(
      await code(() =>
        views.update({ userId: OWNER, workspaceId: WS, viewId: a.id, expectedVersion: 1, name: 'x' }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(
      await code(() =>
        views.update({ userId: OWNER, workspaceId: WS, viewId: a.id, expectedVersion: 2, name: 'otra' }),
      ),
    ).toBe('SAVED_VIEW_NAME_TAKEN');
    await views.delete({ userId: OWNER, workspaceId: WS, viewId: b.id });
    expect((await views.list({ userId: OWNER, workspaceId: WS })).map((v) => v.name)).toEqual(['Cusco 2026']);
    expect(await code(() => views.delete({ userId: OWNER, workspaceId: WS, viewId: b.id }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-REPORTING-REPORTS-049] no hay auditoría ni cifras: lo guardado son solo parámetros', async () => {
    const created = await views.create(trip());
    expect(Object.keys(created.params).sort()).toEqual(['range', 'tagIds']);
    expect(mem.auditLog).toEqual([]);
  });
});

describe('vistas guardadas personales y aisladas (TC-REPORTING-REPORTS-050)', () => {
  it('[TC-REPORTING-REPORTS-050] otro miembro del workspace no la lista, no la abre y no la modifica', async () => {
    const mine = await views.create(trip());
    expect(await views.list({ userId: EDITOR, workspaceId: WS })).toEqual([]);
    expect(await code(() => views.open({ userId: EDITOR, workspaceId: WS, viewId: mine.id }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(
      await code(() =>
        views.update({ userId: EDITOR, workspaceId: WS, viewId: mine.id, expectedVersion: 1, name: 'x' }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    expect(await code(() => views.delete({ userId: EDITOR, workspaceId: WS, viewId: mine.id }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-REPORTING-REPORTS-050] un usuario de otro workspace tampoco la ve', async () => {
    const mine = await views.create(trip());
    expect(await views.list({ userId: OWNER, workspaceId: OTHER_WS })).toEqual([]);
    expect(await code(() => views.open({ userId: OWNER, workspaceId: OTHER_WS, viewId: mine.id }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-REPORTING-REPORTS-050] los filtros archivados o inexistentes se avisan al abrir sin fallar', async () => {
    mem.tree = { ...mem.tree, tags: [{ tagId: VIAJE, name: 'Viaje Cusco', archived: true }] };
    const created = await views.create(
      trip({
        reportId: 'EXPENSES_BY_CATEGORY',
        params: { tagIds: [VIAJE, FANTASMA], categoryIds: [CATEGORIA], accountIds: [CUENTA, FANTASMA] },
      }),
    );
    const opened = await views.open({ userId: OWNER, workspaceId: WS, viewId: created.id });
    expect(opened.warnings).toEqual(
      expect.arrayContaining([
        { code: 'ARCHIVED_FILTER', kind: 'TAG', id: VIAJE, name: 'Viaje Cusco' },
        { code: 'MISSING_FILTER', kind: 'TAG', id: FANTASMA, name: null },
        { code: 'ARCHIVED_FILTER', kind: 'CATEGORY', id: CATEGORIA, name: 'Alimentación' },
        { code: 'MISSING_FILTER', kind: 'ACCOUNT', id: FANTASMA, name: null },
      ]),
    );
    expect(opened.warnings).toHaveLength(4);
    // Sin rango guardado no hay from/to calculados.
    expect(opened.query['from']).toBeUndefined();
  });
});
